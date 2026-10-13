/**
 * MySQL 连接池
 * ------------------------------------------------------------
 * 使用 mysql2/promise 创建连接池，支持 Promise 异步操作。
 * 仅在 DB_TYPE=mysql 时初始化。
 */

const mysql = require('mysql2/promise')
const config = require('../config')

/** 连接池单例（懒加载） */
let pool = null

/**
 * 获取 MySQL 连接池
 * 单例模式，首次调用时创建
 * @returns {mysql.Pool}
 */
function getPool() {
  if (!pool) {
    const { host, port, user, password, database, connectionLimit } = config.db.mysql
    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      connectionLimit,
      charset: 'utf8mb4',
      timezone: '+08:00',
      // 支持存储过程和多语句
      multipleStatements: false
    })
  }
  return pool
}

/**
 * 关闭连接池（用于优雅退出）
 */
async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

module.exports = {
  getPool,
  closePool
}
