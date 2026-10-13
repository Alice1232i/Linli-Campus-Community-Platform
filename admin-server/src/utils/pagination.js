/**
 * 分页参数解析工具
 * ------------------------------------------------------------
 * 统一解析查询参数中的分页信息，规范 page / pageSize 取值范围，
 * 并计算数据库查询所需的 offset 偏移量。
 *
 * 适配器层（IDbAdapter）分页参数统一为 { page, pageSize }，
 * offset 用于 SQL 场景下的 LIMIT offset, pageSize。
 */

/** 默认页码（从 1 开始） */
const DEFAULT_PAGE = 1
/** 默认每页条数 */
const DEFAULT_PAGE_SIZE = 20
/** 每页最大条数，防止前端一次性拉取过多数据导致性能问题 */
const MAX_PAGE_SIZE = 100

/**
 * 解析分页参数
 * @param {Object} query 请求查询对象（ctx.query）
 * @returns {{ page: number, pageSize: number, offset: number }}
 *   page     - 页码（从 1 开始）
 *   pageSize - 每页条数
 *   offset   - 数据库查询偏移量 = (page - 1) * pageSize
 */
function parsePagination(query) {
  // 解析页码，非法值（非数字 / 小于 1）回退到默认值
  let page = parseInt(query && query.page, 10)
  if (!Number.isFinite(page) || page < 1) {
    page = DEFAULT_PAGE
  }

  // 解析每页条数，非法值回退到默认值
  let pageSize = parseInt(query && query.pageSize, 10)
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    pageSize = DEFAULT_PAGE_SIZE
  }
  // 超过上限则截断为最大值
  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE
  }

  // 计算偏移量：第 1 页从 0 开始
  const offset = (page - 1) * pageSize

  return { page, pageSize, offset }
}

module.exports = {
  parsePagination,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
}
