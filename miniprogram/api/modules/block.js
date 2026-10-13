// api/modules/block.js
// 拉黑模块 API
// 云函数名：block，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 拉黑用户
   * @param {string} targetOpenid 目标用户 openid
   */
  block(targetOpenid) {
    return request({
      name: 'block',
      data: { action: 'block', targetOpenid }
    }, { dedup: false })
  },

  /**
   * 取消拉黑
   * @param {string} targetOpenid 目标用户 openid
   */
  unblock(targetOpenid) {
    return request({
      name: 'block',
      data: { action: 'unblock', targetOpenid }
    }, { dedup: false })
  },

  /**
   * 拉黑列表
   * @param {number} page 页码
   */
  list(page) {
    return request({ name: 'block', data: { action: 'list', page } })
  }
}
