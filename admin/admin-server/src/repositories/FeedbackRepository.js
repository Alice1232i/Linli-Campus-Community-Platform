/**
 * FeedbackRepository - 意见箱仓储
 * ------------------------------------------------------------
 * 负责 feedbacks 集合的数据访问，继承 BaseRepository 通用能力。
 * 数据来源：小程序「意见箱」（feedback 云函数）提交的用户反馈。
 */

const BaseRepository = require('./BaseRepository')

class FeedbackRepository extends BaseRepository {
  constructor() {
    super('feedbacks')
  }

  /**
   * 多条件分页查询反馈
   * 支持状态、反馈类型、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态：pending 待处理 / handled 已处理
   * @param {string} [filters.type] 类型：suggestion / bug / other
   * @param {string} [filters.startDate] 起始日期（YYYY-MM-DD）
   * @param {string} [filters.endDate] 截止日期（YYYY-MM-DD）
   * @param {string} [filters.sortOrder] 排序方向：desc / asc
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
    type,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 状态筛选（feedbacks 原始字段为 status）
    if (status) where.status = status
    // 类型筛选（原始字段为 type 驼峰，不在 fieldMapping 中）
    if (type) where.type = type
    // 时间范围筛选：日期字符串转毫秒时间戳（created_at 经 denormalize 还原为云库 createdAt）
    // 注：比 reports 的字符串直传更严格——字符串与数字比较在云库 where 中不可靠
    if (startDate || endDate) {
      where.created_at = {}
      if (startDate) where.created_at.$gte = new Date(`${startDate}T00:00:00+08:00`).getTime()
      if (endDate) where.created_at.$lte = new Date(`${endDate}T23:59:59+08:00`).getTime()
    }

    // 排序：默认最新在前
    const order = { created_at: sortOrder === 'asc' ? 'asc' : 'desc' }

    return this.findPage(where, order, page, pageSize)
  }

  /**
   * 标记为已处理
   * handledBy 存处理人名称（字符串），与 reports 的 handler 字段约定一致
   * @param {string} id 反馈 id
   * @param {Object} data 处理信息
   * @param {string} [data.reply] 官方回复内容（选填，将回显到小程序「我的反馈」）
   * @param {string} handlerName 处理人姓名
   * @returns {Promise<number>} 受影响行数
   */
  async markHandled(id, { reply }, handlerName) {
    return this.updateById(id, {
      status: 'handled',
      reply: reply || '',
      handledBy: handlerName,
      handledAt: Date.now()
    })
  }

  /**
   * 批量删除反馈
   * @param {string[]} ids 反馈 id 数组
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
        console.error('[FeedbackRepository] 删除反馈失败:', id, e.message)
      }
    }
    return deleted
  }
}

module.exports = FeedbackRepository
