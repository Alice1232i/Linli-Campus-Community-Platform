/**
 * MySqlAdapter - MySQL 数据库适配器
 * ------------------------------------------------------------
 * 实现 IDbAdapter 接口，使用 mysql2/promise 操作 MySQL。
 *
 * 因为 MySQL 表结构本身已是规范化设计（id 主键、拍平字段），
 * 所以这里不需要字段映射转换，直接使用规范字段。
 *
 * 切换数据库：只需改 .env 中 DB_TYPE=mysql 即可。
 */

const { getPool } = require('../db/mysqlPool')
const { buildWhere, buildOrderBy } = require('./mysqlQueryBuilder')
const IDbAdapter = require('./IDbAdapter')

class MySqlAdapter extends IDbAdapter {
  constructor() {
    super()
  }

  /**
   * 获取连接池（懒加载）
   */
  get pool() {
    return getPool()
  }

  /**
   * 执行查询
   * @param {string} sql SQL 语句
   * @param {Array} params 参数
   * @returns {Promise<Array>} 结果行数组
   */
  async query(sql, params) {
    const [rows] = await this.pool.query(sql, params)
    return rows
  }

  /**
   * 执行写操作
   * @param {string} sql SQL 语句
   * @param {Array} params 参数
   * @returns {Promise<Object>} 执行结果（含 affectedRows 等）
   */
  async execute(sql, params) {
    const [result] = await this.pool.execute(sql, params)
    return result
  }

  // ========== IDbAdapter 接口实现 ==========

  async findOne(collection, where) {
    const { clause, params } = buildWhere(where)
    const sql = `SELECT * FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''} LIMIT 1`
    const rows = await this.query(sql, params)
    return rows[0] || null
  }

  async find(collection, options = {}) {
    const { where = {}, order, page = 1, pageSize = 20 } = options
    const { clause, params } = buildWhere(where)

    // 计数
    const countSql = `SELECT COUNT(*) as total FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''}`
    const countRows = await this.query(countSql, params)
    const total = countRows[0].total

    // 查询数据
    const offset = (page - 1) * pageSize
    let sql = `SELECT * FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''}`
    if (order) {
      sql += ` ORDER BY ${buildOrderBy(order)}`
    }
    sql += ` LIMIT ? OFFSET ?`
    params.push(pageSize, offset)

    const rows = await this.query(sql, params)
    return { list: rows, total, page, pageSize }
  }

  async findAll(collection, where = {}, order) {
    const { clause, params } = buildWhere(where)
    let sql = `SELECT * FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''}`
    if (order) {
      sql += ` ORDER BY ${buildOrderBy(order)}`
    }
    return await this.query(sql, params)
  }

  async insert(collection, data) {
    const fields = Object.keys(data)
    const values = Object.values(data)
    const placeholders = fields.map(() => '?').join(', ')
    const fieldList = fields.map(f => `\`${f}\``).join(', ')

    const sql = `INSERT INTO \`${collection}\` (${fieldList}) VALUES (${placeholders})`
    const result = await this.execute(sql, values)
    return result.insertId
  }

  async update(collection, where, data) {
    const { clause, params } = buildWhere(where)
    const setFields = Object.keys(data).map(f => `\`${f}\` = ?`).join(', ')
    const setValues = Object.values(data)

    const sql = `UPDATE \`${collection}\` SET ${setFields} ${clause ? 'WHERE ' + clause : ''}`
    const result = await this.execute(sql, [...setValues, ...params])
    return result.affectedRows
  }

  async updateById(collection, id, data) {
    return this.update(collection, { id }, data)
  }

  async remove(collection, where) {
    const { clause, params } = buildWhere(where)
    const sql = `DELETE FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''}`
    const result = await this.execute(sql, params)
    return result.affectedRows
  }

  async removeById(collection, id) {
    return this.remove(collection, { id })
  }

  async count(collection, where = {}) {
    const { clause, params } = buildWhere(where)
    const sql = `SELECT COUNT(*) as total FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''}`
    const rows = await this.query(sql, params)
    return rows[0].total
  }

  async aggregateCount(collection, groupField, where = {}) {
    const { clause, params } = buildWhere(where)
    const sql = `SELECT \`${groupField}\` as _id, COUNT(*) as count FROM \`${collection}\` ${clause ? 'WHERE ' + clause : ''} GROUP BY \`${groupField}\``
    return await this.query(sql, params)
  }

  async increment(collection, where, field, inc = 1) {
    const { clause, params } = buildWhere(where)
    const sql = `UPDATE \`${collection}\` SET \`${field}\` = \`${field}\` + ? ${clause ? 'WHERE ' + clause : ''}`
    const result = await this.execute(sql, [inc, ...params])
    return result.affectedRows
  }
}

module.exports = MySqlAdapter
