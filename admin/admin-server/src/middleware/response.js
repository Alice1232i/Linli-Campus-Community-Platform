/**
 * 统一响应中间件
 * ------------------------------------------------------------
 * 为每个请求的 ctx 挂载统一的成功 / 失败响应方法，
 * 保证全站接口返回结构一致：
 *   { code: number, data: any, message: string }
 *
 * 成功码为 0（与 shared/errors.js 的 SUCCESS 保持一致）。
 *
 * 用法：在所有路由之前 app.use(require('./middleware/response'))
 *   ctx.success(data)              → { code: 0, data, message: 'success' }
 *   ctx.success(data, '创建成功')   → { code: 0, data, message: '创建成功' }
 *   ctx.fail(1002, '参数不合法')    → { code: 1002, data: null, message: '参数不合法' }
 */
const { SUCCESS } = require('../../../../shared/errors')

/**
 * 挂载统一响应方法的中间件
 * @param {Object} ctx Koa 上下文
 * @param {Function} next 下一个中间件
 */
module.exports = async function response(ctx, next) {
  /**
   * 成功响应
   * @param {*} data 返回给前端的数据
   * @param {string} [message='success'] 提示信息，默认 'success'
   */
  ctx.success = function (data, message = 'success') {
    ctx.body = {
      code: SUCCESS,
      data,
      message
    }
  }

  /**
   * 失败响应
   * @param {number} code 业务错误码（参考 shared/errors.js）
   * @param {string} message 错误提示信息
   */
  ctx.fail = function (code, message) {
    ctx.body = {
      code,
      data: null,
      message
    }
  }

  // 继续执行后续中间件 / 路由
  await next()
}
