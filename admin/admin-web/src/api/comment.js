/**
 * 评论管理相关 API
 */
import request from './request'

/**
 * 获取评论列表
 * @param {Object} params - { status, keyword, postId, startDate, endDate, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getComments(params) {
  return request({
    url: '/comments',
    method: 'get',
    params
  })
}

/**
 * 删除评论
 * @param {string|number} id - 评论 ID
 */
export function deleteComment(id) {
  return request({
    url: `/comments/${id}`,
    method: 'delete'
  })
}
