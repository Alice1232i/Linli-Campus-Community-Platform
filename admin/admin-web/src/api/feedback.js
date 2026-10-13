/**
 * 意见箱相关 API（小程序用户反馈）
 */
import request from './request'

/**
 * 获取反馈列表
 * @param {Object} params - { status, type, startDate, endDate, sortOrder, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getFeedbacks(params) {
  return request({
    url: '/feedbacks',
    method: 'get',
    params
  })
}

/**
 * 标记反馈为已处理
 * @param {string|number} id - 反馈 ID
 * @param {Object} data - { reply: string } 官方回复（选填，回显到小程序「我的反馈」）
 */
export function handleFeedback(id, data) {
  return request({
    url: `/feedbacks/${id}/handle`,
    method: 'put',
    data
  })
}

/**
 * 批量删除反馈
 * @param {string[]} ids - 反馈 ID 数组
 * @returns {Promise<{ deleted: number }>}
 */
export function batchDeleteFeedbacks(ids) {
  return request({
    url: '/feedbacks/batch',
    method: 'delete',
    data: { ids }
  })
}
