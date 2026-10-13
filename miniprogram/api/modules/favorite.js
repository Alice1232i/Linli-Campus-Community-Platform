// api/modules/favorite.js
// 收藏模块 API
// 云函数名：favorite，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 收藏 / 取消收藏（切换态）
   * 不显示 loading 遮罩：页面已做乐观更新，遮住 UI 会导致交互卡顿
   * @param {string} postId 帖子 ID
   */
  toggle(postId) {
    return request({ name: 'favorite', data: { action: 'toggle', postId } }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 检查是否已收藏
   * 后台状态检查，静默执行不弹 loading / toast
   * @param {string} postId 帖子 ID
   */
  check(postId) {
    return request({ name: 'favorite', data: { action: 'check', postId } }, { loading: false, silent: true })
  },

  /**
   * 我的收藏列表
   * @param {number} page 页码
   */
  list(page, opts) {
    return request({ name: 'favorite', data: { action: 'list', page } }, opts)
  }
}
