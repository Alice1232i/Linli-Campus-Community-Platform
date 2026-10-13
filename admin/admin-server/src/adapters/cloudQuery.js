/**
 * 云数据库 query 语句构建器
 * ------------------------------------------------------------
 * 将规范化的查询条件（{ field: value }）转为微信云数据库 where 子句。
 * 云数据库 HTTP API 的 where() 接收 JavaScript 对象字面量。
 *
 * 输出格式为 JSON 对象字符串，如：{"username":"admin","status":"active"}
 *
 * 支持的操作符：
 *   { field: value }          → {"field": value}
 *   { field: { $gt: v } }     → {"field": {"$gt": v}}
 *   { field: { $gte: v } }    → {"field": {"$gte": v}}
 *   { field: { $lt: v } }     → {"field": {"$lt": v}}
 *   { field: { $lte: v } }    → {"field": {"$lte": v}}
 *   { field: { $ne: v } }     → {"field": {"$ne": v}}
 *   { field: { $in: [...] } } → {"field": {"$in": [...]}}
 *   { field: { $regex: v } }  → {"field": db.RegExp({"regexp": v, "options": "i"})}
 *   { $or: [...] }            → {"$or": [...]}
 *   { $and: [...] }           → {"$and": [...]}
 */

/**
 * 将 JS 值转为 JS 对象字面量中的值表示
 * - 字符串/数字/布尔/null：JSON.stringify
 * - 对象/数组：递归处理
 */
function toValue(value) {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(toValue).join(',') + ']'
  }
  if (typeof value === 'object') {
    return toObject(value)
  }
  return JSON.stringify(value)
}

/**
 * 将操作符对象转为 JS 对象字面量
 * 处理 $gt/$gte/$lt/$lte/$ne/$in/$regex 等操作符
 */
function toObject(obj) {
  const parts = []
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$regex') {
      // 正则匹配用 db.RegExp
      parts.push(`"$regex":db.RegExp({"regexp":${JSON.stringify(val)},"options":"i"})`)
    } else if (key.startsWith('$')) {
      // 其他操作符保持 $ 前缀
      parts.push(`"${key}":${toValue(val)}`)
    } else {
      parts.push(`"${key}":${toValue(val)}`)
    }
  }
  return '{' + parts.join(',') + '}'
}

/**
 * 构建完整 where 子句（JSON 对象字符串）
 * @param {Object} where 规范化查询条件
 * @returns {string} JSON 对象字符串，如 {"username":"admin"}
 */
function buildQuery(where) {
  if (!where || Object.keys(where).length === 0) {
    return '{}'
  }

  const parts = []
  for (const [key, value] of Object.entries(where)) {
    if (key === '$or') {
      // $or: [{a:1}, {b:2}] → "$or":[{"a":1},{"b":2}]
      const arrStr = value.map(w => buildQuery(w)).join(',')
      parts.push(`"$or":[${arrStr}]`)
    } else if (key === '$and') {
      const arrStr = value.map(w => buildQuery(w)).join(',')
      parts.push(`"$and":[${arrStr}]`)
    } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))) {
      // 操作符对象 {field: {$gt: 5}}
      parts.push(`"${key}":${toObject(value)}`)
    } else {
      // 普通值
      parts.push(`"${key}":${toValue(value)}`)
    }
  }
  return '{' + parts.join(',') + '}'
}

/**
 * 构建排序字符串
 * 云数据库语法：field asc 或 field desc
 * @param {Object} order { field: 'asc'|'desc' }
 * @returns {string}
 */
function buildOrder(order) {
  if (!order) return ''
  return Object.entries(order)
    .map(([field, dir]) => `"${field}","${dir}"`)
    .join(',')
}

module.exports = {
  buildQuery,
  buildOrder,
  toValue
}
