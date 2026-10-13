/**
 * 全局错误处理中间件
 * ------------------------------------------------------------
 * 作为中间件链的最外层（try/catch 包裹），捕获下游抛出的所有错误，
 * 统一以 { code, data, message } 格式返回，避免错误堆栈直接暴露给前端。
 *
 * 错误分类：
 *   - 业务错误：错误对象自带数字型 .code 属性（自定义错误码），使用该 code
 *   - 系统错误：无数字型 .code 属性，统一归为 9001 (INTERNAL_ERROR)
 *
 * 开发环境（config.isDev）打印完整错误堆栈，便于排查；
 * 生产环境仅打印简要信息，避免泄露敏感信息。
 *
 * 用法：app.use(require('./middleware/errorHandler'))  // 需在路由前注册
 */
const config = require('../config')
const { ERRORS } = require('../../../../shared/errors')

module.exports = async function errorHandler(ctx, next) {
  try {
    // 执行下游中间件 / 路由（含 bodyParser，畸形 JSON 也会被统一捕获）
    await next()
  } catch (err) {
    // 确定错误码：业务错误自带数字型 code，否则归为系统内部错误
    const isBiz = err && Number.isInteger(err.code)
    const code = isBiz ? err.code : ERRORS.INTERNAL_ERROR
    // 业务错误返回可控 message；系统/内部错误一律返回 9001 通用文案，
    // 防止数据库/云 API 原始错误串（SQL 片段、集合名等）泄露给前端
    const message = isBiz ? ((err && err.message) || '请求失败') : '服务器内部错误'

    // 日志始终记录完整错误（含堆栈），便于排查；生产环境也保留详细日志
    if (isBiz) {
      console.error(`[全局错误] code=${code} message=${message}`)
    } else {
      console.error('[全局错误] 内部错误:', err)
    }

    // 统一错误响应格式
    ctx.body = {
      code,
      data: null,
      message
    }
    // HTTP 状态保持 200，由业务 code 表达结果（与 ctx.success 保持一致）
    ctx.status = 200
  }
}
