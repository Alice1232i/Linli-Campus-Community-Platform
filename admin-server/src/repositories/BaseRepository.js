/**
 * BaseRepository - 仓储基类
 * ------------------------------------------------------------
 * 封装通用的 CRUD + 分页查询逻辑，各实体 Repository 继承此类。
 * 所有数据库操作通过 dbAdapter（IDbAdapter 接口）完成，
 * 不直接接触任何数据库 SDK，实现数据库无关性。
 *
 * 业务 Service 层只调用 Repository 方法，不感知数据库类型。
 */

const dbAdapter = require('../adapters')

class BaseRepository {
  /**
   * @param {string} collection 集合/表名
   */
  constructor(collection) {
    this.collection = collection
    this.db = dbAdapter
  }

  /**
   * 按 id 查询单条记录
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return this.db.findOne(this.collection, { id })
  }

  /**
   * 按条件查询单条记录
   * @param {Object} where
   * @returns {Promise<Object|null>}
   */
  async findOne(where) {
    return this.db.findOne(this.collection, where)
  }

  /**
   * 分页查询
   * @param {Object} [where] 查询条件
   * @param {Object} [order] 排序
   * @param {number} [page=1]
   * @param {number} [pageSize=20]
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async findPage(where = {}, order, page = 1, pageSize = 20) {
    return this.db.find(this.collection, { where, order, page, pageSize })
  }

  /**
   * 查询全部（不分页，数据量大时慎用）
   * @param {Object} [where]
   * @param {Object} [order]
   * @returns {Promise<Array>}
   */
  async findAll(where = {}, order) {
    return this.db.findAll(this.collection, where, order)
  }

  /**
   * 插入记录
   * @param {Object} data 规范化字段
   * @returns {Promise<string>} 插入记录的 id
   */
  async insert(data) {
    const now = Date.now()
    const record = {
      ...data,
      created_at: now,
      updated_at: now
    }
    return this.db.insert(this.collection, record)
  }

  /**
   * 按 id 更新
   * @param {string} id
   * @param {Object} data 更新字段
   * @returns {Promise<number>} 受影响行数
   */
  async updateById(id, data) {
    const record = {
      ...data,
      updated_at: Date.now()
    }
    return this.db.updateById(this.collection, id, record)
  }

  /**
   * 按条件更新
   * @param {Object} where
   * @param {Object} data
   * @returns {Promise<number>}
   */
  async update(where, data) {
    const record = {
      ...data,
      updated_at: Date.now()
    }
    return this.db.update(this.collection, where, record)
  }

  /**
   * 按 id 删除
   * @param {string} id
   * @returns {Promise<number>}
   */
  async removeById(id) {
    return this.db.removeById(this.collection, id)
  }

  /**
   * 按条件删除
   * @param {Object} where
   * @returns {Promise<number>}
   */
  async remove(where) {
    return this.db.remove(this.collection, where)
  }

  /**
   * 统计记录数
   * @param {Object} [where]
   * @returns {Promise<number>}
   */
  async count(where = {}) {
    return this.db.count(this.collection, where)
  }

  /**
   * 按字段分组计数
   * @param {string} groupField
   * @param {Object} [where]
   * @returns {Promise<Array<{_id: string, count: number}>>}
   */
  async aggregateCount(groupField, where = {}) {
    return this.db.aggregateCount(this.collection, groupField, where)
  }

  /**
   * 原子自增
   * @param {Object} where
   * @param {string} field
   * @param {number} [inc=1]
   * @returns {Promise<number>}
   */
  async increment(where, field, inc = 1) {
    return this.db.increment(this.collection, where, field, inc)
  }
}

module.exports = BaseRepository
