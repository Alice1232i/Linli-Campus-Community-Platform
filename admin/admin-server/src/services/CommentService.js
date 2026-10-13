/**
 * CommentService - 评论服务
 * ------------------------------------------------------------
 * 负责评论的查询、删除等管理业务。
 * Service 层封装 Repository 调用，保持业务逻辑与数据访问分离。
 */

const CommentRepository = require('../repositories/CommentRepository')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

class CommentService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.commentRepo = new CommentRepository()
  }

  /**
   * 分页查询评论列表
   * @param {Object} filters 过滤条件（status / keyword / postId / 时间范围 / 分页）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getComments(filters) {
    return this.commentRepo.findWithFilters(filters)
  }

  /**
   * 删除评论（逻辑删除）
   * 合规要求：UGC内容不物理删除，仅标记 status='deleted'，
   * 原始内容永久留存供审计追溯，操作日志由中间件自动记录 before/after 快照
   * @param {string} id 评论 id
   * @returns {Promise<number>} 受影响行数
   */
  async deleteComment(id) {
    // 存在性校验：评论不存在抛 3001
    const comment = await this.commentRepo.findById(id)
    if (!comment) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }
    return this.commentRepo.updateStatus(id, 'deleted')
  }
}

module.exports = CommentService
