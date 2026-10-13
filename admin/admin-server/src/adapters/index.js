/**
 * 适配器工厂 - 按 DB_TYPE 选择数据库适配器
 * ------------------------------------------------------------
 * 上层（Repository）只需 require 本模块，获取 dbAdapter 单例。
 * 切换数据库时，只改 .env 中 DB_TYPE，无需改任何业务代码。
 *
 * 使用方式：
 *   const dbAdapter = require('./adapters')
 *   await dbAdapter.find('posts', { where: { status: 'normal' } })
 */

const config = require('../config')
const IDbAdapter = require('./IDbAdapter')

/** 适配器单例（懒加载） */
let adapter = null

/**
 * 根据配置创建适配器实例
 * @returns {IDbAdapter}
 */
function createAdapter() {
  switch (config.db.type) {
    case 'cloud':
      // 懒加载，避免 mysql 模式下加载无用的云数据库模块
      const CloudDbAdapter = require('./CloudDbAdapter')
      return new CloudDbAdapter()

    case 'mysql':
      const MySqlAdapter = require('./MySqlAdapter')
      return new MySqlAdapter()

    default:
      throw new Error(`不支持的 DB_TYPE: ${config.db.type}，仅支持 cloud 或 mysql`)
  }
}

/**
 * 获取适配器单例
 * @returns {IDbAdapter}
 */
function getAdapter() {
  if (!adapter) {
    adapter = createAdapter()
  }
  return adapter
}

module.exports = getAdapter()
