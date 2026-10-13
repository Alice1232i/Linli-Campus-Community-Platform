/**
 * 操作日志相关 API
 */
import request from './request'

/**
 * 获取操作日志列表
 * @param {Object} params - { adminId, adminName, action, targetType, targetId, startDate, endDate, sortOrder, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getLogs(params) {
  return request({
    url: '/logs',
    method: 'get',
    params
  })
}
