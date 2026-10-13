/**
 * AdminUserRepository - 管理员用户仓储
 * ------------------------------------------------------------
 * 负责 admin_users 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供按用户名查询、更新最后登录信息等管理员专属操作。
 */

const BaseRepository = require('./BaseRepository')

class AdminUserRepository extends BaseRepository {
  constructor() {
    super('admin_users')
  }

  /**
   * 按用户名查找管理员
   * @param {string} username 用户名
   * @returns {Promise<Object|null>}
   */
  async findByUsername(username) {
    return this.findOne({ username })
  }

  /**
   * 更新最后登录时间和 IP
   * @param {string} id 管理员 id
   * @param {string} ip 登录 IP
   * @returns {Promise<number>} 受影响行数
   */
  async updateLastLogin(id, ip) {
    return this.updateById(id, {
      last_login_at: Date.now(),
      last_login_ip: ip
    })
  }

  /**
   * 更新管理员密码哈希
   * @param {string} id 管理员 id
   * @param {string} passwordHash bcrypt 哈希
   * @returns {Promise<number>} 受影响行数
   */
  async updatePassword(id, passwordHash) {
    return this.updateById(id, {
      password_hash: passwordHash,
      updated_at: Date.now()
    })
  }
}

module.exports = AdminUserRepository
