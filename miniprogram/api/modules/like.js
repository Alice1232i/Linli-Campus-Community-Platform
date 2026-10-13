// api/modules/like.js
// 点赞模块 API
// 云函数名：like，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 点赞 / 取消点赞（切换态）
   * 不显示 loading 遮罩：页面已做乐观更新，遮住 UI 会导致交互卡顿
   * 不去重：允许用户连续切换，但页面层有防抖标志防止并发请求
   * @param {string} targetId 目标 ID（帖子 / 评论）
   * @param {string} targetType 目标类型，如 'post' / 'comment'
   */
  toggle(targetId, targetType) {
    return request({
      name: 'like',
      data: { action: 'toggle', targetId, targetType }
    }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 批量检查是否已点赞
   * 后台状态检查，静默执行不弹 loading / toast
   * @param {string[]} targetIds 目标 ID 列表
   * @param {string} targetType 目标类型
   */
  batchCheck(targetIds, targetType) {
    return request({
      name: 'like',
      data: { action: 'batchCheck', targetIds, targetType }
    }, { loading: false, silent: true })
  }
}
