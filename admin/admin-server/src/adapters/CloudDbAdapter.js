/**
 * CloudDbAdapter - 微信云数据库 HTTP API 适配器
 * ------------------------------------------------------------
 * 实现 IDbAdapter 接口，通过微信云数据库 HTTP API 进行 CRUD。
 *
 * 核心职责：
 * 1. 调用云数据库 HTTP API 完成增删改查
 * 2. 出入适配器时做字段规范化转换（_id → id、嵌套拍平）
 * 3. 查询结果中的 cloud:// 图片 URL 通过 batchdownloadfile API 转换为临时 HTTPS 下载链接
 * 4. 业务层永远不接触 Mongo 风格字段
 *
 * 切换 MySQL 时，只需改 DB_TYPE=mysql，
 * Repository 注入 MySqlAdapter，业务层零感知。
 */

const axios = require('axios')
const https = require('https')
const config = require('../config')
const cloudToken = require('./cloudToken')
const { buildQuery, buildOrder } = require('./cloudQuery')
const { getFieldMap, getReverseFieldMap, isArrayField } = require('./fieldMapping')
const { resolveCloudUrls, resolveCloudUrlsBatch } = require('../utils/cloudFile')
const IDbAdapter = require('./IDbAdapter')

/** 云数据库 API 基础 URL */
const BASE_URL = 'https://api.weixin.qq.com/tcb'

// 开发环境跳过 SSL 证书校验
const httpsAgent = config.isDev
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined

class CloudDbAdapter extends IDbAdapter {
  constructor() {
    super()
    this.envId = config.db.cloud.envId
  }

  /**
   * 调用云数据库 HTTP API
   * @param {string} endpoint 端点名（如 databasequery）
   * @param {Object} body 请求体
   * @returns {Promise<Object>} 响应数据
   */
  async callApi(endpoint, body) {
    return this._callApiWithRetry(endpoint, body, 0)
  }

  /**
   * 调用云数据库 HTTP API（带 token 失效自动恢复）
   * 微信 access_token 同一时刻仅「最新」有效，若被其他进程/脚本刷新顶掉，
   * 会返回 40001 invalid credential。此时强制清缓存刷新并重试一次，
   * 避免服务在 token 被顶后持续失败（此前需等 2 小时自然过期才恢复）。
   * @param {string} endpoint 端点名
   * @param {Object} body 请求体
   * @param {number} retried 已重试次数（0=首次，1=已重试一次）
   * @returns {Promise<Object>}
   */
  async _callApiWithRetry(endpoint, body, retried) {
    const token = await cloudToken.getAccessToken()
    const url = `${BASE_URL}/${endpoint}?access_token=${token}`
    const res = await axios.post(url, {
      env: this.envId,
      ...body
    }, { timeout: 15000, httpsAgent })

    if (res.data.errcode) {
      // 40001 invalid credential / 42001 access_token expired：强制刷新 token 后重试一次
      if (!retried && (res.data.errcode === 40001 || res.data.errcode === 42001)) {
        cloudToken.clearCache()
        return this._callApiWithRetry(endpoint, body, 1)
      }
      throw new Error(`云数据库API错误 [${endpoint}]: [${res.data.errcode}] ${res.data.errmsg}`)
    }
    return res.data
  }

  // ========== 字段规范化转换 ==========

  /**
   * 将云数据库原始文档规范化为业务层使用格式
   * - _id → id
   * - _openid → openid
   * - 嵌套对象拍平（stats.likes → like_count）
   * 注意：cloud:// URL 的异步转换在 findOne/find/findAll 中处理
   * @param {Object} doc 云数据库原始文档
   * @param {string} collection 集合名
   * @returns {Object} 规范化文档
   */
  normalize(doc, collection) {
    if (!doc) return null
    const fieldMap = getFieldMap(collection)
    const result = {}

    // 构建反向查找表：规范化字段名 → 原始字段名列表（仅非嵌套映射）
    // 用于处理数据库文档中同时存在驼峰(isTop)和蛇形(is_top)字段的脏数据场景
    // 优先使用 fieldMap 中定义的源字段（驼峰），跳过同名的脏数据字段（蛇形）
    const normKeyToOrigKeys = {}
    for (const [origKey, normKey] of Object.entries(fieldMap)) {
      if (!origKey.includes('.')) {
        // 自映射（origKey === normKey，如 users 的 'openid':'openid'）不是脏数据，
        // 不参与「跳过同名脏数据字段」逻辑，否则正常字段会被误跳过导致 openid 丢失
        if (origKey === normKey) continue
        if (!normKeyToOrigKeys[normKey]) {
          normKeyToOrigKeys[normKey] = []
        }
        normKeyToOrigKeys[normKey].push(origKey)
      }
    }

    for (const [origKey, value] of Object.entries(doc)) {
      // 若当前字段名恰好是某个映射的目标（规范化名），
      // 且其源字段（原始名）也存在于文档中，则跳过此脏数据字段，
      // 优先使用映射源字段的值（后续循环会用 fieldMap 映射覆盖）
      const sources = normKeyToOrigKeys[origKey]
      if (sources && sources.some(s => Object.prototype.hasOwnProperty.call(doc, s))) {
        continue
      }
      // 查找映射的规范字段名
      const normKey = fieldMap[origKey] || origKey
      result[normKey] = value
    }

    // 处理嵌套字段拍平（如 stats.likes → like_count）
    for (const [origPath, normKey] of Object.entries(fieldMap)) {
      if (origPath.includes('.')) {
        const parts = origPath.split('.')
        let val = doc
        for (const p of parts) {
          val = val && val[p]
        }
        if (val !== undefined) {
          result[normKey] = val
        }
      }
    }

    // 移除已拍平的嵌套对象（避免数据冗余）
    for (const [origPath] of Object.entries(fieldMap)) {
      if (origPath.includes('.')) {
        const topKey = origPath.split('.')[0]
        delete result[topKey]
      }
    }

    return result
  }

  /**
   * 将规范化字段反向转换为云数据库格式
   * - id → _id
   * - openid → _openid
   * - 拍平字段还原为嵌套对象（like_count → stats.likes）
   * @param {Object} data 规范化字段数据
   * @param {string} collection 集合名
   * @returns {Object} 云数据库格式文档
   */
  denormalize(data, collection) {
    const reverseMap = getReverseFieldMap(collection)
    const result = {}

    for (const [normKey, value] of Object.entries(data)) {
      const origKey = reverseMap[normKey] || normKey

      if (origKey.includes('.')) {
        // 嵌套字段还原：like_count → stats.likes
        const parts = origKey.split('.')
        let obj = result
        for (let i = 0; i < parts.length - 1; i++) {
          obj[parts[i]] = obj[parts[i]] || {}
          obj = obj[parts[i]]
        }
        obj[parts[parts.length - 1]] = value
      } else {
        result[origKey] = value
      }
    }

    return result
  }

  // ========== IDbAdapter 接口实现 ==========

  async findOne(collection, where) {
    const query = buildQuery(this.denormalizeWhere(where, collection))
    const res = await this.callApi('databasequery', {
      query: `db.collection("${collection}").where(${query}).limit(1).get()`
    })

    if (!res.data || res.data.length === 0) return null
    const doc = JSON.parse(res.data[0])
    const result = this.normalize(doc, collection)

    // 异步转换 cloud:// 图片 URL 为临时 HTTPS 下载链接
    if (result) {
      await resolveCloudUrls(result)
    }

    return result
  }

  async find(collection, options = {}) {
    const { where = {}, order, page = 1, pageSize = 20 } = options
    const normWhere = this.denormalizeWhere(where, collection)
    const normOrder = this.denormalizeOrder(order, collection)
    const query = buildQuery(normWhere)

    // 计数
    const countRes = await this.callApi('databasecount', {
      query: `db.collection("${collection}").where(${query}).count()`
    })
    const total = countRes.count || 0

    // 查询数据
    const skip = (page - 1) * pageSize
    let queryStr = `db.collection("${collection}").where(${query})`
    if (normOrder) {
      queryStr += `.orderBy(${buildOrder(normOrder)})`
    }
    queryStr += `.skip(${skip}).limit(${pageSize}).get()`

    const res = await this.callApi('databasequery', { query: queryStr })
    const list = (res.data || []).map(item => {
      const doc = JSON.parse(item)
      return this.normalize(doc, collection)
    })

    // 批量异步转换 cloud:// 图片 URL 为临时 HTTPS 下载链接
    await resolveCloudUrlsBatch(list)

    return { list, total, page, pageSize }
  }

  async findAll(collection, where = {}, order) {
    const normWhere = this.denormalizeWhere(where, collection)
    const normOrder = this.denormalizeOrder(order, collection)
    const query = buildQuery(normWhere)

    // 云数据库单次查询上限 100 条，需循环获取
    const allData = []
    let skip = 0
    const limit = 100

    while (true) {
      let queryStr = `db.collection("${collection}").where(${query})`
      if (normOrder) {
        queryStr += `.orderBy(${buildOrder(normOrder)})`
      }
      queryStr += `.skip(${skip}).limit(${limit}).get()`

      const res = await this.callApi('databasequery', { query: queryStr })
      const batch = (res.data || []).map(item => {
        const doc = JSON.parse(item)
        return this.normalize(doc, collection)
      })

      allData.push(...batch)
      if (batch.length < limit) break
      skip += limit
    }

    // 批量异步转换 cloud:// 图片 URL 为临时 HTTPS 下载链接
    await resolveCloudUrlsBatch(allData)

    return allData
  }

  async insert(collection, data) {
    const doc = this.denormalize(data, collection)
    // 云数据库 add 操作
    const res = await this.callApi('databaseadd', {
      query: `db.collection("${collection}").add({ data: ${JSON.stringify(doc)} })`
    })

    if (res.id_list && res.id_list.length > 0) {
      return res.id_list[0]
    }
    return res.id || ''
  }

  async update(collection, where, data) {
    const normWhere = this.denormalizeWhere(where, collection)
    const query = buildQuery(normWhere)
    const doc = this.denormalize(data, collection)

    const res = await this.callApi('databaseupdate', {
      query: `db.collection("${collection}").where(${query}).update({ data: ${JSON.stringify(doc)} })`
    })

    return res.stats ? res.stats.updated : 0
  }

  async updateById(collection, id, data) {
    // 云数据库按 _id 更新
    const doc = this.denormalize(data, collection)
    const res = await this.callApi('databaseupdate', {
      query: `db.collection("${collection}").doc("${id}").update({ data: ${JSON.stringify(doc)} })`
    })
    return res.stats ? res.stats.updated : 0
  }

  async remove(collection, where) {
    const normWhere = this.denormalizeWhere(where, collection)
    const query = buildQuery(normWhere)

    const res = await this.callApi('databasedelete', {
      query: `db.collection("${collection}").where(${query}).remove()`
    })
    return res.stats ? res.stats.removed : 0
  }

  async removeById(collection, id) {
    const res = await this.callApi('databasedelete', {
      query: `db.collection("${collection}").doc("${id}").remove()`
    })
    return res.stats ? res.stats.removed : 0
  }

  async count(collection, where = {}) {
    const normWhere = this.denormalizeWhere(where, collection)
    const query = buildQuery(normWhere)

    const res = await this.callApi('databasecount', {
      query: `db.collection("${collection}").where(${query}).count()`
    })
    return res.count || 0
  }

  async aggregateCount(collection, groupField, where = {}) {
    const normWhere = this.denormalizeWhere(where, collection)
    const matchStr = buildQuery(normWhere)

    // 使用聚合管道
    const query = `db.collection("${collection}")
      .aggregate()
      .match(${JSON.stringify(normWhere)})
      .group({ _id: '$' + groupField, count: $.sum(1) })
      .end()`

    const res = await this.callApi('databaseaggregate', { query })
    return (res.data || []).map(item => {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item
      return { _id: parsed._id, count: parsed.count }
    })
  }

  async increment(collection, where, field, inc = 1) {
    const normWhere = this.denormalizeWhere(where, collection)
    const query = buildQuery(normWhere)

    // 云数据库使用 $inc 命令
    const res = await this.callApi('databaseupdate', {
      query: `db.collection("${collection}").where(${query}).update({ data: { ${field}: db.command.inc(${inc}) } })`
    })
    return res.stats ? res.stats.updated : 0
  }

  /**
   * 将规范化查询条件转为云数据库格式
   * 例如 { id: 'xxx' } → { _id: 'xxx' }
   */
  denormalizeWhere(where, collection) {
    return this.denormalize(where, collection)
  }

  /**
   * 排序字段名映射：规范化字段（蛇形）→ 云数据库原始字段（驼峰）
   * 例如 created_at → createdAt，确保 orderBy 使用正确的云数据库字段名
   * @param {Object} order { field: 'asc'|'desc' }
   * @param {string} collection 集合名
   * @returns {Object} 映射后的 order
   */
  denormalizeOrder(order, collection) {
    if (!order) return null
    const reverseMap = getReverseFieldMap(collection)
    const result = {}
    for (const [normKey, dir] of Object.entries(order)) {
      const origKey = reverseMap[normKey] || normKey
      // orderBy 不支持嵌套路径，取最后一段作为字段名
      const fieldName = origKey.includes('.') ? origKey.split('.').pop() : origKey
      result[fieldName] = dir
    }
    return result
  }
}

module.exports = CloudDbAdapter
