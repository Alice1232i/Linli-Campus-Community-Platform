// api/modules/common.js
// 通用模块 API
// 云函数名：common，通过 data.action 字段做子路由
// 同时提供经适配器的文件上传能力

const { request, upload } = require('../adapter/index.js')

/**
 * 生成云存储路径，避免文件名冲突
 * @param {string} filePath 本地文件路径
 * @returns {string} 形如 'upload/2024/01/xxxx.png'
 */
function genCloudPath(filePath) {
  const ext = (filePath.match(/\.\w+$/) || ['.png'])[0]
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 10)
  return `upload/${y}/${m}/${Date.now()}_${rand}${ext}`
}

module.exports = {
  /**
   * 获取服务端配置
   * @param {string} key 配置键
   */
  getConfig(key) {
    return request({ name: 'common', data: { action: 'getConfig', key } })
  },

  /**
   * 获取社区板块列表
   * @returns {Promise<{ code: number, data: { sections: array }, message: string }>}
   */
  sections() {
    return request({ name: 'common', data: { action: 'sections' } })
  },

  /**
   * 上传文件（经适配器统一上传）
   * @param {string} filePath 本地临时文件路径
   * @returns {Promise<{ code: number, data: { url: string }, message: string }>}
   */
  uploadFile(filePath) {
    return upload({ filePath, cloudPath: genCloudPath(filePath) }, { dedup: false })
  }
}
