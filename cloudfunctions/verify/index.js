/**
 * 临里校园 - 学生认证云函数
 * ------------------------------------------------------------
 * 通过校园邮箱验证码完成学生身份认证。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - sendCode  : 发送验证码到校园邮箱
 *   - submit    : 提交验证码完成认证
 *   - getStatus : 查询当前用户认证状态
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

// nodemailer 做保护性引入：云函数本地未安装时不影响模块加载
let nodemailer = null
try {
  nodemailer = require('nodemailer')
} catch (e) {
  console.warn('nodemailer未安装，邮件功能不可用')
}

const {
  initCloud,
  run,
  getOpenid,
  requireLogin,
  validate,
  ok,
  fail,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
// 注意：initCloud() 返回 wx-server-sdk 实例，不可直接使用未定义的 cloud 变量
const cloud = initCloud()
const db = cloud.database()
const crypto = require('crypto')

/**
 * 验证码哈希（sha256，用 openid 作盐防彩虹表）
 * 数据库中只存哈希，不存明文验证码
 * @param {string} openid 用户 openid
 * @param {string} code 明文验证码
 * @returns {string} 哈希值
 */
function hashCode(openid, code) {
  return crypto.createHash('sha256').update(openid + ':' + code).digest('hex')
}

// 校园邮箱正则：必须以 .edu.cn 结尾
const EDU_EMAIL_REG = /.*\.edu\.cn$/i
// 验证码有效期：10 分钟
const CODE_EXPIRE_MS = 10 * 60 * 1000

// 订阅消息模板（审核结果通知，一次性订阅）
// 模板 ID 在小程序后台「订阅消息」中申请，字段：phrase1=审核结果 date3=审核时间 date4=提交时间 thing7=备注 thing16=申请内容
const SUBSCRIBE_TEMPLATE_ID = 'jnLR5PoHvETJxCq7wNKAmKO8y6KHBaJQHjAtuoPsE-o'

/**
 * 毫秒时间戳 → YYYY-MM-DD（订阅消息 date 字段格式）
 * @param {number} ts 毫秒时间戳
 * @returns {string}
 */
function formatDate(ts) {
  const d = new Date(ts || Date.now())
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}
// 同一验证码记录允许的最大尝试次数
const MAX_ATTEMPTS = 5
// 同一用户发送限频间隔：60 秒
const SEND_INTERVAL_MS = 60 * 1000

/**
 * 生成 6 位随机数字验证码（前导补零）
 * @returns {string}
 */
function genCode() {
  // 使用加密安全随机数，避免 Math.random 可预测导致验证码被伪造
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

/**
 * 根据校园邮箱域名推断学校信息
 * @param {string} email 校园邮箱
 * @returns {{ campus: string, campusCode: string }}
 */
function inferCampus(email) {
  const domain = (email.split('@')[1] || '').toLowerCase()
  // 常见高校邮箱域名映射（可按需扩展）
  const CAMPUS_MAP = {
    'tsinghua.edu.cn': { campus: '清华大学', campusCode: 'THU' },
    'pku.edu.cn': { campus: '北京大学', campusCode: 'PKU' },
    'fudan.edu.cn': { campus: '复旦大学', campusCode: 'FDU' },
    'sjtu.edu.cn': { campus: '上海交通大学', campusCode: 'SJTU' },
    'zju.edu.cn': { campus: '浙江大学', campusCode: 'ZJU' },
    'whu.edu.cn': { campus: '武汉大学', campusCode: 'WHU' },
    'nju.edu.cn': { campus: '南京大学', campusCode: 'NJU' }
  }
  if (CAMPUS_MAP[domain]) return CAMPUS_MAP[domain]
  // 未命中映射时，用域名首段作为校园标识
  const prefix = domain.split('.')[0] || ''
  return {
    campus: prefix || '未知学校',
    campusCode: prefix.toUpperCase().slice(0, 6)
  }
}

/**
 * 构造对外公开的脱敏用户信息
 * @param {object} user 用户文档
 * @returns {object}
 */
function toPublicUser(user) {
  if (!user) return null
  return {
    _id: user._id,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    gender: typeof user.gender === 'number' ? user.gender : 0,
    bio: user.bio || '',
    campus: user.campus || '',
    campusCode: user.campusCode || '',
    role: user.role || 'user',
    status: user.status || 'active',
    studentVerified: !!user.studentVerified,
    verifyBadge: !!user.verifyBadge,
    stats: user.stats || { postCount: 0, likeCount: 0, followerCount: 0, followingCount: 0 },
    createdAt: user.createdAt || 0
  }
}

/**
 * 读取学生认证功能是否开启
 * 从 config 集合读取 verifyEnabled 配置项
 * - 未配置记录时默认返回 true（安全默认值，避免配置缺失误锁）
 * - 显式设为 false 时返回 false（关闭认证）
 * @returns {Promise<boolean>}
 */
async function isVerifyEnabled() {
  try {
    const { data } = await db
      .collection('config')
      .where({ key: 'verifyEnabled' })
      .limit(1)
      .get()
    if (data.length === 0) return false
    return data[0].value !== false
  } catch (e) {
    console.error('[verify.isVerifyEnabled] 读取配置失败:', e)
    return false // 读取失败时默认关闭
  }
}

/**
 * 发送验证码邮件
 * SMTP 配置来自环境变量：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 * 环境变量缺失或 nodemailer 不可用时跳过实际发送，便于开发调试
 * @param {string} email 收件邮箱
 * @param {string} code 验证码
 */
async function sendMail(email, code) {
  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  // 配置缺失或 nodemailer 不可用：跳过实际发送，仅记录日志
  if (!host || !user || !pass || !nodemailer) {
    console.warn('[verify.sendMail] SMTP 未配置或 nodemailer 不可用，跳过邮件发送：', email, '（验证码不落日志）')
    return
  }
  const portNum = Number(port) || 465
  const transporter = nodemailer.createTransport({
    host,
    port: portNum,
    // 465 端口使用 SSL，其余端口（如 587）不使用
    secure: portNum === 465,
    auth: { user, pass }
  })
  await transporter.sendMail({
    from: user,
    to: email,
    subject: '【临里校园】学生认证验证码',
    text: `您的验证码是：${code}，10 分钟内有效。如非本人操作请忽略本邮件。`
  })
}

/**
 * action: sendCode
 * 1. 鉴权：requireLogin
 * 2. 校验校园邮箱格式（必须 .edu.cn 结尾）
 * 3. 限频：同一 openid 60 秒内只能发 1 次
 * 4. 生成 6 位随机验证码
 * 5. 发送邮件（缺省 SMTP 时跳过实际发送）
 * 6. 写入 verifications 集合
 */
async function handleSendCode(event, context) {
  const openid = requireLogin(getOpenid(context))

  // 检查认证功能是否开启
  const enabled = await isVerifyEnabled()
  if (!enabled) {
    return fail(ERRORS.OPERATION_FAILED, '学生认证功能暂时关闭，请稍后再试')
  }

  // 基础参数校验（email required）
  validate(event, SCHEMAS['verify.sendCode'])
  const email = event.email
  // 校园邮箱格式校验
  if (!EDU_EMAIL_REG.test(email)) {
    return fail(ERRORS.PARAM_INVALID, '请使用校园邮箱（以 .edu.cn 结尾）')
  }

  const now = Date.now()
  // 限频：查询该 openid 最近一条验证码记录，60 秒内不可重复发送
  const { data: recent } = await db
    .collection('verifications')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (recent.length > 0 && now - recent[0].createdAt < SEND_INTERVAL_MS) {
    return fail(ERRORS.LIMIT_EXCEEDED, '验证码发送过于频繁，请稍后再试')
  }

  // 生成验证码并发送邮件
  const code = genCode()
  await sendMail(email, code)

  // 记录验证码到 verifications 集合（只存哈希，不存明文；日志也不打印）
  await db.collection('verifications').add({
    data: {
      _openid: openid,
      email,
      codeHash: hashCode(openid, code),
      emailVerified: false,
      status: 'pending',
      attemptCount: 0,
      createdAt: now
    }
  })

  return ok({ success: true })
}

/**
 * action: submit
 * 1. 鉴权：requireLogin
 * 2. 校验 email / code（code 必须 6 位）
 * 3. 查询该 openid + email 的最新一条 pending 记录
 * 4. 校验验证码匹配且未过期（10 分钟）
 * 5. 更新 verifications 记录为 approved
 * 6. 同步更新 users：studentVerified / verifyBadge / campus / campusCode
 * 7. 返回 { verified, userInfo }
 */
async function handleSubmit(event, context) {
  const openid = requireLogin(getOpenid(context))

  // 检查认证功能是否开启
  const enabled = await isVerifyEnabled()
  if (!enabled) {
    return fail(ERRORS.OPERATION_FAILED, '学生认证功能暂时关闭，请稍后再试')
  }

  // 基础参数校验（email / code required）
  validate(event, SCHEMAS['verify.submit'])
  const { email, code } = event
  // 验证码必须为 6 位
  if (!code || code.length !== 6) {
    return fail(ERRORS.PARAM_INVALID, '验证码应为 6 位')
  }

  // 查询该 openid + email 的最新一条 pending 记录
  const { data: records } = await db
    .collection('verifications')
    .where({ _openid: openid, email, status: 'pending' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (records.length === 0) {
    return fail(ERRORS.NOT_FOUND, '未找到验证码记录，请先发送验证码')
  }

  const record = records[0]
  const now = Date.now()

  // 尝试次数限制：同一验证码记录最多尝试 5 次，防止暴力枚举
  const attemptCount = record.attemptCount || 0
  if (attemptCount >= MAX_ATTEMPTS) {
    return fail(ERRORS.OPERATION_FAILED, '验证码尝试次数过多，请重新获取')
  }

  // 校验验证码是否匹配且未过期（哈希比对，数据库不存明文）
  if (record.codeHash !== hashCode(openid, code) || now - record.createdAt > CODE_EXPIRE_MS) {
    await db.collection('verifications').doc(record._id).update({ data: { attemptCount: attemptCount + 1 } })
    return fail(ERRORS.OPERATION_FAILED, '验证码错误或已过期')
  }

  // 更新 verifications 记录为已通过
  await db
    .collection('verifications')
    .doc(record._id)
    .update({
      data: {
        status: 'approved',
        emailVerified: true,
        verifiedAt: now
      }
    })

  // 从邮箱推断校园信息
  const campusInfo = inferCampus(email)

  // 同步更新 users 集合
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  if (users.length === 0) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  const userUpdate = {
    studentVerified: true,
    verifyBadge: true,
    campus: campusInfo.campus,
    campusCode: campusInfo.campusCode,
    studentEmail: email,
    updatedAt: now
  }
  await db
    .collection('users')
    .doc(users[0]._id)
    .update({ data: userUpdate })

  // ---- 发送订阅消息（审核结果通知）----
  // 一次性订阅：用户提交认证时已请求授权，未授权/配额用完时静默失败，不影响认证结果
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: SUBSCRIBE_TEMPLATE_ID,
      page: 'pages/message/index',
      data: {
        phrase1: { value: '通过' },
        date3: { value: formatDate(now) },
        date4: { value: formatDate(record.createdAt || now) },
        thing7: { value: '欢迎完成学生认证' },
        thing16: { value: '学生身份认证' }
      }
    })
    console.log('[verify] 订阅消息发送成功')
  } catch (e) {
    console.warn('[verify] 订阅消息发送失败（未授权或配额用完）:', e.message)
  }

  // 返回更新后的脱敏用户信息
  const updatedUser = { ...users[0], ...userUpdate }
  return ok({ verified: true, userInfo: toPublicUser(updatedUser) })
}

/**
 * action: getStatus
 * 返回当前用户最近的认证状态
 * { status: 'approved'|'pending'|'rejected'|'none', email, studentVerified, verifyBadge }
 */
async function handleGetStatus(event, context) {
  const openid = requireLogin(getOpenid(context))

  // 查询用户档案
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  const user = users[0] || null

  // 查询最近的认证记录
  const { data: records } = await db
    .collection('verifications')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  const record = records[0] || null

  // 认证状态：approved / pending / rejected / none
  let status = 'none'
  let email = ''
  if (record) {
    status = record.status || 'none'
    email = record.email || ''
  }

  return ok({
    status,
    email,
    studentVerified: !!(user && user.studentVerified),
    verifyBadge: !!(user && user.verifyBadge)
  })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'sendCode':
      return handleSendCode(event, context)
    case 'submit':
      return handleSubmit(event, context)
    case 'getStatus':
      return handleGetStatus(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
