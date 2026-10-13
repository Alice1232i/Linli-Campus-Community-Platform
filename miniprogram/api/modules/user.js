// api/modules/user.js
// 用户模块 API
// 云函数名：user，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 登录
   * @param {Object} [opts] 拦截器选项，如 { silent: true }
   * @returns {Promise}
   */
  login(opts) {
    return request({ name: 'user', data: { action: 'login' } }, Object.assign({ dedup: false }, opts))
  },

  /**
   * 退出登录（服务端撤销当前会话）
   * @returns {Promise}
   */
  logout() {
    return request({ name: 'user', data: { action: 'logout' } }, { dedup: false, loading: false, silent: true })
  },

  /**
   * 获取个人资料
   * @param {Object} [opts] 拦截器选项，如 { loading: false, silent: true }
   */
  getProfile(opts) {
    return request({ name: 'user', data: { action: 'getProfile' } }, opts)
  },

  /**
   * 更新个人资料
   * @param {Object} data 资料字段，如 { nickname, avatar, gender, bio }
   */
  updateProfile(data) {
    return request({ name: 'user', data: { action: 'updateProfile', ...data } }, { dedup: false })
  },

  /**
   * 获取他人信息（脱敏）
   * @param {string} userId 目标用户 ID / openid
   * @param {Object} [opts] 拦截器选项，如 { silent: true, loading: false }
   */
  getUser(userId, opts) {
    return request({ name: 'user', data: { action: 'getUser', userId } }, opts)
  },

  /**
   * 搜索同学（按昵称模糊匹配）
   * @param {string} keyword 搜索关键词
   * @param {number} [page=1] 页码
   */
  searchUser(keyword, page) {
    return request({ name: 'user', data: { action: 'searchUser', keyword, page } })
  }
}
