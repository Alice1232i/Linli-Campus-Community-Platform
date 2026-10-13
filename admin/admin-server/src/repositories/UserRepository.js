/**
 * UserRepository - 用户仓储
 * ------------------------------------------------------------
 * 负责 users 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供多条件筛选、按 id 更新状态/角色、按 openid 查询、封禁/禁言等操作。
 */

const BaseRepository = require('./BaseRepository')

class UserRepository extends BaseRepository {
  constructor() {
    super('users')
  }

  /**
   * 多条件分页查询用户
   * 支持状态、角色、关键词（nickname 正则匹配）、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态
   * @param {string} [filters.role] 角色
   * @param {string} [filters.keyword] 关键词（按 nickname 正则匹配）
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
    role,
    keyword,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 状态筛选
    if (status) where.status = status
    // 角色筛选
    if (role) where.role = role
    // 关键词搜索（nickname 正则匹配）
    if (keyword) where.nickname = { $regex: keyword }
    // 时间范围筛选（毫秒时间戳）
    if (startDate || endDate) {
      where.created_at = {}
      if (startDate) where.created_at.$gte = startDate
      if (endDate) where.created_at.$lte = endDate
    }

    // 排序：默认最新在前（desc），可选最早在前（asc）
    const order = { created_at: sortOrder === 'asc' ? 'asc' : 'desc' }

    return this.findPage(where, order, page, pageSize)
  }

  /**
   * 按 openid 查询用户
   * @param {string} openid 用户 openid
   * @returns {Promise<Object|null>}
   */
  async findByOpenid(openid) {
    return this.findOne({ openid })
  }

  /**
   * 按 id 更新用户状态（active / muted / banned）
   * @param {string} id 用户 id
   * @param {string} status 状态
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatusById(id, status) {
    return this.updateById(id, { status })
  }

  /**
   * 按 id 更新用户角色
   * @param {string} id 用户 id
   * @param {string} role 角色
   * @returns {Promise<number>} 受影响行数
   */
  async updateRoleById(id, role) {
    return this.updateById(id, { role })
  }

  /**
   * 封禁用户
   * @param {string} id 用户 id
   * @param {number} expire 封禁到期时间戳（0=永久）
   * @returns {Promise<number>} 受影响行数
   */
  async banUser(id, expire) {
    return this.updateById(id, {
      status: 'banned',
      ban_expire: expire || 0
    })
  }

  /**
   * 禁言用户
   * @param {string} id 用户 id
   * @param {number} expire 禁言到期时间戳（0=永久）
   * @returns {Promise<number>} 受影响行数
   */
  async muteUser(id, expire) {
    return this.updateById(id, {
      status: 'muted',
      mute_expire: expire || 0
    })
  }

  /**
   * 解除封禁/禁言（恢复为正常状态，同时清除到期时间）
   * @param {string} id 用户 id
   * @returns {Promise<number>} 受影响行数
   */
  async unbanUser(id) {
    return this.updateById(id, {
      status: 'active',
      ban_expire: 0,
      mute_expire: 0
    })
  }
}

module.exports = UserRepository
