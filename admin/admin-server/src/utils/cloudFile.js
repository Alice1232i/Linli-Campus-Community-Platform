/**
 * 微信云存储文件 URL 转换工具
 * ------------------------------------------------------------
 * 通过微信云开发 HTTP API（batchdownloadfile）获取 cloud:// 文件的临时下载链接。
 * cloud:// 文件受云存储安全规则保护，不能直接拼接 URL 访问，
 * 必须通过 API 获取临时 HTTPS 下载链接（有效期 2 小时）。
 *
 * API: https://api.weixin.qq.com/tcb/batchdownloadfile
 *   请求: { env, file_list: [{ fileid, max_age }] }
 *   响应: { file_list: [{ fileid, download_url, status, errmsg }] }
 */

const axios = require('axios')
const https = require('https')
const config = require('../config')
const cloudToken = require('../adapters/cloudToken')

// 开发环境跳过 SSL 证书校验
const httpsAgent = config.isDev
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined

/** 云开发 API 基础 URL */
const BASE_URL = 'https://api.weixin.qq.com/tcb'

/** 临时 URL 有效期（秒），2 小时 */
const MAX_AGE = 7200

/** 默认需要检查的图片字段（含举报证据 evidence） */
const TARGET_FIELDS = ['images', 'avatar', 'cover', 'thumbnail', 'evidence']

/**
 * 从对象中收集所有 cloud:// 的 fileID
 * @param {Object} obj 待处理对象
 * @param {string[]} fields 需要检查的字段名列表
 * @returns {Array<string>} cloud:// fileID 列表（去重）
 */
function collectCloudFileIds(obj, fields) {
  const fileIds = []
  const targetFields = fields || TARGET_FIELDS

  for (const field of targetFields) {
    if (!(field in obj)) continue

    if (Array.isArray(obj[field])) {
      for (const url of obj[field]) {
        if (typeof url === 'string' && url.startsWith('cloud://')) {
          fileIds.push(url)
        }
      }
    } else if (typeof obj[field] === 'string' && obj[field].startsWith('cloud://')) {
      fileIds.push(obj[field])
    }
  }

  // 去重
  return [...new Set(fileIds)]
}

/**
 * 调用微信云开发 API 批量获取 cloud:// 文件的临时下载链接
 * @param {Array<string>} fileIds cloud:// fileID 列表
 * @returns {Promise<Object>} { fileid: download_url } 映射表
 */
async function batchGetDownloadUrls(fileIds) {
  if (!fileIds || fileIds.length === 0) return {}

  const token = await cloudToken.getAccessToken()
  const url = `${BASE_URL}/batchdownloadfile?access_token=${token}`

  // 构建请求参数
  const fileList = fileIds.map(fileid => ({
    fileid,
    max_age: MAX_AGE
  }))

  const res = await axios.post(url, {
    env: config.db.cloud.envId,
    file_list: fileList
  }, { timeout: 15000, httpsAgent })

  if (res.data.errcode) {
    console.error('[cloudFile] batchdownloadfile 错误:', res.data.errcode, res.data.errmsg)
    return {}
  }

  // 构建映射表 { fileid: download_url }
  const urlMap = {}
  for (const item of (res.data.file_list || [])) {
    if (item.status === 0 && item.download_url) {
      urlMap[item.fileid] = item.download_url
    } else {
      console.warn(`[cloudFile] 获取下载链接失败: ${item.fileid} - ${item.errmsg}`)
    }
  }

  return urlMap
}

/**
 * 异步转换对象中所有 cloud:// URL 为临时 HTTPS 下载链接
 * 调用微信 batchdownloadfile API 获取临时 URL
 * @param {Object} obj 待处理对象（原地修改）
 * @param {string[]} [fields] 需要转换的字段名列表
 * @returns {Promise<Object>} 处理后的对象
 */
async function resolveCloudUrls(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj

  // 1. 收集所有 cloud:// fileID
  const fileIds = collectCloudFileIds(obj, fields)
  if (fileIds.length === 0) return obj

  // 2. 批量获取临时下载链接
  const urlMap = await batchGetDownloadUrls(fileIds)
  if (Object.keys(urlMap).length === 0) return obj

  // 3. 替换对象中的 cloud:// URL
  const targetFields = fields || TARGET_FIELDS
  for (const field of targetFields) {
    if (!(field in obj)) continue

    if (Array.isArray(obj[field])) {
      obj[field] = obj[field].map(url =>
        typeof url === 'string' && urlMap[url] ? urlMap[url] : url
      )
    } else if (typeof obj[field] === 'string' && urlMap[obj[field]]) {
      obj[field] = urlMap[obj[field]]
    }
  }

  return obj
}

/**
 * 批量异步转换多个对象中的 cloud:// URL
 * 先收集所有 fileID，一次性调用 API，再逐个替换
 * @param {Array<Object>} list 待处理对象列表
 * @param {string[]} [fields] 需要转换的字段名列表
 * @returns {Promise<Array<Object>>} 处理后的列表
 */
async function resolveCloudUrlsBatch(list, fields) {
  if (!Array.isArray(list) || list.length === 0) return list

  // 1. 收集所有 cloud:// fileID（去重）
  const fileIdSet = new Set()
  const targetFields = fields || TARGET_FIELDS

  for (const obj of list) {
    if (!obj || typeof obj !== 'object') continue
    for (const field of targetFields) {
      if (!(field in obj)) continue
      if (Array.isArray(obj[field])) {
        for (const url of obj[field]) {
          if (typeof url === 'string' && url.startsWith('cloud://')) {
            fileIdSet.add(url)
          }
        }
      } else if (typeof obj[field] === 'string' && obj[field].startsWith('cloud://')) {
        fileIdSet.add(obj[field])
      }
    }
  }

  const fileIds = [...fileIdSet]
  if (fileIds.length === 0) return list

  // 2. 批量获取临时下载链接
  const urlMap = await batchGetDownloadUrls(fileIds)
  if (Object.keys(urlMap).length === 0) return list

  // 3. 逐个对象替换 cloud:// URL
  for (const obj of list) {
    if (!obj || typeof obj !== 'object') continue
    for (const field of targetFields) {
      if (!(field in obj)) continue
      if (Array.isArray(obj[field])) {
        obj[field] = obj[field].map(url =>
          typeof url === 'string' && urlMap[url] ? urlMap[url] : url
        )
      } else if (typeof obj[field] === 'string' && urlMap[obj[field]]) {
        obj[field] = urlMap[obj[field]]
      }
    }
  }

  return list
}

module.exports = {
  collectCloudFileIds,
  batchGetDownloadUrls,
  resolveCloudUrls,
  resolveCloudUrlsBatch,
  TARGET_FIELDS
}
