/**
 * 操作日志记录中间件（合规审计版）
 * ------------------------------------------------------------
 * 在请求处理前后，将管理员的写操作完整记录到 operation_logs 表，
 * 供后台审计与操作追溯使用。
 *
 * 合规要求：
 *   1. 所有 POST/PUT/DELETE 写操作全部留痕，包括成功和失败
 *   2. 日志只读追加，禁止删除/修改（无 DELETE/UPDATE 接口）
 *   3. 固定字段：admin_id/admin_name/action/target_type/target_id/
 *      before_data/after_data/request_body/method/path/ip/status_code/log_hash/created_at
 *   4. 操作前查询原始数据快照，操作后查询变更数据快照
 *   5. 通过 Repository 层写入，不绕过分层架构
 *
 * action 提取规则（从 URL 路径自动推导）：
 *   PUT    /api/users/:id/status   → user:update_status
 *   PUT    /api/users/:id/role     → user:update_role
 *   DELETE /api/users/:id          → user:delete
 *   POST   /api/auth/login         → auth:login
 *   PUT    /api/posts/:id/status   → post:update_status
 *
 * 用法：
 *   app.use(operationLogger())
 */
const OperationLogRepository = require('../repositories/OperationLogRepository')

// 实例化日志仓储（V10 修复：通过 Repository 层写入，不直接调 dbAdapter）
const logRepo = new OperationLogRepository()

/** 需要记录日志的 HTTP 方法（写操作） */
const LOGGED_METHODS = ['POST', 'PUT', 'DELETE']

/**
 * 敏感字段名集合（匹配 key 时脱敏，防止密码/token 等凭据明文落库）
 * 登录接口请求体含 password，此前会明文写入 operation_logs.request_body
 */
const SENSITIVE_KEYS = [
  'password',
  'oldpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'authorization',
  'appsecret',
  'wxsecret',
  'secret'
]

/**
 * 递归脱敏对象中的敏感字段（保留结构，值替换为 ******）
 * @param {*} obj 任意值（对象/数组/基本类型）
 * @returns {*} 脱敏后的副本
 */
function maskSensitive(obj) {
  if (Array.isArray(obj)) return obj.map(maskSensitive)
  if (obj && typeof obj === 'object') {
    const out = {}
    Object.keys(obj).forEach((k) => {
      if (SENSITIVE_KEYS.indexOf(k.toLowerCase()) !== -1) {
        out[k] = obj[k] ? '******' : obj[k]
      } else {
        out[k] = maskSensitive(obj[k])
      }
    })
    return out
  }
  return obj
}

/** HTTP 方法 → 语义化动作前缀映射 */
const METHOD_ACTION_MAP = {
  POST: 'create',
  PUT: 'update',
  DELETE: 'delete'
}

/**
 * 资源类型 → 集合名映射
 * 用于在操作前后查询目标对象的数据快照
 */
const COLLECTION_MAP = {
  post: 'posts',
  comment: 'comments',
  user: 'users',
  report: 'reports',
  verification: 'verifications'
}

/**
 * 从 Koa 上下文自动推导操作类型
 * 解析 /api/<resource>/<id>/<sub> 路径，组合为 <resource>:<action> 格式
 *
 * V03 修复：不再用 isNaN 判断路径段是否为 ID，
 * 避免 DELETE /api/posts/:id 的 action 被错误推导为 post:<mongo-id>
 *
 * @param {Object} ctx Koa 上下文
 * @returns {string} 操作类型标识
 */
function defaultGetAction(ctx) {
  const method = ctx.method
  const segments = ctx.path.split('/').filter(Boolean)
  // segments 示例：['api', 'users', '507f1f77bcf86cd799439011', 'status'] 或 ['api', 'auth', 'login']

  if (segments.length >= 2 && segments[0] === 'api') {
    // 资源类型：去掉复数 s（users → user, posts → post）
    const resource = segments[1].replace(/s$/, '')
    // 动作前缀：POST→create, PUT→update, DELETE→delete
    const actionPrefix = METHOD_ACTION_MAP[method] || method.toLowerCase()

    // 如果路径有子操作段（如 /api/users/:id/status → user:update_status）
    // 判断依据：第四段存在，说明路径为 /api/{resource}/{id}/{sub}
    if (segments.length >= 4) {
      return `${resource}:${actionPrefix}_${segments[3]}`
    }
    // 特殊路径处理：POST 且第三段非 ID（如 /api/auth/login → auth:login）
    // 仅对 POST 方法生效，PUT/DELETE 的第三段一定是 ID
    if (method === 'POST' && segments.length >= 3 && isNaN(segments[2])) {
      return `${resource}:${segments[2]}`
    }
    return `${resource}:${actionPrefix}`
  }

  return method.toLowerCase()
}

/**
 * 从 Koa 上下文自动推导操作目标
 * 解析 /api/<resource>/<id> 路径，提取目标类型和 ID
 *
 * V02 修复：不再使用 isNaN 判断 ID，
 * 系统主键 _id 为 24 位 hex 字符串，isNaN 返回 true 导致 targetId 全部丢失。
 * 现在直接将路径第三段作为 ID，只要路径模式匹配即提取。
 *
 * @param {Object} ctx Koa 上下文
 * @returns {{ targetType: string|null, targetId: string|null }}
 */
function defaultGetTarget(ctx) {
  const segments = ctx.path.split('/').filter(Boolean)

  if (segments.length >= 3 && segments[0] === 'api') {
    // 资源类型：去掉复数 s
    const targetType = segments[1].replace(/s$/, '')
    // ID：路径第三段，无论是否数字都视为 ID（V02 修复）
    const targetId = segments[2]
    return { targetType, targetId }
  }

  return { targetType: null, targetId: null }
}

/**
 * 查询目标对象的数据快照
 * 在操作前后分别调用，获取 before_data 和 after_data
 *
 * @param {string} targetType 资源类型（post/comment/user/report/verification）
 * @param {string} targetId 目标 ID
 * @returns {Promise<Object|null>} 目标对象的完整数据，查询失败返回 null
 */
async function fetchSnapshot(targetType, targetId) {
  const collection = COLLECTION_MAP[targetType]
  if (!collection || !targetId) return null
  try {
    const dbAdapter = require('../adapters')
    return await dbAdapter.findOne(collection, { id: targetId })
  } catch (e) {
    // 查询失败不阻塞主流程，快照为 null
    console.warn('[operationLogger.fetchSnapshot] 查询快照失败:', targetType, targetId, e.message)
    return null
  }
}

/**
 * 操作日志记录中间件工厂
 * @param {Object} [options]
 * @param {Function} [options.getAction] 自定义 action 提取函数 (ctx) => string
 * @param {Function} [options.getTarget] 自定义目标提取函数 (ctx) => { targetType, targetId }
 * @returns {Function} Koa 中间件
 */
module.exports = function operationLogger(options = {}) {
  const { getAction, getTarget } = options

  return async (ctx, next) => {
    // ---- 预解析操作类型和目标（在 next 之前，用于快照采集） ----
    const action =
      typeof getAction === 'function' ? getAction(ctx) : defaultGetAction(ctx)

    let targetType = null
    let targetId = null
    if (typeof getTarget === 'function') {
      const t = getTarget(ctx) || {}
      targetType = t.targetType || null
      targetId = t.targetId || null
    } else {
      const t = defaultGetTarget(ctx)
      targetType = t.targetType
      targetId = t.targetId
    }

    // ---- V01 修复：操作前查询原始数据快照 ----
    let beforeData = null
    if (targetType && targetId) {
      beforeData = await fetchSnapshot(targetType, targetId)
    }

    // ---- V09 修复：保存请求体原始参数（在 next 之前保存，避免被修改） ----
    const requestBody = (ctx.request && ctx.request.body)
      ? maskSensitive(JSON.parse(JSON.stringify(ctx.request.body)))
      : null

    // ---- 执行业务逻辑（try/catch 保证失败操作也记录审计日志）----
    // 修复：此前 await next() 抛错时直接跳到外层 errorHandler，日志写入代码不执行，
    // 注释声称「含失败操作全部记录」实际不成立。此处捕获异常，记录日志后再重新抛出。
    let execError = null
    try {
      await next()
    } catch (e) {
      execError = e
    }

    // ---- 仅记录写操作（POST / PUT / DELETE），GET 不记录 ----
    const method = ctx.method
    if (!LOGGED_METHODS.includes(method)) {
      // 非写操作不记录，若有异常交由外层 errorHandler 处理
      if (execError) throw execError
      return
    }

    // ---- V05 修复：所有写操作均记录（含失败） ----
    // 审计场景下，越权尝试、参数错误等失败操作恰恰是审计重点

    // 从 ctx.state.user 获取操作者信息（由 jwtAuth 中间件挂载）
    const user = ctx.state && ctx.state.user
    const adminId = (user && user.id) || null
    const adminName = (user && user.username) || null

    // 获取客户端 IP（app.proxy = true 后 ctx.ip 会解析 X-Forwarded-For）
    const ip = ctx.ip || (ctx.request && ctx.request.ip) || ''

    // ---- V01 修复：操作后查询变更数据快照（仅成功时查询，失败时对象未变更） ----
    let afterData = null
    if (!execError && targetType && targetId && ctx.status >= 200 && ctx.status < 300) {
      afterData = await fetchSnapshot(targetType, targetId)
    }

    // ---- V06 修复：统一使用 snake_case 字段命名，与数据库列名一致 ----
    // 失败操作：status_code 记录业务 code（ctx.body.code，非 0 表示失败），并标记失败
    const businessCode = (ctx.body && ctx.body.code !== undefined) ? ctx.body.code : (execError ? 9001 : 0)
    const log = {
      admin_id: adminId,
      admin_name: adminName,
      action,
      target_type: targetType,
      target_id: targetId,
      before_data: beforeData,
      after_data: afterData,
      request_body: requestBody,
      method,
      path: ctx.path,
      ip,
      status_code: execError ? businessCode : ctx.status,
      created_at: Date.now()
    }

    try {
      // V10 修复：通过 Repository 层写入，恢复分层架构
      await logRepo.log(log)
    } catch (err) {
      // 日志写入失败仅打印错误，不抛出，避免影响已完成的响应
      console.error('[操作日志记录失败]', err)
    }

    // ---- 重新抛出业务异常，交由外层 errorHandler 统一处理 ----
    if (execError) throw execError
  }
}
