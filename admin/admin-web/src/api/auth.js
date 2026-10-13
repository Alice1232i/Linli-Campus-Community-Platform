/**
 * 认证相关 API
 */
import request from './request'

/**
 * 管理员登录
 * @param {Object} data - { username, password }
 * @returns {Promise<{ token, user: { id, username, role, real_name } }>}
 */
export function login(data) {
  return request({
    url: '/auth/login',
    method: 'post',
    data
  })
}

/**
 * 获取当前登录管理员信息
 * @returns {Promise<{ id, username, role, real_name, last_login_at }>}
 */
export function getProfile() {
  return request({
    url: '/auth/profile',
    method: 'get'
  })
}

/**
 * 修改当前管理员密码
 * @param {Object} data - { oldPassword, newPassword, confirmPassword }
 * @returns {Promise<{ updated: boolean }>}
 */
export function changePassword(data) {
  return request({
    url: '/auth/change-password',
    method: 'post',
    data
  })
}
