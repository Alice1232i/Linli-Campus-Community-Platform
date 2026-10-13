// api/adapter/httpAdapter.js
// HTTP 适配器（预留独立服务器后端）
// 当 config.USE_CLOUD = false 时启用，基于 wx.request / wx.uploadFile
// 统一返回 { code, data, message } 结构

const { normalizeResponse } = require('./baseAdapter')
const { HTTP_BASE, TIMEOUT } = require('../config')

/**
 * 发起 HTTP 请求
 * @param {Object} param0
 * @param {string} param0.name 接口路径（即模块名），最终 URL 为 `${HTTP_BASE}/${name}`
 * @param {Object} [param0.data] 请求参数，其中 action 字段用于子路由
 * @param {string} [param0.method='POST'] 请求方法
 * @param {string} [param0.token] 拦截器注入的鉴权 token，写入 Authorization 头
 * @returns {Promise<{ code: number, data: any, message: string }>}
 */
function request({ name, data, method = 'POST', token }) {
  return new Promise((resolve, reject) => {
    // 组装请求头，注入鉴权 token
    const header = {
      'Content-Type': 'application/json'
    }
    if (token) {
      header['Authorization'] = 'Bearer ' + token
    }

    wx.request({
      url: `${HTTP_BASE}/${name}`,
      method,
      data,
      header,
      timeout: TIMEOUT,
      success(res) {
        // res.data 为服务器响应体
        resolve(normalizeResponse(res && res.data))
      },
      fail(err) {
        reject({
          code: -1,
          data: null,
          message: (err && err.errMsg) || '网络请求失败'
        })
      }
    })
  })
}

/**
 * 上传文件到独立服务器
 * @param {Object} param0
 * @param {string} param0.filePath 本地临时文件路径
 * @param {string} [param0.token] 拦截器注入的鉴权 token，写入 Authorization 头
 * @returns {Promise<{ code: number, data: { url: string }, message: string }>}
 *   - data.url 为服务器返回的资源访问地址
 */
function upload({ filePath, token }) {
  return new Promise((resolve, reject) => {
    const header = {}
    if (token) {
      header['Authorization'] = 'Bearer ' + token
    }

    wx.uploadFile({
      url: `${HTTP_BASE}/upload`,
      filePath,
      name: 'file',
      header,
      timeout: TIMEOUT,
      success(res) {
        // 服务器返回的是字符串，需要 JSON 解析
        let body
        try {
          body = JSON.parse(res.data)
        } catch (e) {
          body = { url: res.data }
        }
        const normalized = normalizeResponse(body)
        // 兼容服务器直接返回 { url } 的情况
        if (normalized.code === 0 && normalized.data && normalized.data.url) {
          resolve(normalized)
        } else {
          resolve({
            code: 0,
            data: { url: (body && body.url) || body },
            message: '上传成功'
          })
        }
      },
      fail(err) {
        reject({
          code: -1,
          data: null,
          message: (err && err.errMsg) || '上传失败'
        })
      }
    })
  })
}

module.exports = {
  request,
  upload
}
