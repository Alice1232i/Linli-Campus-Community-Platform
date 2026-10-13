// utils/route.js
// 统一路由分发工具
// 根据帖子的 refType 决定跳转到对应业务详情页，避免所有帖子统一进 post/detail

/**
 * 根据帖子对象的 refType 跳转到对应详情页
 * - refType='lostfound' → 失物招领详情页
 * - 默认                 → 社区帖子详情页
 * 说明：跑腿模块已整体下架（页面与入口均已删除），故不再有 delivery 分支；
 *      若历史数据里出现 delivery 类型，会按默认分支进入社区帖子详情页（不会白屏）
 * @param {Object} post 帖子对象，需含 _id，可选 refType / refId
 */
function navigateToDetail(post) {
  if (!post || !post._id) return
  const refType = post.refType || ''
  const refId = post.refId || ''
  const postId = post._id

  let url = ''
  switch (refType) {
    case 'lostfound':
      url = `/pages/lostfound/detail/index?id=${refId}`
      break
    default:
      // 普通社区帖子
      url = `/pages/post/detail/index?postId=${postId}`
  }
  wx.navigateTo({ url })
}

module.exports = {
  navigateToDetail
}
