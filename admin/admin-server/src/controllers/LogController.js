/**
 * LogController - 操作日志控制器
 * ------------------------------------------------------------
 * 处理操作日志列表查询的 HTTP 请求。
 * 操作日志的写入由 operationLogger 中间件自动完成，本控制器仅提供查询能力。
 */

const LogService = require('../services/LogService')
const { parsePagination } = require('../utils/pagination')

class LogController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.logService = new LogService()
  }

  /**
   * 分页查询操作日志列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，支持按操作人（ID或姓名）/ 操作类型 / 目标类型 / 目标ID / 时间范围过滤
    const filters = {
      adminId: query.adminId,
      adminName: query.adminName,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.logService.getLogs(filters)
    ctx.success(result)
  }
}

module.exports = LogController
