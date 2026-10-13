/**
 * MySQL 查询构建器
 * ------------------------------------------------------------
 * 将规范化查询条件转为 MySQL WHERE 子句（参数化，防 SQL 注入）。
 * 所有值通过占位符 ? 传递，不拼接 SQL 字符串。
 *
 * 支持的操作符（与 cloudQuery 对应）：
 *   { field: value }        → field = ?
 *   { field: { $gt: v } }   → field > ?
 *   { field: { $gte: v } }  → field >= ?
 *   { field: { $lt: v } }   → field < ?
 *   { field: { $lte: v } }  → field <= ?
 *   { field: { $ne: v } }   → field != ?
 *   { field: { $in: [...] } } → field IN (?, ?, ...)
 *   { field: { $like: v } }  → field LIKE ?
 *   { $or: [...] }          → (... OR ...)
 *   { $and: [...] }         → (... AND ...)
 */

/**
 * 构建单个条件的 SQL 片段
 * @param {string} field 字段名（已反引号包裹）
 * @param {*} condition 条件
 * @param {Array} params 参数数组（push 追加）
 * @returns {string} SQL 片段
 */
function buildCondition(field, condition, params) {
  // 操作符对象
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    const parts = []
    for (const [op, val] of Object.entries(condition)) {
      switch (op) {
        case '$gt':
          parts.push(`${field} > ?`)
          params.push(val)
          break
        case '$gte':
          parts.push(`${field} >= ?`)
          params.push(val)
          break
        case '$lt':
          parts.push(`${field} < ?`)
          params.push(val)
          break
        case '$lte':
          parts.push(`${field} <= ?`)
          params.push(val)
          break
        case '$ne':
          parts.push(`${field} != ?`)
          params.push(val)
          break
        case '$in':
          if (Array.isArray(val) && val.length > 0) {
            const placeholders = val.map(() => '?').join(', ')
            parts.push(`${field} IN (${placeholders})`)
            params.push(...val)
          }
          break
        case '$like':
          parts.push(`${field} LIKE ?`)
          params.push(val)
          break
        default:
          parts.push(`${field} = ?`)
          params.push(condition)
      }
    }
    return parts.join(' AND ')
  }

  // null 值用 IS NULL
  if (condition === null) {
    return `${field} IS NULL`
  }

  // 普通相等
  return `${field} = ?`
}

/**
 * 构建 WHERE 子句
 * @param {Object} where 规范化查询条件
 * @returns {{ clause: string, params: Array }}
 */
function buildWhere(where) {
  if (!where || Object.keys(where).length === 0) {
    return { clause: '', params: [] }
  }

  const parts = []
  const params = []

  for (const [key, value] of Object.entries(where)) {
    const field = `\`${key}\``

    if (key === '$or') {
      const orParts = value.map(w => {
        const r = buildWhere(w)
        params.push(...r.params)
        return `(${r.clause})`
      })
      parts.push(`(${orParts.join(' OR ')})`)
    } else if (key === '$and') {
      const andParts = value.map(w => {
        const r = buildWhere(w)
        params.push(...r.params)
        return `(${r.clause})`
      })
      parts.push(`(${andParts.join(' AND ')})`)
    } else {
      parts.push(buildCondition(field, value, params))
    }
  }

  return {
    clause: parts.join(' AND '),
    params
  }
}

/**
 * 构建 ORDER BY 子句
 * @param {Object} order { field: 'asc'|'desc' }
 * @returns {string}
 */
function buildOrderBy(order) {
  if (!order) return ''
  return Object.entries(order)
    .map(([field, dir]) => `\`${field}\` ${dir.toUpperCase()}`)
    .join(', ')
}

module.exports = {
  buildWhere,
  buildOrderBy
}
