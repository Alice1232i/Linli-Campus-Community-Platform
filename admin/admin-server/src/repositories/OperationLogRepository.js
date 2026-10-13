/**
 * OperationLogRepository - 操作日志仓储
 * ------------------------------------------------------------
 * 负责 operation_logs 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供多条件筛选查询、记录操作日志等操作。
 *
 * 合规要求：
 *   1. 日志只读追加，禁止修改/删除（无 update/delete 方法暴露）
 *   2. 日志表无 updated_at 字段，覆盖 insert 跳过自动填充
 *   3. 支持按管理员姓名模糊筛选
 */

const BaseRepository = require('./BaseRepository')

class OperationLogRepository extends BaseRepository {
  constructor() {
    super('operation_logs')
  }

  /**
   * 覆盖父类 insert：日志为只读追加，不填充 updated_at
   * 日志表无 updated_at 列，父类 insert 会自动添加该字段导致写入报错
   * @param {Object} data 日志数据（snake_case 字段）
   * @returns {Promise<string>} 插入记录的 id
   */
  async insert(data) {
    // 仅保留 created_at，不添加 updated_at
    const record = {
      ...data,
      created_at: data.created_at || Date.now()
    }
    return this.db.insert(this.collection, record)
  }

  /**
   * 多条件分页查询操作日志
   * 支持管理员 ID、管理员姓名、操作类型、目标类型、目标ID、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.adminId] 管理员 id
   * @param {string} [filters.adminName] 管理员姓名（模糊匹配）
   * @param {string} [filters.action] 操作类型
   * @param {string} [filters.targetType] 目标类型
   * @param {string} [filters.targetId] 目标 ID（精确匹配，用于按帖子ID查操作日志）
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    adminId,
    adminName,
    action,
    targetType,
    targetId,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 管理员 ID 精确筛选
    if (adminId) where.admin_id = adminId
    // 管理员姓名模糊筛选（支持部分匹配）
    if (adminName) where.admin_name = { $regex: adminName }
    // 操作类型筛选
    if (action) where.action = action
    // 目标类型筛选
    if (targetType) where.target_type = targetType
    // 目标 ID 精确筛选（用于按帖子ID查关联操作日志）
    if (targetId) where.target_id = targetId
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
   * 记录操作日志（合规审计专用入口）
   * 日志为只读追加，通过此方法写入，不暴露 update/delete 接口
   * @param {Object} data 日志数据，包含：
   *   admin_id、admin_name、action、target_type、target_id、
   *   before_data、after_data、request_body、method、path、ip、
   *   status_code、log_hash、created_at
   * @returns {Promise<string>} 插入记录的 id
   */
  async log(data) {
    const record = {
      ...data,
      created_at: data.created_at || Date.now()
    }
    return this.insert(record)
  }
}

module.exports = OperationLogRepository
