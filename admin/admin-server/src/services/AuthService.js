/**
 * AuthService - 认证服务
 * ------------------------------------------------------------
 * 负责管理员登录认证、个人信息获取等业务逻辑。
 *
 * 登录流程：查找管理员 → 校验密码 → 签发 JWT → 更新最后登录信息。
 * Service 层只调用 Repository 与工具方法，不直接接触数据库 SDK。
 */

const AdminUserRepository = require('../repositories/AdminUserRepository')
const { verifyPassword, hashPassword } = require('../utils/password')
const loginRateLimit = require('../utils/loginRateLimit')
const { sign } = require('../utils/jwt')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

class AuthService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.adminUserRepo = new AdminUserRepository()
  }

  /**
   * 管理员登录
   * @param {string} username 用户名
   * @param {string} password 明文密码
   * @param {string} ip 登录 IP
   * @returns {Promise<{token: string, user: {id: string, username: string, role: string, real_name: string}}>}
   * @throws {Error} 用户不存在或密码错误抛 2001，账号被禁用抛 5003
   */
  async login(username, password, ip) {
    // ---- 暴力破解防护：锁定期内直接拒绝 ----
    if (loginRateLimit.isLocked(ip, username)) {
      const remainMs = loginRateLimit.getRemainingLockMs(ip, username)
      const remainMin = Math.ceil(remainMs / 60000)
      const err = new Error(`登录失败次数过多，请在 ${remainMin} 分钟后再试`)
      err.code = ERRORS.LIMIT_EXCEEDED
      throw err
    }

    // 按用户名查找管理员
    const admin = await this.adminUserRepo.findByUsername(username)

    // 用户不存在：统一抛 2001（避免泄露用户是否存在），并记录一次失败
    if (!admin) {
      loginRateLimit.recordFailure(ip, username)
      const err = new Error('用户名或密码错误')
      err.code = ERRORS.UNAUTHORIZED
      throw err
    }

    // 校验密码（明文与哈希比对，数据库字段名为 password_hash）
    const isMatch = await verifyPassword(password, admin.password_hash)
    if (!isMatch) {
      loginRateLimit.recordFailure(ip, username)
      const err = new Error('用户名或密码错误')
      err.code = ERRORS.UNAUTHORIZED
      throw err
    }

    // 账号被禁用（status !== 'active'）抛 5003
    if (admin.status !== 'active') {
      const err = new Error(ERROR_MESSAGES[ERRORS.BLOCKED])
      err.code = ERRORS.BLOCKED
      throw err
    }

    // 登录成功：清除该 IP+用户名维度的失败计数
    loginRateLimit.clear(ip, username)

    // 签发 JWT，载荷包含 id、username、role
    const token = sign({
      id: admin.id,
      username: admin.username,
      role: admin.role
    })

    // 更新最后登录时间和 IP
    await this.adminUserRepo.updateLastLogin(admin.id, ip)

    return {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        real_name: admin.real_name
      }
    }
  }

  /**
   * 获取管理员个人信息
   * @param {string} adminId 管理员 id
   * @returns {Promise<{id: string, username: string, role: string, real_name: string, last_login_at: number}>}
   * @throws {Error} 管理员不存在抛 3001
   */
  /**
   * 修改管理员密码
   * @param {string} adminId 管理员 id
   * @param {string} oldPassword 原密码
   * @param {string} newPassword 新密码
   * @returns {Promise<{updated: boolean}>}
   * @throws {Error} 原密码错误抛 2001，新密码不合规抛 1002
   */
  async changePassword(adminId, oldPassword, newPassword) {
    const admin = await this.adminUserRepo.findById(adminId)
    if (!admin) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    // 校验原密码
    const isMatch = await verifyPassword(oldPassword, admin.password_hash)
    if (!isMatch) {
      const err = new Error('原密码不正确')
      err.code = ERRORS.UNAUTHORIZED
      throw err
    }

    // 新密码强度：至少 8 位，且不能与原密码相同
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      const err = new Error('新密码长度不能少于 8 位')
      err.code = ERRORS.PARAM_INVALID
      throw err
    }
    if (newPassword === oldPassword) {
      const err = new Error('新密码不能与原密码相同')
      err.code = ERRORS.PARAM_INVALID
      throw err
    }

    // 加密并更新
    const passwordHash = await hashPassword(newPassword)
    await this.adminUserRepo.updatePassword(adminId, passwordHash)

    return { updated: true }
  }

  async getProfile(adminId) {
    const admin = await this.adminUserRepo.findById(adminId)

    // 管理员不存在抛 3001
    if (!admin) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    return {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      real_name: admin.real_name,
      last_login_at: admin.last_login_at
    }
  }
}

module.exports = AuthService
