// api/adapter/cloudAdapter.js
// 云开发适配器（默认后端）
// 基于 wx.cloud 提供的 callFunction / uploadFile 能力封装
// 统一返回 { code, data, message } 结构

const { normalizeResponse } = require('./baseAdapter')
const { TIMEOUT } = require('../config')

/**
 * 发起云函数调用
 * @param {Object} param0
 * @param {string} param0.name 云函数名（即模块名，如 'post'）
 * @param {Object} [param0.data] 请求参数，其中 action 字段用于子路由
 * @param {string} [param0.token] 拦截器注入的鉴权 token（云函数内可选用）
 * @returns {Promise<{ code: number, data: any, message: string }>}
 */
function request({ name, data, token }) {
  // ---- 超时控制：Promise.race 竞争云函数调用与超时 Promise ----
  // 弱网下 callFunction 可能长时间不回调，用超时 Promise 兜底
  // 超时后 reject 让拦截器统一展示「请求超时」提示
  const callPromise = new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      // 合并 token 到 data，供云函数侧做可选的二次校验
      data: Object.assign({}, data, token ? { __token: token } : {}),
      success(res) {
        // res.result 为云函数 return 的内容
        resolve(normalizeResponse(res && res.result))
      },
      fail(err) {
        // 云函数调用失败（网络 / 不存在 / 超时等）
        reject({
          code: -1,
          data: null,
          message: (err && err.errMsg) || '云函数调用失败'
        })
      }
    })
  })

  const timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() {
      reject({
        code: -1,
        data: null,
        message: '请求超时，请检查网络后重试'
      })
    }, TIMEOUT)
  })

  return Promise.race([callPromise, timeoutPromise])
}

/**
 * 上传文件到云存储
 * @param {Object} param0
 * @param {string} param0.filePath 本地临时文件路径
 * @param {string} param0.cloudPath 云存储路径，如 'post/xxx.png'
 * @param {Function} [param0.onProgress] 上传进度回调 (percent: 0-100) => void
 * @returns {Promise<{ code: number, data: { url: string }, message: string }>}
 *   - data.url 为 fileID，可直接用于 <image> 展示与云数据库存储
 */
function upload({ filePath, cloudPath, onProgress }) {
  return new Promise((resolve, reject) => {
    const task = wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(res) {
        // res.fileID 为云文件 ID
        resolve({
          code: 0,
          data: { url: res.fileID },
          message: '上传成功'
        })
      },
      fail(err) {
        reject({
          code: -1,
          data: null,
          message: (err && err.errMsg) || '上传失败'
        })
      }
    })
    // 进度上报（P1）：uploadFile 返回 UploadTask，可监听上传进度
    if (task && typeof task.onProgressUpdate === 'function' && typeof onProgress === 'function') {
      task.onProgressUpdate((p) => {
        onProgress((p && p.progress) || 0)
      })
    }
  })
}

module.exports = {
  request,
  upload
}
