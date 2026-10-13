// api/modules/comment.js
// 评论模块 API
// 云函数名：comment，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 发表评论
   * @param {string} postId 帖子 ID
   * @param {string} content 评论内容
   * @param {string} [parentId] 父评论 ID（回复评论时传）
   * @param {Object|null} [replyTo] 被回复用户信息 { userId, nickname }（云函数 schema 要求 object 类型）
   * @param {string} [clientId] 客户端幂等键，防止弱网重试导致重复评论
   */
  create(postId, content, parentId, replyTo, clientId) {
    return request({
      name: 'comment',
      data: { action: 'create', postId, content, parentId, replyTo, clientId }
    }, { dedup: false })
  },

  /**
   * 评论列表（支持游标分页，兼容旧 page 参数）
   * @param {string} postId 帖子 ID
   * @param {number|Object} pageOrOptions 页码（旧）或 { cursor, pageSize }（新）
   * 静默加载：不显示全局 loading，避免与帖子详情加载的 loading 冲突
   */
  list(postId, pageOrOptions) {
    const data = { action: 'list', postId }
    if (typeof pageOrOptions === 'object' && pageOrOptions) {
      if (pageOrOptions.cursor) data.cursor = pageOrOptions.cursor
      if (pageOrOptions.pageSize) data.pageSize = pageOrOptions.pageSize
    } else if (pageOrOptions) {
      data.page = pageOrOptions
    }
    return request({ name: 'comment', data }, { loading: false, silent: true })
  },

  /**
   * 删除评论
   * @param {string} commentId 评论 ID
   */
  delete(commentId) {
    return request({ name: 'comment', data: { action: 'delete', commentId } }, { dedup: false })
  }
}
