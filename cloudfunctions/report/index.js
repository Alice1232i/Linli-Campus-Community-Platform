/**
 * 临里校园 - 举报模块云函数
 * ------------------------------------------------------------
 * 提供举报提交能力（含重复举报拦截）。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - submit : 提交举报（同一目标 + 同一用户存在 pending 举报时拒绝重复提交）
 *
 * 数据模型说明：
 *   reports 集合：
 *     { _openid, targetType, targetId, reason, detail, evidence,
 *       status:'pending', handler:'', result:'', createdAt, resolvedAt:0 }
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
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
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

// 举报目标类型白名单
const TARGET_TYPES = ['post', 'comment', 'user', 'message', 'lostfound', 'delivery']
// 举报原因白名单
const REASONS = ['spam', 'abuse', 'porn', 'fraud', 'privacy', 'other']

/**
 * action: submit
 * 提交举报流程（原子防重复版）：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：targetType / targetId / reason / detail(可选) / evidence(可选)
 * 3. 使用确定性 ID 原子写入：report_${openid}_${targetId}
 *    - 同一用户对同一目标只能有一条举报记录
 *    - doc().set() 是原子操作，天然避免并发重复创建
 *    - 已存在且 status='pending' 时拒绝（正在处理中）
 *    - 已存在且已处理时允许覆盖重新举报
 * 4. 返回 { reportId }
 */
async function handleSubmit(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['report.submit'])

  const { targetType, targetId, reason, detail, evidence } = event

  // ---- 封禁用户不可提交举报 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法提交举报')
  }

  // ---- 校验 targetType 合法性 ----
  if (!TARGET_TYPES.includes(targetType)) {
    return fail(ERRORS.PARAM_INVALID, 'targetType 不合法')
  }

  // ---- 校验 reason 合法性 ----
  if (!REASONS.includes(reason)) {
    return fail(ERRORS.PARAM_INVALID, 'reason 不合法')
  }

  // ---- 确定性 ID：同一用户 + 同一目标 = 同一 ID ----
  // doc().set() 是原子操作，天然避免并发请求导致的重复创建
  // 替代原 TOCTOU 模式（先查询再创建，并发时有窗口期）
  const reportId = 'report_' + openid + '_' + targetId

  // ---- 检查是否已存在 pending 举报 ----
  // 已存在且 pending：拒绝重复举报
  // 已存在且已处理（resolved/rejected）：允许覆盖重新举报
  let existing = null
  try {
    const res = await db.collection('reports').doc(reportId).get()
    existing = res.data
  } catch (e) {
    // doc 不存在时 get() 抛错，正常流程
    existing = null
  }

  if (existing && existing.status === 'pending') {
    return fail(ERRORS.ALREADY_EXISTS, '该目标已提交过举报，正在处理中')
  }

  const now = Date.now()

  // ---- 原子写入：doc().set() 覆盖写入 ----
  // 已处理过的举报被覆盖，重新变为 pending
  // 注意：doc(reportId).set() 时 _id 已由 doc() 指定，data 中不能再传 _id，否则报 501007
  await db.collection('reports').doc(reportId).set({
    data: {
      _openid: openid,
      targetType,
      targetId,
      reason,
      detail: detail || '',
      evidence: Array.isArray(evidence) ? evidence : [],
      status: 'pending',
      handler: '',
      result: '',
      createdAt: now,
      resolvedAt: 0
    }
  })

  return ok({ reportId })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'submit':
      return handleSubmit(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
