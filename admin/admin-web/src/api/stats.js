/**
 * 统计相关 API
 */
import request from './request'

/**
 * 获取总览统计数据
 * @returns {Promise<{ totalUsers, totalPosts, totalComments, totalReports, pendingReports, todayNewPosts, todayNewUsers }>}
 */
export function getOverview() {
  return request({
    url: '/stats/overview',
    method: 'get'
  })
}

/**
 * 获取趋势数据
 * @param {number} days - 天数，默认 7
 * @returns {Promise<Array<{ date, postCount, userCount }>>}
 */
export function getTrend(days = 7) {
  return request({
    url: '/stats/trend',
    method: 'get',
    params: { days }
  })
}
