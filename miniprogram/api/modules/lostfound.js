// api/modules/lostfound.js
// 招领模块 API
// 云函数名：lostfound，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 发布招领
   * @param {Object} data 招领数据，如 { kind, title, content, location, images, contact }
   *   - kind: 'lost' 失物 / 'found' 招领
   */
  create(data) {
    return request({ name: 'lostfound', data: { action: 'create', ...data } }, { dedup: false })
  },

  /**
   * 招领列表
   * @param {string} kind 类型 'lost' / 'found'
   * @param {number} page 页码
   */
  list(kind, page) {
    return request({ name: 'lostfound', data: { action: 'list', kind, page } })
  },

  /**
   * 招领详情
   * @param {string} id 招领记录 ID
   */
  detail(id) {
    return request({ name: 'lostfound', data: { action: 'detail', id } })
  },

  /**
   * 关闭招领
   * @param {string} id 招领记录 ID
   */
  close(id) {
    return request({ name: 'lostfound', data: { action: 'close', id } }, { dedup: false })
  }
}
