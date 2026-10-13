/**
 * JWT 认证中间件
 * ------------------------------------------------------------
 * 从请求头 Authorization 中提取 Bearer Token 并校验，
 * 校验通过后将用户信息挂载到 ctx.state.user（含 id、username、role），
 * 供后续中间件 / 控制器使用。
 *
 * 校验失败区分两种情况：
 *   - token 缺失 / 格式错误 / 签名无效 → 2001 (UNAUTHORIZED)
 *   - token 已过期                     → 2003 (TOKEN_EXPIRED)
 *
 * 支持 skip 选项跳过认证（用于登录等无需鉴权的路由）：
 *   - skip 为函数：(ctx) => boolean，返回 true 时跳过
 *   - skip 为路径数组：命中即跳过
 *
 * 用法：
 *   router.use(jwtAuth({ skip: (ctx) => ctx.path === '/auth/login' }))
 *   router.post('/login', jwtAuth({ skip: ['/auth/login'] }), loginController)
 */
const jwt = require('../utils/jwt')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

/**
 * 判断当前请求是否需要跳过认证
 * @param {*} skip 配置的 skip 规则（函数或路径数组）
 * @param {Object} ctx Koa 上下文
 * @returns {boolean}
 */
function shouldSkip(skip, ctx) {
  if (!skip) return false
  // skip 为函数：由调用方自行决定是否跳过
  if (typeof skip === 'function') return !!skip(ctx)
  // skip 为路径数组：命中即跳过
  if (Array.isArray(skip)) {
    return skip.some(p => ctx.path === p || ctx.path.startsWith(p))
  }
  return false
}

/**
 * JWT 认证中间件工厂
 * @param {Object} [options]
 * @param {Function|string[]} [options.skip] 跳过认证的规则
 * @returns {Function} Koa 中间件
 */
module.exports = function jwtAuth(options = {}) {
  const { skip } = options

  return async (ctx, next) => {
    // 命中 skip 规则时直接放行
    if (shouldSkip(skip, ctx)) {
      return await next()
    }

    // 从 Authorization 头提取 token，格式：Bearer <token>
    const authHeader = ctx.headers && ctx.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // 缺失 token 或格式不正确，视为未登录
      ctx.body = {
        code: ERRORS.UNAUTHORIZED,
        data: null,
        message: ERROR_MESSAGES[ERRORS.UNAUTHORIZED]
      }
      ctx.status = 200
      return
    }

    // 去掉 "Bearer " 前缀（共 7 个字符）得到真正的 token
    const token = authHeader.slice(7)

    // 仅对 JWT 验证进行 try/catch，不包裹 await next()，
    // 避免下游中间件/控制器抛出的业务错误被误判为 token 无效
    let payload
    try {
      payload = jwt.verify(token)
    } catch (err) {
      // 区分 token 过期与其他无效情况
      const isExpired = err && err.name === 'TokenExpiredError'
      const code = isExpired ? ERRORS.TOKEN_EXPIRED : ERRORS.UNAUTHORIZED
      ctx.body = {
        code,
        data: null,
        message: ERROR_MESSAGES[code]
      }
      ctx.status = 200
      return
    }

    // token 验证通过，挂载用户信息后放行
    ctx.state.user = {
      id: payload.id,
      username: payload.username,
      role: payload.role
    }
    await next()
  }
}
