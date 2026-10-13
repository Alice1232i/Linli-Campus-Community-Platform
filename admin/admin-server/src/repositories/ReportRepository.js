/**
 * ReportRepository - 举报仓储
 * ------------------------------------------------------------
 * 负责 reports 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供多条件筛选、举报状态与处理信息更新等操作。
 */

const BaseRepository = require('./BaseRepository')

class ReportRepository extends BaseRepository {
  constructor() {
    super('reports')
  }

  /**
   * 多条件分页查询举报
   * 支持状态、举报原因、目标类型、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态
   * @param {string} [filters.reason] 举报原因
   * @param {string} [filters.targetType] 目标类型
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
    reason,
    targetType,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 状态筛选（reports 原始字段为 status）
    if (status) where.status = status
    // 举报原因筛选（reports 原始字段为 reason）
    if (reason) where.reason = reason
    // 目标类型筛选（reports 原始字段为 targetType 驼峰，不在 fieldMapping 中）
    if (targetType) where.targetType = targetType
    // 时间范围筛选（created_at 经 denormalize 转为 createdAt）
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
   * 批量删除举报
   * @param {string[]} ids 举报 id 数组
   * @returns {Promise<number>} 删除条数
   */
  async batchDelete(ids) {
    if (!ids || ids.length === 0) return 0
    let deleted = 0
    for (const id of ids) {
      try {
        await this.removeById(id)
        deleted++
      } catch (e) {
        console.error('[ReportRepository] 删除举报失败:', id, e.message)
      }
    }
    return deleted
  }

  /**
   * 更新举报状态和处理信息
   * handler 用字符串存储处理人名称（与 reports 原始文档 handler: '' 类型一致）
   * 当状态为 resolved 或 rejected 时，记录处理完成时间 resolved_at
   * @param {string} id 举报 id
   * @param {string} status 新状态（resolved / rejected）
   * @param {string} handlerId 处理人管理员 id
   * @param {string} handlerName 处理人姓名
   * @param {string} result 处理结果说明
   * @param {string} action 处理动作（ban / mute / warn / dismiss）
   * @param {number} duration 封禁/禁言天数（0=永久，仅 ban/mute 有效）
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatus(id, status, handlerId, handlerName, result, action, duration) {
    const data = {
      status,
      // handler 为字符串，与原始文档 handler: '' 类型一致，避免类型冲突
      handler: handlerName,
      result,
      action: action || '',
      duration: duration || 0
    }

    // 状态为已解决或已驳回时，记录处理完成时间
    if (status === 'resolved' || status === 'rejected') {
      data.resolved_at = Date.now()
    }

    return this.updateById(id, data)
  }
}

module.exports = ReportRepository
