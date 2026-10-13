/**
 * AuthController - 认证控制器
 * ------------------------------------------------------------
 * 处理管理员登录、获取个人信息等 HTTP 请求。
 * 从 ctx 中解析参数调用 AuthService，用 ctx.success 返回统一结果。
 *
 * 错误处理：Service 抛出的业务错误由全局 errorHandler 中间件捕获，
 * Controller 层不重复 try/catch，保持代码简洁。
 */

const AuthService = require('../services/AuthService')
const { ERRORS } = require('../../../../shared/errors')

class AuthController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.authService = new AuthService()
  }

  /**
   * 管理员登录
   * @param {Object} ctx Koa 上下文
   */
  async login(ctx) {
    // 从请求体取用户名、密码
    const { username, password } = ctx.request.body
    // 从 ctx.ip 取登录 IP（Koa 已兼容代理转发场景）
    const ip = ctx.ip
    // 调用 Service 完成登录校验与 token 签发
    const result = await this.authService.login(username, password, ip)
    ctx.success(result, '登录成功')
  }

  /**
   * 获取管理员个人信息
   * @param {Object} ctx Koa 上下文
   */
  /**
   * 修改管理员密码
   * @param {Object} ctx Koa 上下文
   */
  async changePassword(ctx) {
    const adminId = ctx.state.user.id
    const { oldPassword, newPassword, confirmPassword } = ctx.request.body
    // 两次新密码一致性校验
    if (newPassword !== confirmPassword) {
      ctx.fail(ERRORS.PARAM_INVALID, '两次输入的新密码不一致')
      return
    }
    const result = await this.authService.changePassword(adminId, oldPassword, newPassword)
    ctx.success(result, '密码修改成功')
  }

  async profile(ctx) {
    // 从 ctx.state.user 取管理员 id（由 jwtAuth 中间件挂载）
    const adminId = ctx.state.user.id
    const result = await this.authService.getProfile(adminId)
    ctx.success(result)
  }
}

module.exports = AuthController
