/**
 * VerificationRepository - 认证仓储
 * ------------------------------------------------------------
 * 负责 verifications 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供多条件筛选查询、认证状态更新等操作。
 */

const BaseRepository = require('./BaseRepository')

class VerificationRepository extends BaseRepository {
  constructor() {
    super('verifications')
  }

  /**
   * 多条件分页查询认证记录
   * 支持状态、关键词（email 正则匹配）、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态
   * @param {string} [filters.keyword] 关键词（按 email 正则匹配）
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
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
    // 关键词搜索（email 正则匹配）
    if (keyword) where.email = { $regex: keyword }
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
   * 更新认证状态（可附带审核人信息）
   * @param {string} id 认证记录 id
   * @param {string} status 状态
   * @param {Object} [reviewer] 审核人 { id, username }
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatus(id, status, reviewer = {}) {
    const data = { status }
    if (reviewer && reviewer.id) {
      data.reviewer_id = reviewer.id
      data.reviewer_name = reviewer.username || ''
      data.reviewed_at = Date.now()
    }
    return this.updateById(id, data)
  }
}

module.exports = VerificationRepository
