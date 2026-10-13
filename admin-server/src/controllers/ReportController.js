/**
 * ReportController - 举报控制器
 * ------------------------------------------------------------
 * 处理举报列表查询、详情、处理等 HTTP 请求。
 * 处理举报时需记录处理人信息（从 ctx.state.user 提取）。
 */

const ReportService = require('../services/ReportService')
const { parsePagination } = require('../utils/pagination')

class ReportController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.reportService = new ReportService()
  }

  /**
   * 分页查询举报列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，支持按状态 / 举报原因 / 目标类型 / 时间范围过滤
    const filters = {
      status: query.status,
      reason: query.reason,
      targetType: query.targetType,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.reportService.getReports(filters)
    ctx.success(result)
  }

  /**
   * 批量删除举报
   * @param {Object} ctx Koa 上下文
   */
  async batchDelete(ctx) {
    const { ids } = ctx.request.body
    if (!Array.isArray(ids) || ids.length === 0) {
      ctx.success({ deleted: 0 }, '未选择要删除的举报')
      return
    }
    const deleted = await this.reportService.batchDeleteReports(ids)
    ctx.success({ deleted }, `成功删除 ${deleted} 条举报`)
  }

  /**
   * 查询举报详情
   * @param {Object} ctx Koa 上下文
   */
  async detail(ctx) {
    const { id } = ctx.params
    const result = await this.reportService.getReportById(id)
    ctx.success(result)
  }

  /**
   * 处理举报
   * 接收 action（ban/mute/warn/dismiss）、duration（天数）、result（处理说明）
   * @param {Object} ctx Koa 上下文
   */
  async handle(ctx) {
    const { id } = ctx.params
    const { action, duration, result } = ctx.request.body
    // 从 ctx.state.user 取管理员信息作为处理人（由 jwtAuth 中间件挂载）
    const adminInfo = {
      id: ctx.state.user.id,
      username: ctx.state.user.username
    }
    await this.reportService.handleReport(id, { action, duration, result }, adminInfo)
    ctx.success(null, '举报处理成功')
  }
}

module.exports = ReportController
