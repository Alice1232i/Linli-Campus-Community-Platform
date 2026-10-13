/**
 * CommentController - 评论控制器
 * ------------------------------------------------------------
 * 处理评论列表查询、删除等 HTTP 请求。
 */

const CommentService = require('../services/CommentService')
const { parsePagination } = require('../utils/pagination')

class CommentController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.commentService = new CommentService()
  }

  /**
   * 分页查询评论列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，支持按状态 / 关键词 / 所属帖子 / 时间范围过滤
    const filters = {
      status: query.status,
      keyword: query.keyword,
      postId: query.postId,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.commentService.getComments(filters)
    ctx.success(result)
  }

  /**
   * 删除评论
   * @param {Object} ctx Koa 上下文
   */
  async remove(ctx) {
    const { id } = ctx.params
    await this.commentService.deleteComment(id)
    ctx.success(null, '删除成功')
  }
}

module.exports = CommentController
