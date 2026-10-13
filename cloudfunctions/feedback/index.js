/**
 * 临里校园 - 意见箱云函数
 * ------------------------------------------------------------
 * 收集测试版本用户反馈，供管理后台「意见箱」阅览与处理。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - submit   : 提交反馈（登录用户，每日上限 10 条防刷）
 *   - listMine : 我的反馈列表（分页，按时间倒序）
 *
 * 数据模型说明：
 *   feedbacks 集合：
 *     { _openid, type:'suggestion'|'bug'|'other', content, contact,
 *       appVersion, status:'pending'|'handled', reply, handledBy, handledAt, createdAt }
 *
 * 内容安全策略（与 comment 的 fail-closed 不同，特此说明）：
 *   反馈内容仅管理后台可见、不对外公开；且本函数经 MCP/CLI 部署时无法写入
 *   permissions.openapi（msgSecCheck 权限缺失）。故采用「异常放行、违规拒绝」：
 *   审核服务异常（含权限缺失）时放行，明确判定违规时才拒绝。
 *   后续若在 IDE 重新上传授予权限，可改为与 comment 一致的 fail-closed。
 *
 * 统一响应格式：{ code, data, message }（code 为 0 表示成功）
 */

const {
  initCloud,
  run,
  getOpenid,
  getUser,
  requireLogin,
  validate,
  ok,
  fail,
  contentCheck,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

const cloud = initCloud()
const db = cloud.database()
const _ = db.command

// 反馈集合名
const COLLECTION = 'feedbacks'
// 反馈类型白名单
const TYPES = ['suggestion', 'bug', 'other']
// 每用户每日提交上限（防刷）
const DAILY_LIMIT = 10
// 我的反馈列表每页条数
const PAGE_SIZE = 20

/**
 * 今日 0 点时间戳（用于每日限条统计）
 * @returns {number}
 */
function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * action: submit
 * 提交反馈：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：type（可选，非法值归为 other）/ content（必填 5-500 字）/ contact（可选）/ appVersion（可选）
 * 3. 封禁用户拦截 + 每日限条（防刷）
 * 4. 内容安全：异常放行、违规拒绝（见文件头说明）
 * 5. 写入 feedbacks（集合不存在时自动创建一次并重试）
 */
async function handleSubmit(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['feedback.submit'])

  const feedbackType = TYPES.includes(event.type) ? event.type : 'other'
  const content = String(event.content || '').trim()
  const contact = String(event.contact || '').trim()
  const appVersion = String(event.appVersion || '').trim()

  // ---- 封禁用户不可提交 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法提交反馈')
  }

  // ---- 每日限条（防刷）----
  // 集合尚不存在时 count 会抛错：视为未达上限，忽略即可（首次提交路径）
  try {
    const { total } = await db.collection(COLLECTION)
      .where({ _openid: openid, createdAt: _.gte(todayStart()) })
      .count()
    if (total >= DAILY_LIMIT) {
      return fail(ERRORS.LIMIT_EXCEEDED, '今日反馈已达上限，明天再来吧')
    }
  } catch (e) {
    console.warn('[feedback.submit] 限条统计失败（集合可能不存在）:', e.message)
  }

  // ---- 内容安全：异常放行、违规拒绝（见文件头说明）----
  let textResult
  try {
    textResult = await contentCheck(content, openid, 2)
  } catch (e) {
    console.error('[feedback.submit] 文本安全检测调用异常，放行:', e.message)
    textResult = { error: true }
  }
  if (!textResult.error && !textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '反馈包含违规内容，请修改后提交')
  }

  const doc = {
    _openid: openid,
    type: feedbackType,
    content,
    contact,
    appVersion,
    status: 'pending',
    reply: '',
    handledBy: '',
    handledAt: 0,
    createdAt: Date.now()
  }

  // ---- 写入：集合不存在（首次使用）时创建后重试一次 ----
  try {
    await db.collection(COLLECTION).add({ data: doc })
  } catch (e) {
    console.warn('[feedback.submit] 首次写入失败，尝试创建集合:', e.message)
    try {
      await db.createCollection(COLLECTION)
    } catch (e2) {
      // 已存在（并发创建）等情况忽略
      console.warn('[feedback.submit] 创建集合返回:', e2.message)
    }
    await db.collection(COLLECTION).add({ data: doc })
  }

  return ok({})
}

/**
 * action: listMine
 * 我的反馈列表（仅本人，按时间倒序分页）
 * 返回轻量字段：type / content / status / reply / handledAt / createdAt
 */
async function handleListMine(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['feedback.listMine'])

  const page = event.page || 1

  const { total } = await db.collection(COLLECTION)
    .where({ _openid: openid })
    .count()

  const { data: list } = await db.collection(COLLECTION)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .get()

  return ok({
    list: list.map((item) => ({
      id: item._id,
      type: item.type,
      content: item.content,
      status: item.status,
      reply: item.reply || '',
      handledAt: item.handledAt || 0,
      createdAt: item.createdAt
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    hasMore: list.length === PAGE_SIZE
  })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'submit':
      return handleSubmit(event, context)
    case 'listMine':
      return handleListMine(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
