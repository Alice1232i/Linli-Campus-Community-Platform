/**
 * FeedbackController - 意见箱控制器
 * ------------------------------------------------------------
 * 处理用户反馈的列表查询、标记处理、批量删除等 HTTP 请求。
 * 标记处理时记录处理人信息（从 ctx.state.user 提取）。
 */

const FeedbackService = require('../services/FeedbackService')
const { parsePagination } = require('../utils/pagination')

class FeedbackController {
  constructor() {
    this.feedbackService = new FeedbackService()
  }

  /**
   * 分页查询反馈列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    const filters = {
      status: query.status,
      type: query.type,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.feedbackService.getFeedbacks(filters)
    ctx.success(result)
  }

  /**
   * 标记反馈为已处理（可附官方回复，回显到小程序「我的反馈」）
   * @param {Object} ctx Koa 上下文
   */
  async markHandled(ctx) {
    const { id } = ctx.params
    const { reply } = ctx.request.body || {}
    // 处理人取当前登录管理员昵称/用户名，与举报处理的记录方式一致
    const user = ctx.state.user || {}
    const handlerName = user.nickname || user.username || '管理员'
    const result = await this.feedbackService.markHandled(id, { reply }, handlerName)
    ctx.success(result, '已标记为已处理')
  }

  /**
   * 批量删除反馈
   * @param {Object} ctx Koa 上下文
   */
  async batchDelete(ctx) {
    const { ids } = ctx.request.body
    if (!Array.isArray(ids) || ids.length === 0) {
      ctx.success({ deleted: 0 }, '未选择要删除的反馈')
      return
    }
    const result = await this.feedbackService.batchDeleteFeedbacks(ids)
    ctx.success(result, `成功删除 ${result.deleted} 条反馈`)
  }
}

module.exports = FeedbackController
