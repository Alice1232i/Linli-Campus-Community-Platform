/**
 * IDbAdapter - 数据库适配器接口契约（JSDoc）
 * ------------------------------------------------------------
 * 所有数据库适配器（CloudDbAdapter / MySqlAdapter）必须实现此接口。
 * Repository 层只依赖此接口，不感知具体数据库类型。
 *
 * 接口约定：
 * - 所有方法返回 Promise
 * - 查询条件统一使用规范字段名（id 而非 _id）
 * - 返回的数据已规范化（_id → id，嵌套对象拍平）
 * - 分页参数统一为 { page, pageSize }
 * - 时间统一为毫秒时间戳（number）
 */

/**
 * @typedef {Object} QueryOptions
 * @property {Object} where - 查询条件（规范字段名）
 * @property {Object} [order] - 排序 { field: 'asc'|'desc' }
 * @property {number} [page] - 页码（从1开始）
 * @property {number} [pageSize] - 每页条数
 * @property {Array<string>} [fields] - 只返回指定字段
 */

/**
 * @typedef {Object} PageResult
 * @property {Array} list - 数据列表
 * @property {number} total - 总记录数
 * @property {number} page - 当前页码
 * @property {number} pageSize - 每页条数
 */

class IDbAdapter {
  /**
   * 查询单条记录
   * @param {string} collection 集合/表名
   * @param {Object} where 查询条件
   * @returns {Promise<Object|null>}
   */
  async findOne(collection, where) {
    throw new Error('IDbAdapter.findOne 未实现')
  }

  /**
   * 查询多条记录（带分页）
   * @param {string} collection
   * @param {QueryOptions} options
   * @returns {Promise<PageResult>}
   */
  async find(collection, options) {
    throw new Error('IDbAdapter.find 未实现')
  }

  /**
   * 查询全部记录（不分页，慎用，数据量大时用 find）
   * @param {string} collection
   * @param {Object} where
   * @param {Object} [order]
   * @returns {Promise<Array>}
   */
  async findAll(collection, where, order) {
    throw new Error('IDbAdapter.findAll 未实现')
  }

  /**
   * 插入一条记录
   * @param {string} collection
   * @param {Object} data 规范化字段数据
   * @returns {Promise<string>} 插入记录的 id
   */
  async insert(collection, data) {
    throw new Error('IDbAdapter.insert 未实现')
  }

  /**
   * 更新记录
   * @param {string} collection
   * @param {Object} where 更新条件
   * @param {Object} data 更新数据（规范字段）
   * @returns {Promise<number>} 受影响行数
   */
  async update(collection, where, data) {
    throw new Error('IDbAdapter.update 未实现')
  }

  /**
   * 按 id 更新单条记录
   * @param {string} collection
   * @param {string} id
   * @param {Object} data
   * @returns {Promise<number>} 受影响行数
   */
  async updateById(collection, id, data) {
    throw new Error('IDbAdapter.updateById 未实现')
  }

  /**
   * 删除记录
   * @param {string} collection
   * @param {Object} where
   * @returns {Promise<number>} 删除行数
   */
  async remove(collection, where) {
    throw new Error('IDbAdapter.remove 未实现')
  }

  /**
   * 按 id 删除单条记录
   * @param {string} collection
   * @param {string} id
   * @returns {Promise<number>}
   */
  async removeById(collection, id) {
    throw new Error('IDbAdapter.removeById 未实现')
  }

  /**
   * 统计记录数
   * @param {string} collection
   * @param {Object} where
   * @returns {Promise<number>}
   */
  async count(collection, where) {
    throw new Error('IDbAdapter.count 未实现')
  }

  /**
   * 聚合统计（按字段分组计数）
   * @param {string} collection
   * @param {string} groupField 分组字段
   * @param {Object} [where] 过滤条件
   * @returns {Promise<Array<{_id: string, count: number}>>}
   */
  async aggregateCount(collection, groupField, where) {
    throw new Error('IDbAdapter.aggregateCount 未实现')
  }

  /**
   * 原子自增操作（如统计计数 +1）
   * @param {string} collection
   * @param {Object} where
   * @param {string} field 要自增的字段
   * @param {number} [inc=1] 增量值
   * @returns {Promise<number>} 受影响行数
   */
  async increment(collection, where, field, inc = 1) {
    throw new Error('IDbAdapter.increment 未实现')
  }
}

module.exports = IDbAdapter
