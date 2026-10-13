/**
 * LogService - 操作日志服务
 * ------------------------------------------------------------
 * 负责操作日志的查询业务。
 * 操作日志的写入由 operationLogger 中间件自动完成，本服务仅提供查询能力。
 */

const OperationLogRepository = require('../repositories/OperationLogRepository')

class LogService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.operationLogRepo = new OperationLogRepository()
  }

  /**
   * 分页查询操作日志列表
   * @param {Object} filters 过滤条件（adminId / action / targetType / 时间范围 / 分页）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getLogs(filters) {
    return this.operationLogRepo.findWithFilters(filters)
  }
}

module.exports = LogService
