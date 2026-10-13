/**
 * CommentRepository - 评论仓储
 * ------------------------------------------------------------
 * 负责 comments 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供按帖子分页查询、多条件筛选、状态更新等评论管理操作。
 */

const BaseRepository = require('./BaseRepository')

class CommentRepository extends BaseRepository {
  constructor() {
    super('comments')
  }

  /**
   * 按帖子 ID 分页查询评论
   * @param {string} postId 帖子 id
   * @param {number} [page=1] 页码
   * @param {number} [pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findByPostId(postId, page = 1, pageSize = 20) {
    return this.findPage({ post_id: postId }, { created_at: 'desc' }, page, pageSize)
  }

  /**
   * 多条件分页查询评论
   * 支持状态、关键词（content 正则匹配）、帖子 ID、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态
   * @param {string} [filters.keyword] 关键词（按 content 正则匹配）
   * @param {string} [filters.postId] 帖子 id
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
    keyword,
    postId,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 状态筛选：未传 status 时默认排除已删除的评论，管理员可显式筛选 deleted 查看
    if (status) {
      where.status = status
    } else {
      where.status = { $ne: 'deleted' }
    }
    // 帖子 ID 筛选
    if (postId) where.post_id = postId
    // 关键词搜索（content 正则匹配）
    if (keyword) where.content = { $regex: keyword }
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
   * 更新评论状态
   * @param {string} id 评论 id
   * @param {string} status 状态
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatus(id, status) {
    return this.updateById(id, { status })
  }
}

module.exports = CommentRepository
