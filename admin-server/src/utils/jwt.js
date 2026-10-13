/**
 * JWT 签发与验证工具
 * ------------------------------------------------------------
 * 基于 jsonwebtoken 实现 Token 的签发与校验。
 * 密钥与过期时间统一从 config 读取，避免在代码中硬编码。
 *
 * payload 通常包含管理员信息：{ id, username, role }
 */
const jwt = require('jsonwebtoken')
const config = require('../config')

/**
 * 签发 JWT
 * @param {Object} payload 载荷数据，通常为 { id, username, role }
 * @returns {string} 签名后的 token 字符串
 */
function sign(payload) {
  // 使用配置中的密钥签名，过期时间由 config.jwt.expiresIn 控制（如 '7d'）
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  })
}

/**
 * 验证 JWT 并返回解码后的载荷
 * @param {string} token 待验证的 token 字符串
 * @returns {Object} 解码后的 payload（含 id、username、role 等）
 * @throws {Error} token 无效或已过期时抛出错误（TokenExpiredError / JsonWebTokenError），
 *                 由上层 jwtAuth 中间件捕获并转换为统一响应
 */
function verify(token) {
  // jwt.verify 会校验签名与有效期，校验失败时抛出对应错误
  return jwt.verify(token, config.jwt.secret)
}

module.exports = {
  sign,
  verify
}
