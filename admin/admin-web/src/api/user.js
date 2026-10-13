/**
 * 用户管理相关 API
 */
import request from './request'

/**
 * 获取用户列表
 * @param {Object} params - { status, role, keyword, startDate, endDate, page, pageSize }
 * @returns {Promise<{ list, total, page, pageSize }>}
 */
export function getUsers(params) {
  return request({
    url: '/users',
    method: 'get',
    params
  })
}

/**
 * 获取用户详情
 * @param {string} id - 用户 id
 */
export function getUserDetail(id) {
  return request({
    url: `/users/${id}`,
    method: 'get'
  })
}

/**
 * 更新用户状态
 * @param {string} id - 用户 id
 * @param {string} status - 状态值（active/muted/banned）
 * @param {number} [duration] - 禁言/封禁天数（0=永久，仅 muted/banned 有效）
 */
export function updateUserStatus(id, status, duration) {
  return request({
    url: `/users/${id}/status`,
    method: 'put',
    data: { status, duration }
  })
}

/**
 * 解除封禁/禁言（恢复为正常状态）
 * @param {string} id - 用户 id
 */
export function unbanUser(id) {
  return request({
    url: `/users/${id}/unban`,
    method: 'put'
  })
}

/**
 * 更新用户角色
 * @param {string} id - 用户 id
 * @param {string} role - 角色值（user/admin/operator/merchant）
 */
export function updateUserRole(id, role) {
  return request({
    url: `/users/${id}/role`,
    method: 'put',
    data: { role }
  })
}

/**
 * 删除用户
 * 硬删除：从数据库中移除用户记录，用户发布的帖子/评论仍保留
 * @param {string} id - 用户 id
 */
export function deleteUser(id) {
  return request({
    url: `/users/${id}`,
    method: 'delete'
  })
}
