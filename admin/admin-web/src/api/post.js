/**
 * 帖子管理相关 API
 */
import request from './request'

/**
 * 获取帖子列表
 * @param {Object} params - { status, module, section, keyword, startDate, endDate, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getPosts(params) {
  return request({
    url: '/posts',
    method: 'get',
    params
  })
}

/**
 * 获取帖子详情
 * @param {string|number} id - 帖子 ID
 */
export function getPostDetail(id) {
  return request({
    url: `/posts/${id}`,
    method: 'get'
  })
}

/**
 * 设置 / 取消置顶
 * @param {string|number} id - 帖子 ID
 * @param {boolean} isTop - 是否置顶
 */
export function toggleTop(id, isTop) {
  return request({
    url: `/posts/${id}/top`,
    method: 'put',
    data: { isTop }
  })
}

/**
 * 设置 / 取消加精
 * @param {string|number} id - 帖子 ID
 * @param {boolean} isEssence - 是否加精
 */
export function toggleEssence(id, isEssence) {
  return request({
    url: `/posts/${id}/essence`,
    method: 'put',
    data: { isEssence }
  })
}

/**
 * 更新帖子状态
 * @param {string|number} id - 帖子 ID
 * @param {string} status - 状态值（normal/hidden/deleted/reviewing）
 */
export function updatePostStatus(id, status) {
  return request({
    url: `/posts/${id}/status`,
    method: 'put',
    data: { status }
  })
}

/**
 * 删除帖子
 * @param {string|number} id - 帖子 ID
 */
export function deletePost(id) {
  return request({
    url: `/posts/${id}`,
    method: 'delete'
  })
}
