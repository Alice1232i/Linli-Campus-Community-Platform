/**
 * 举报中心相关 API
 */
import request from './request'

/**
 * 获取举报列表
 * @param {Object} params - { status, reason, targetType, startDate, endDate, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getReports(params) {
  return request({
    url: '/reports',
    method: 'get',
    params
  })
}

/**
 * 获取举报详情
 * @param {string|number} id - 举报 ID
 */
export function getReportDetail(id) {
  return request({
    url: `/reports/${id}`,
    method: 'get'
  })
}

/**
 * 处理举报
 * @param {string|number} id - 举报 ID
 * @param {Object} data - { action: 'ban'|'mute'|'warn'|'dismiss', duration: number, result: string }
 *   - action: ban=封禁 mute=禁言 warn=警告 dismiss=驳回
 *   - duration: 封禁/禁言天数（0=永久，仅 ban/mute 有效）
 *   - result: 处理说明（将作为通知内容发送给被举报用户）
 */
export function handleReport(id, data) {
  return request({
    url: `/reports/${id}/handle`,
    method: 'put',
    data
  })
}

/**
 * 批量删除举报
 * @param {string[]} ids - 举报 ID 数组
 * @returns {Promise<{ deleted: number }>}
 */
export function batchDeleteReports(ids) {
  return request({
    url: '/reports/batch',
    method: 'delete',
    data: { ids }
  })
}
