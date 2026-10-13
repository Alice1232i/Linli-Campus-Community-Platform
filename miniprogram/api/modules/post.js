// api/modules/post.js
// 帖子模块 API
// 云函数名：post，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 发帖
   * @param {Object} data 帖子内容，如 { module, section, title, content, images }
   */
  create(data) {
    return request({ name: 'post', data: { action: 'create', ...data } }, { dedup: false })
  },

  /**
   * 信息流分页（游标分页 + 服务端排序）
   * @param {Object} params { module, section, cursor, pageSize, sort }
   *   - cursor: 0 表示首页，>0 表示上一页最后一条的 sortTime
   *   - sort: recommend(默认) / latest / hot
   */
  feed(params) {
    return request({
      name: 'post',
      data: { action: 'feed', pageSize: 20, ...params }
    }, { loading: false, silent: true })
  },

  /**
   * 帖子详情
   * @param {string} postId 帖子 ID
   */
  detail(postId) {
    return request({ name: 'post', data: { action: 'detail', postId } })
  },

  /**
   * 更新帖子
   * @param {string} postId 帖子 ID
   * @param {Object} data 更新字段
   */
  update(postId, data) {
    return request({
      name: 'post',
      data: { action: 'update', postId, ...data }
    }, { dedup: false })
  },

  /**
   * 删除帖子
   * @param {string} postId 帖子 ID
   */
  delete(postId) {
    return request({ name: 'post', data: { action: 'delete', postId } }, { dedup: false })
  },

  /**
   * 我的帖子
   * @param {number} page 页码
   */
  /**
   * 我的帖子
   * @param {number} page 页码
   * @param {string} [module] 内容类型筛选：community 社区 / lostfound 失物招领（留空为全部；跑腿已下架）
   * @param {object} [opts] 请求选项（loading / silent 等）
   */
  myPosts(page, module, opts) {
    const data = { action: 'myPosts', page }
    // 仅在传入合法类型时携带该参数，避免服务端收到空值做无意义判断
    if (module) data.module = module
    return request({ name: 'post', data }, opts)
  },

  /**
   * 他人帖子
   * @param {string} userId 用户 ID
   * @param {number} page 页码
   */
  userPosts(userId, page, opts) {
    return request({ name: 'post', data: { action: 'userPosts', userId, page } }, opts)
  },

  /**
   * 搜索帖子
   * @param {string} keyword 搜索关键词
   * @param {number} page 页码
   */
  search(keyword, page) {
    return request({ name: 'post', data: { action: 'search', keyword, page } })
  },

  /**
   * 按话题/标签搜索帖子
   * @param {string} keyword 标签关键词
   * @param {number} [page=1] 页码
   */
  searchByTag(keyword, page) {
    return request({ name: 'post', data: { action: 'searchByTag', keyword, page } })
  },

  /**
   * 关注板块（幂等）
   * @param {string} section 板块标识
   */
  followSection(section, opts) {
    return request({
      name: 'post',
      data: { action: 'followSection', section }
    }, Object.assign({ loading: false, silent: true }, opts))
  },

  /**
   * 取消关注板块（幂等）
   * @param {string} section 板块标识
   */
  unfollowSection(section, opts) {
    return request({
      name: 'post',
      data: { action: 'unfollowSection', section }
    }, Object.assign({ loading: false, silent: true }, opts))
  },

  /**
   * 当前用户关注的板块列表
   * @returns {Promise<{data: {sections: string[]}}>}
   */
  myFollowSections(opts) {
    return request({
      name: 'post',
      data: { action: 'myFollowSections' }
    }, Object.assign({ loading: false, silent: true }, opts))
  },
}
