// api/modules/notify.js
// 通知模块 API
// 云函数名：notify，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 通知列表（分页）
   * @param {string} [type] 通知类型筛选（可选）：like/comment/favorite/order/system/report
   * @param {number} [page=1] 页码
   */
  list(type, page, opts) {
    const data = { action: 'list' }
    if (type) data.type = type
    if (page) data.page = page
    return request({ name: 'notify', data }, opts)
  },

  /**
   * 未读通知计数（按类型分组）
   * @returns {Promise<{ code: number, data: { total: number, byType: object }, message: string }>}
   */
  unread(opts) {
    return request({ name: 'notify', data: { action: 'unread' } }, opts)
  },

  /**
   * 标记单条通知为已读
   * @param {string} notificationId 通知 ID
   */
  markRead(notificationId) {
    return request({
      name: 'notify',
      data: { action: 'markRead', notificationId }
    }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 标记全部通知为已读
   */
  markAllRead() {
    return request({
      name: 'notify',
      data: { action: 'markAllRead' }
    }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 删除单条通知
   * @param {string} notificationId 通知 ID
   */
  delete(notificationId) {
    return request({
      name: 'notify',
      data: { action: 'delete', notificationId }
    }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 清空全部通知（可选按类型清空）
   * @param {string} [type] 通知类型筛选（可选）
   */
  clearAll(type) {
    const data = { action: 'clearAll' }
    if (type) data.type = type
    return request({ name: 'notify', data }, { dedup: false, loading: false, silent: true })
  }
}
