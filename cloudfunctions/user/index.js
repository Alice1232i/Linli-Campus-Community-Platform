/**
 * 临里校园 - 用户模块云函数
 * ------------------------------------------------------------
 * 提供登录、资料查询/更新、他人信息查询等用户相关能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - login        : 登录（首次自动建档，签发 uploadKey / sessionToken）
 *   - logout       : 撤销当前会话（置 sessionToken 为 revoked_*）
 *   - getProfile   : 获取当前用户完整档案（phone 掩码）
 *   - updateProfile: 更新当前用户资料
 *   - getUser      : 获取他人脱敏信息
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

const {
  initCloud,
  run,
  getOpenid,
  requireLogin,
  validate,
  ok,
  fail,
  contentCheck,
  resolveCloudFileIds,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 院系/专业/届数清单与校验（见 shared/constants.js 的 COLLEGE_MAJORS）
const { isValidCollege, isValidMajor, isValidGrade } = require('./shared/constants')

// 初始化云环境并获取数据库引用
// 注意：initCloud() 返回 wx-server-sdk 实例，不可直接使用未定义的 cloud 变量
const cloud = initCloud()
const db = cloud.database()
const _ = db.command // 查询指令（用于 searchUser 等条件查询）
const $ = db.command.aggregate // 聚合操作符（用于 getUser 实时计算获赞总数）

// ---------------------------------------------------------------------------
// 会话凭证与上传归属键（服务端专用）
// ---------------------------------------------------------------------------
// 安全模型说明（重要，勿删）：
// 1. 真正的身份鉴权**始终**依赖 cloud.getWXContext().OPENID —— 该值由微信在
//    云函数调用链路上注入，客户端无法伪造，也无法通过传参覆盖。
// 2. 因此 openid **没有任何理由下发给客户端**。此前 login 直接返回
//    `token: openid`，导致 openid 明文落进本地缓存、并随每个请求体往返。
//    现改为返回两个**不含身份信息**的随机串：
//      - sessionToken：本次会话的随机标识，退出登录时置为 revoked_* 使其失效
//      - uploadKey   ：随机的上传归属键，用作云存储目录名（见 utils/upload.js）
// 3. sessionToken 只用于「会话是否被撤销」这一件事，不承担身份凭据职责。
const crypto = require('crypto')

/** 会话有效期：30 天 */
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

/**
 * 生成不可逆的随机十六进制串
 * @param {number} bytes 随机字节数
 * @returns {string}
 */
function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * 校验会话凭证是否仍然有效
 * 规则：
 *   - 用户档案未签发过 sessionToken（老数据）→ 放行，兼容历史客户端
 *   - 会话已被撤销（revoked_ 前缀）或已过期        → 拒绝
 *   - 其余情况要求客户端携带的 __token 与服务端一致 → 不一致则拒绝
 * @param {object} userDoc 用户档案
 * @param {string} token 客户端携带的 __token（由请求拦截器注入）
 * @returns {boolean}
 */
function isSessionValid(userDoc, token) {
  const stored = (userDoc && userDoc.sessionToken) || ''
  // 未签发过：兼容老客户端，放行
  if (!stored) return true
  // 已撤销
  if (stored.indexOf('revoked_') === 0) return false
  // 已过期
  const expireAt = (userDoc && userDoc.sessionExpireAt) || 0
  if (expireAt && Date.now() > expireAt) return false
  // 比对会话串
  return !!token && token === stored
}

/**
 * 将单个 cloud:// 头像 fileID 转换为 HTTP 临时 URL
 * 非 cloud:// 地址直接返回原值
 * @param {string} avatar 原始头像地址
 * @returns {Promise<string>} 可访问的 HTTP URL 或原值
 */
async function resolveAvatarUrl(avatar) {
  if (!avatar || avatar.indexOf('cloud://') !== 0) return avatar
  const map = await resolveCloudFileIds([avatar])
  return map[avatar] || avatar
}

/**
 * 手机号脱敏：保留前 3 位与后 4 位，中间以 **** 替换
 * @param {string} phone 原始手机号
 * @returns {string} 脱敏后的手机号
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return ''
  // 长度不足时直接返回原值，避免脱敏后信息量过少
  if (phone.length <= 7) return phone
  return phone.slice(0, 3) + '****' + phone.slice(-4)
}

/**
 * 构造对外公开的脱敏用户信息
 * 不包含 phone、blockList、openid 等隐私字段
 * @param {object} user 用户文档
 * @returns {object} 脱敏后的公开信息
 */
function toPublic(user) {
  if (!user) return null
  return {
    _id: user._id,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    gender: typeof user.gender === 'number' ? user.gender : 0,
    bio: user.bio || '',
    campus: user.campus || '',
    campusCode: user.campusCode || '',
    // 院系 / 专业 / 届数（毕业年份）：编辑资料填写，个人主页展示
    college: user.college || '',
    major: user.major || '',
    grade: user.grade || '',
    role: user.role || 'user',
    status: user.status || 'active',
    studentVerified: !!user.studentVerified,
    verifyBadge: !!user.verifyBadge,
    stats: user.stats || { postCount: 0, likeCount: 0, followerCount: 0, followingCount: 0 },
    createdAt: user.createdAt || 0
  }
}

/**
 * 构造当前用户完整档案（含 phone 掩码）
 * @param {object} user 用户文档
 * @returns {object} 完整档案
 */
function toProfile(user) {
  if (!user) return null
  const profile = toPublic(user)
  // phone 做掩码处理，避免明文返回
  profile.phone = maskPhone(user.phone)
  profile.updatedAt = user.updatedAt || 0
  return profile
}

/**
 * 生成默认昵称："校园用户" + 5 位随机数
 * @returns {string}
 */
function genDefaultNickname() {
  const rand = Math.floor(Math.random() * 90000) + 10000
  return '校园用户' + rand
}

/**
 * action: login
 * 1. 从云函数上下文获取 OPENID（不可信客户端 _openid）
 * 2. 查询 users 集合是否存在该 openid 的记录（按 updatedAt 降序）
 * 3. 不存在则创建新用户记录
 * 4. 存在则更新 updatedAt；若存在重复记录，保留最新的一条并清理其余
 * 5. 签发 / 复用会话凭证：无有效会话时签发新 sessionToken，有效会话原样复用（仅滑动续期），
 *    并补发 uploadKey（上传归属键）后写回档案
 * 6. 返回 { token, uploadKey, userInfo }（三者均不含 openid 等身份信息）
 */
async function handleLogin(event, context) {
  // 服务端获取 openid，禁止信任客户端传入的 _openid
  const openid = getOpenid(context)
  if (!openid) {
    return fail(ERRORS.UNAUTHORIZED, '获取用户身份失败，请重新登录')
  }

  const now = Date.now()
  // 查询是否已存在该 openid 的用户记录
  // 按 updatedAt 降序排列，取所有记录（用于检测和清理重复）
  let existing = []
  try {
    const res = await db
      .collection('users')
      .where({ openid })
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get()
    existing = res.data || []
  } catch (e) {
    // users 集合不存在时降级为新建用户
    console.warn('[user.login] 查询 users 集合失败，降级为新建:', e.message)
    existing = []
  }

  let userInfo
  if (existing.length === 0) {
    // 首次登录：创建新用户记录
    const newUser = {
      openid,
      nickname: genDefaultNickname(),
      avatar: '',
      gender: 0,
      bio: '',
      phone: '',
      role: 'user',
      status: 'active',
      studentVerified: false,
      verifyBadge: false,
      campus: '',
      campusCode: '',
      // 院系 / 专业 / 届数：默认为空，由用户在「编辑资料」中自行选择
      college: '',
      major: '',
      grade: '',
      stats: {
        postCount: 0,
        likeCount: 0,
        followerCount: 0,
        followingCount: 0
      },
      blockList: [],
      createdAt: now,
      updatedAt: now,
      profileVersion: now
    }
    // 使用确定性 _id（user_${openid}）幂等创建：
    // 并发首次登录时，_id 唯一约束保证只有一个请求创建成功，
    // 另一个请求抛 _id 冲突后回查已有记录，从根上杜绝同一 openid 的重复用户
    const deterministicUserId = 'user_' + openid
    try {
      const addRes = await db.collection('users').add({ data: Object.assign({ _id: deterministicUserId }, newUser) })
      userInfo = { _id: addRes._id, ...newUser }
    } catch (e) {
      // _id 冲突：并发下另一请求已创建，回查最新记录
      console.warn('[user.login] 用户创建 _id 冲突，回查已有记录:', e.message)
      const retryRes = await db.collection('users').where({ openid }).orderBy('updatedAt', 'desc').limit(1).get()
      userInfo = (retryRes.data && retryRes.data[0]) ? { ...retryRes.data[0] } : { _id: deterministicUserId, ...newUser }
    }
  } else {
    // 已存在：取第一条（updatedAt 最新）
    const user = existing[0]
    await db
      .collection('users')
      .doc(user._id)
      .update({ data: { updatedAt: now } })
    userInfo = { ...user, updatedAt: now }

    // 清理重复记录：保留第一条（最新），删除其余
    if (existing.length > 1) {
      console.warn('[user.login] 检测到重复用户记录:', openid, '数量:', existing.length)
      for (let i = 1; i < existing.length; i++) {
        try {
          await db.collection('users').doc(existing[i]._id).remove()
        } catch (e) {
          console.warn('[user.login] 清理重复记录失败:', existing[i]._id, e.message)
        }
      }
    }
  }

  // ---- 签发会话凭证与上传归属键 ----
  // uploadKey：随机不可逆串，用作云存储上传目录（替代原先直接把 openid 当目录名，
  //            避免 openid 明文写进存储路径与交给客户端）。
  //            老用户首次登录时补发；历史 upload/{openid}/... 图片仍被服务端接受。
  // sessionToken：随机会话标识，退出登录时置为 revoked_* 使其失效。
  //
  // ⚠️ 关键修复（「任意界面随时提示登录失效」的根因）：
  // 此前每次 login 都无条件签发新 token 并覆盖 users 上的唯一会话字段，
  // 而 sessionToken 是「每个用户一个」，于是「任何一次登录都会立刻作废其它正在使用的会话」：
  //   ① 冷启动时 onLaunch 与 onShow 可能并发登录，后到的响应会把较旧的 token 写回客户端；
  //   ② 微信开发者工具与真机同时打开（同一 openid 两个客户端）会互相轮换 token；
  // 任一在途请求只要携带被作废的 token，就会命中 isSessionValid 的 token !== stored → 2001
  // 「登录状态已失效，请重新登录」，并在 getProfile（切前台即触发）时于任意页面弹出。
  // 现改为：仅在「无会话 / 已撤销 / 已过期」时签发新 token，有效会话原样复用（仅滑动续期），
  // 从根本上消除「登录即作废」的副作用；退出登录仍通过置 revoked_ 生效。
  const uploadKey = userInfo.uploadKey || randomHex(16)
  const prevToken = userInfo.sessionToken || ''
  const prevExpireAt = userInfo.sessionExpireAt || 0
  const needNewSession = !prevToken
    || prevToken.indexOf('revoked_') === 0
    || (prevExpireAt > 0 && now > prevExpireAt)
  const sessionToken = needNewSession ? randomHex(32) : prevToken
  // 实际下发给客户端的会话串：写库失败时回退为档案上原有的值，
  // 避免下发一个服务端不认识、导致 getProfile/updateProfile 被判会话失效的 token
  let issuedToken = sessionToken
  try {
    await db.collection('users').doc(userInfo._id).update({
      data: {
        uploadKey,
        sessionToken,
        // 滑动续期：复用会话时同样延长有效期（30 天），避免活跃用户被过期打断
        sessionExpireAt: now + SESSION_TTL
      }
    })
  } catch (e) {
    // 写入失败不阻断登录：档案上原本就没有会话串时 isSessionValid 走兼容分支放行
    console.warn('[user.login] 写入会话凭证失败，回退为原有会话串:', e.message)
    issuedToken = userInfo.sessionToken || sessionToken
  }

  const publicInfo = toPublic(userInfo)
  // 将头像 cloud:// fileID 转换为 HTTP 临时 URL
  publicInfo.avatar = await resolveAvatarUrl(publicInfo.avatar)
  return ok({
    // token 为随机会话串，不含任何身份信息，仅用于会话撤销判定
    token: issuedToken,
    // 上传归属键：前端用于生成云存储路径 upload/{uploadKey}/...
    uploadKey,
    userInfo: publicInfo
  })
}

/**
 * action: logout
 * 撤销当前会话：把档案上的 sessionToken 置为已撤销标记，并清空过期时间。
 *
 * 说明：小程序端 openid 由微信在每次云函数调用时自动注入，服务端无法「注销」它；
 * 本 action 的作用是让该会话凭证立即失效，配合前端清除本地登录态，
 * 使「退出登录」不再被下一次静默登录立刻顶掉。
 * 撤销后重新登录（action: login）会签发新的 sessionToken。
 */
async function handleLogout(event, context) {
  const openid = getOpenid(context)
  if (!openid) return ok({ revoked: false })
  try {
    const { data } = await db
      .collection('users')
      .where({ openid })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()
    if (data && data.length) {
      await db.collection('users').doc(data[0]._id).update({
        data: { sessionToken: 'revoked_' + Date.now(), sessionExpireAt: 0 }
      })
    }
  } catch (e) {
    console.warn('[user.logout] 撤销会话失败:', e.message)
  }
  return ok({ revoked: true })
}

/**
 * action: getProfile
 * 鉴权后返回当前用户完整档案（phone 掩码）
 * 头像 cloud:// fileID 转换为 HTTP 临时 URL，确保跨设备可访问
 */
async function handleGetProfile(event, context) {
  const openid = requireLogin(getOpenid(context))
  const { data } = await db
    .collection('users')
    .where({ openid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  if (data.length === 0) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  // 会话校验：已撤销/已过期/不匹配的会话不得读取本人完整档案
  if (!isSessionValid(data[0], event.__token)) {
    return fail(ERRORS.UNAUTHORIZED, '登录状态已失效，请重新登录')
  }
  const profile = toProfile(data[0])
  // 将头像 cloud:// fileID 转换为 HTTP 临时 URL
  profile.avatar = await resolveAvatarUrl(profile.avatar)
  return ok(profile)
}

/**
 * action: updateProfile
 * 参数校验：nickname / avatar / gender / bio，均可选
 *   - nickname: string，最长 20
 *   - avatar  : string（云存储 fileID）
 *   - gender  : number，0 未知 / 1 男 / 2 女
 *   - bio     : string，最长 100
 */
async function handleUpdateProfile(event, context) {
  const openid = requireLogin(getOpenid(context))
  // 基础字段校验（nickname / avatar / bio，规则见 shared/schema.js）
  validate(event, SCHEMAS['user.updateProfile'])

  const updateData = {}
  // 昵称
  if (event.nickname !== undefined) {
    updateData.nickname = event.nickname
  }
  // 头像（云存储 fileID）
  if (event.avatar !== undefined) {
    updateData.avatar = event.avatar
  }
  // 性别：0 未知 / 1 男 / 2 女
  if (event.gender !== undefined) {
    if (typeof event.gender !== 'number' || ![0, 1, 2].includes(event.gender)) {
      return fail(ERRORS.PARAM_INVALID, '性别参数不合法')
    }
    updateData.gender = event.gender
  }
  // 个人简介
  if (event.bio !== undefined) {
    updateData.bio = event.bio
  }
  // ---- 学院 / 专业 / 届数（均可选；传空字符串表示清空）----
  if (event.college !== undefined) {
    if (event.college && !isValidCollege(event.college)) {
      return fail(ERRORS.PARAM_INVALID, '学院不合法')
    }
    updateData.college = event.college
  }
  if (event.major !== undefined) {
    // 专业必须挂在某个学院下：未选学院（或学院为空）时不允许单独设置专业
    if (event.major && !(updateData.college || '').length) {
      return fail(ERRORS.PARAM_INVALID, '请先选择学院')
    }
    const targetCollege = (updateData.college !== undefined)
      ? updateData.college
      : (await getUser(openid)).college || ''
    if (event.major && !isValidMajor(targetCollege, event.major)) {
      return fail(ERRORS.PARAM_INVALID, '专业与学院不匹配')
    }
    updateData.major = event.major
  }
  if (event.grade !== undefined) {
    if (event.grade && !isValidGrade(event.grade)) {
      return fail(ERRORS.PARAM_INVALID, '届数不合法')
    }
    updateData.grade = event.grade
  }

  // 至少需要提供一个可更新字段
  if (Object.keys(updateData).length === 0) {
    return fail(ERRORS.PARAM_MISSING, '未提供需要更新的字段')
  }

  // ---- 内容安全审核：昵称与简介 ----
  // 昵称会通过 enrichAuthors 在全站帖子/评论展示，简介也在用户主页展示，需防止违规内容
  // 策略：内容违规时拒绝保存；审核服务异常时放行（用户资料风险低，不能因审核故障导致无法改资料）
  const textsToCheck = []
  if (updateData.nickname !== undefined) textsToCheck.push(updateData.nickname)
  if (updateData.bio !== undefined) textsToCheck.push(updateData.bio)
  for (const text of textsToCheck) {
    let result
    try {
      result = await contentCheck(text, openid, 1)
    } catch (e) {
      // contentCheck 内部已 catch，理论上不会抛出；兜底容错
      console.warn('[user.updateProfile] 内容安全检测异常，跳过审核:', e.message)
      break
    }
    // 审核服务异常（非内容违规）：放行但不阻断保存
    if (result.error) {
      console.warn('[user.updateProfile] 审核服务异常，跳过昵称/简介审核')
      break
    }
    // 明确内容违规：拒绝保存
    if (!result.pass) {
      return fail(ERRORS.CONTENT_RISK, '昵称或简介包含违规内容，请修改后重试')
    }
  }

  // 写入 profileVersion 时间戳，用于头像 URL 缓存穿透
  // 每次资料更新都递增此值，enrichAuthors 会把它拼到头像 URL 上避免 CDN 缓存旧图
  updateData.updatedAt = Date.now()
  updateData.profileVersion = Date.now()

  // 定位当前用户记录（按 updatedAt 降序取最新的一条，避免重复记录场景下更新错误记录）
  const { data } = await db
    .collection('users')
    .where({ openid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  if (data.length === 0) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  // 会话校验：已撤销/已过期/不匹配的会话不得修改本人资料
  if (!isSessionValid(data[0], event.__token)) {
    return fail(ERRORS.UNAUTHORIZED, '登录状态已失效，请重新登录')
  }
  await db
    .collection('users')
    .doc(data[0]._id)
    .update({ data: updateData })

  // 返回更新后的脱敏信息
  const updated = { ...data[0], ...updateData }
  const publicInfo = toPublic(updated)
  // 将头像 cloud:// fileID 转换为 HTTP 临时 URL
  publicInfo.avatar = await resolveAvatarUrl(publicInfo.avatar)
  return ok(publicInfo)
}

/**
 * action: getUser
 * 根据 userId（_id 或 openid）查询目标用户，返回脱敏信息
 * 仅返回 nickname / avatar / gender / campus / verifyBadge / stats / role / status
 * 不返回 phone、blockList 等隐私字段
 *
 * stats 实时计算：postCount 从 posts 集合 count，likeCount 聚合 posts.stats.likes
 * 避免因 users.stats 字段未维护导致统计数据始终为 0
 */
async function handleGetUser(event, context) {
  requireLogin(getOpenid(context))
  // userId 必填
  if (!event.userId || typeof event.userId !== 'string') {
    return fail(ERRORS.PARAM_MISSING, '参数 userId 不能为空')
  }

  // 优先按 _id 查询，查不到再按 openid 查询（兼容前端两种传值）
  let target = null
  try {
    const res = await db.collection('users').doc(event.userId).get()
    target = res.data
  } catch (e) {
    // _id 不存在时 doc().get() 会抛错，此处吞掉异常继续按 openid 查询
    target = null
  }
  if (!target) {
    const { data } = await db
      .collection('users')
      .where({ openid: event.userId })
      .limit(1)
      .get()
    target = data[0] || null
  }
  if (!target) {
    return fail(ERRORS.NOT_FOUND, '用户不存在')
  }

  // 仅返回脱敏后的公开字段
  const publicInfo = toPublic(target)
  // 将头像 cloud:// fileID 转换为 HTTP 临时 URL
  publicInfo.avatar = await resolveAvatarUrl(publicInfo.avatar)

  // ---- 实时计算统计数据，避免 users.stats 未维护导致全 0 ----
  // postCount: 该用户 status='normal' 的帖子总数
  // likeCount: 该用户所有帖子的点赞数总和（聚合查询）
  const targetOpenid = target.openid || ''
  if (targetOpenid) {
    try {
      // 帖子总数
      const { total: postCount } = await db
        .collection('posts')
        .where({ _openid: targetOpenid, status: 'normal' })
        .count()

      // 获赞总数：聚合所有帖子的 stats.likes 之和
      const { list: likeStats } = await db
        .collection('posts')
        .aggregate()
        .match({ _openid: targetOpenid, status: 'normal' })
        .group({
          _id: null,
          totalLikes: $.sum('$stats.likes')
        })
        .end()

      const totalLikes = (likeStats && likeStats[0] && likeStats[0].totalLikes) || 0

      // 覆盖 stats 字段
      publicInfo.stats = {
        postCount: postCount || 0,
        likeCount: totalLikes,
        // followerCount / followingCount 保留原值（如有 follows 集合可后续扩展）
        followerCount: (publicInfo.stats && publicInfo.stats.followerCount) || 0,
        followingCount: (publicInfo.stats && publicInfo.stats.followingCount) || 0
      }
    } catch (e) {
      console.warn('[user.getUser] 实时计算 stats 失败，降级为原值:', e.message)
    }
  }

  return ok(publicInfo)
}

/**
 * action: searchUser
 * 搜索同学：按昵称关键词模糊匹配用户
 * 1. 鉴权：requireLogin
 * 2. 排除封禁用户和当前用户自己
 * 3. 返回脱敏信息列表（不含 phone、blockList 等隐私字段）
 * 4. 头像 cloud:// fileID 批量转为 HTTP 临时 URL
 *
 * @returns { list: array, total: number }
 */
async function handleSearchUser(event, context) {
  const openid = requireLogin(getOpenid(context))

  const keyword = (event.keyword || '').trim()
  if (!keyword || keyword.length < 1) {
    return ok({ list: [], total: 0 })
  }

  const page = event.page || 1
  const pageSize = 20

  // 构造正则匹配（转义特殊字符）
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reg = db.RegExp({ regexp: escapedKeyword, options: 'i' })

  // 查询条件：昵称匹配 + 非封禁 + 非当前用户
  const where = _.and([
    { nickname: reg },
    { status: _.neq('banned') },
    { openid: _.neq(openid) }
  ])

  // 查询总数
  const { total } = await db.collection('users').where(where).count()

  // 分页查询
  const { data: users } = await db
    .collection('users')
    .where(where)
    .orderBy('updatedAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 脱敏处理
  const list = users.map((u) => toPublic(u))

  // 批量转换头像 cloud:// fileID
  const avatarFileIds = []
  list.forEach((u) => {
    if (u.avatar && u.avatar.indexOf('cloud://') === 0) {
      avatarFileIds.push(u.avatar)
    }
  })
  if (avatarFileIds.length > 0) {
    const urlMap = await resolveCloudFileIds(avatarFileIds)
    list.forEach((u) => {
      if (u.avatar && urlMap[u.avatar]) {
        u.avatar = urlMap[u.avatar]
      }
    })
  }

  return ok({ list, total, page, pageSize, hasMore: list.length === pageSize })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'login':
      return handleLogin(event, context)
    case 'logout':
      return handleLogout(event, context)
    case 'getProfile':
      return handleGetProfile(event, context)
    case 'updateProfile':
      return handleUpdateProfile(event, context)
    case 'getUser':
      return handleGetUser(event, context)
    case 'searchUser':
      return handleSearchUser(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
