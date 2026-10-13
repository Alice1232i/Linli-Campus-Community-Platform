/**
 * 认证审核相关 API
 */
import request from './request'

/**
 * 获取认证审核列表
 * @param {Object} params - { status, keyword, startDate, endDate, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getVerifications(params) {
  return request({
    url: '/verifications',
    method: 'get',
    params
  })
}

/**
 * 通过认证审核
 * @param {string|number} id - 审核 ID
 */
export function approveVerification(id) {
  return request({
    url: `/verifications/${id}/approve`,
    method: 'put'
  })
}

/**
 * 驳回认证审核
 * @param {string|number} id - 审核 ID
 */
export function rejectVerification(id) {
  return request({
    url: `/verifications/${id}/reject`,
    method: 'put'
  })
}
