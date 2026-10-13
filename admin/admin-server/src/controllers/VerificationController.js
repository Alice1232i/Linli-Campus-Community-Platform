/**
 * VerificationController - 认证审核控制器
 * ------------------------------------------------------------
 * 处理学生认证申请的列表查询、审核通过 / 驳回等 HTTP 请求。
 */

const VerificationService = require('../services/VerificationService')
const { parsePagination } = require('../utils/pagination')

class VerificationController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.verificationService = new VerificationService()
  }

  /**
   * 分页查询认证申请列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，支持按状态 / 关键词 / 时间范围过滤
    const filters = {
      status: query.status,
      keyword: query.keyword,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.verificationService.getVerifications(filters)
    ctx.success(result)
  }

  /**
   * 审核通过认证申请
   * @param {Object} ctx Koa 上下文
   */
  async approve(ctx) {
    const { id } = ctx.params
    // 审核人信息来自 JWT（jwtAuth 挂载到 ctx.state.user）
    const reviewer = ctx.state.user || {}
    await this.verificationService.approveVerification(id, reviewer)
    ctx.success(null, '审核通过')
  }

  /**
   * 驳回认证申请
   * @param {Object} ctx Koa 上下文
   */
  async reject(ctx) {
    const { id } = ctx.params
    // 审核人信息来自 JWT（jwtAuth 挂载到 ctx.state.user）
    const reviewer = ctx.state.user || {}
    await this.verificationService.rejectVerification(id, reviewer)
    ctx.success(null, '已驳回')
  }
}

module.exports = VerificationController
