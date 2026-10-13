/**
 * 微信云数据库 access_token 管理
 * ------------------------------------------------------------
 * 负责获取和缓存 access_token，自动在过期前刷新。
 * 所有密钥从环境变量读取，代码中零明文。
 */

const axios = require('axios')
const config = require('../config')
const https = require('https')

// 开发环境跳过 SSL 证书校验（微信 API 证书链在部分本地环境无法验证）
const httpsAgent = config.isDev
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined

/** 缓存的 access_token */
let cachedToken = null

/** token 过期时间戳（毫秒） */
let tokenExpireAt = 0

/** 提前量：在过期前 5 分钟刷新，避免边界问题 */
const REFRESH_AHEAD_MS = 5 * 60 * 1000

/**
 * 获取有效的 access_token
 * 如果缓存未过期则直接返回，否则自动刷新
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpireAt - REFRESH_AHEAD_MS) {
    return cachedToken
  }
  return await refreshToken()
}

/**
 * 刷新 access_token
 * 调用微信 API 获取新 token，使用 appid + secret（来自环境变量）
 * @returns {Promise<string>}
 */
async function refreshToken() {
  const { appid, secret } = config.db.cloud
  if (!appid || !secret) {
    throw new Error('微信云数据库配置缺失：WX_APPID 或 WX_SECRET 未设置')
  }

  const url = 'https://api.weixin.qq.com/cgi-bin/token'
  const res = await axios.get(url, {
    params: {
      grant_type: 'client_credential',
      appid: appid,
      secret: secret
    },
    timeout: 10000,
    httpsAgent  // 开发环境跳过 SSL 校验
  })

  if (res.data.errcode) {
    throw new Error(`获取 access_token 失败：[${res.data.errcode}] ${res.data.errmsg}`)
  }

  const now = Date.now()
  cachedToken = res.data.access_token
  // expires_in 单位为秒，转为毫秒时间戳
  tokenExpireAt = now + res.data.expires_in * 1000
  return cachedToken
}

/**
 * 清除缓存（用于测试或 token 失效场景）
 */
function clearCache() {
  cachedToken = null
  tokenExpireAt = 0
}

module.exports = {
  getAccessToken,
  refreshToken,
  clearCache
}
