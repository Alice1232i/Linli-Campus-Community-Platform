/**
 * PostRepository - 帖子仓储
 * ------------------------------------------------------------
 * 负责 posts 集合的数据访问，继承 BaseRepository 通用能力。
 * 额外提供多条件分页筛选、置顶/加精/状态切换等帖子管理操作。
 * 注意：统一使用规范字段名（id、created_at），不使用 _id / _openid。
 */

const BaseRepository = require('./BaseRepository')

class PostRepository extends BaseRepository {
  constructor() {
    super('posts')
  }

  /**
   * 多条件分页查询帖子
   * 支持状态、模块、版块、关键词（title 正则匹配）、时间范围筛选
   * @param {Object} filters 查询过滤条件
   * @param {string} [filters.status] 状态
   * @param {string} [filters.module] 模块
   * @param {string} [filters.section] 版块
   * @param {string} [filters.keyword] 关键词（按 title 正则匹配）
   * @param {number} [filters.startDate] 起始时间戳
   * @param {number} [filters.endDate] 截止时间戳
   * @param {number} [filters.page=1] 页码
   * @param {number} [filters.pageSize=20] 每页条数
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findWithFilters({
    status,
    module,
    section,
    keyword,
    startDate,
    endDate,
    sortOrder,
    page = 1,
    pageSize = 20
  }) {
    const where = {}

    // 状态筛选：未传 status 时默认排除已删除的帖子，管理员可显式筛选 deleted 查看
    if (status) {
      where.status = status
    } else {
      where.status = { $ne: 'deleted' }
    }
    // 模块筛选
    if (module) where.module = module
    // 版块筛选
    if (section) where.section = section
    // 关键词搜索（title 正则匹配）
    if (keyword) where.title = { $regex: keyword }
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
   * 切换置顶状态
   * @param {string} id 帖子 id
   * @param {boolean} isTop 是否置顶
   * @returns {Promise<number>} 受影响行数
   */
  async toggleTop(id, isTop) {
    return this.updateById(id, { is_top: isTop })
  }

  /**
   * 切换加精状态
   * @param {string} id 帖子 id
   * @param {boolean} isEssence 是否加精
   * @returns {Promise<number>} 受影响行数
   */
  async toggleEssence(id, isEssence) {
    return this.updateById(id, { is_essence: isEssence })
  }

  /**
   * 更新帖子状态
   * @param {string} id 帖子 id
   * @param {string} status 状态
   * @returns {Promise<number>} 受影响行数
   */
  async updateStatus(id, status) {
    return this.updateById(id, { status })
  }
}

module.exports = PostRepository
