/**
 * 认证 Store
 * 管理管理员登录态：token、用户信息
 * token 持久化到 localStorage（key: admin_token）
 */
import { defineStore } from 'pinia'
import { getProfile } from '@/api/auth'

// localStorage 中 token 的键名
const TOKEN_KEY = 'admin_token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    // 从 localStorage 初始化 token
    token: localStorage.getItem(TOKEN_KEY) || '',
    // 当前登录用户信息
    user: {
      id: null,
      username: '',
      role: '',
      real_name: ''
    },
    // 是否已从服务端拉取过用户信息（刷新页面后用于恢复登录态）
    userLoaded: false
  }),

  getters: {
    // 是否已登录
    isLogin: (state) => !!state.token,
    // 是否为管理员（admin 或 super_admin）
    isAdmin: (state) => state.user.role === 'admin' || state.user.role === 'super_admin',
    // 是否为超级管理员
    isSuperAdmin: (state) => state.user.role === 'super_admin'
  },

  actions: {
    /**
     * 保存登录态
     * @param {string} token - JWT token
     * @param {Object} user - 用户信息 { id, username, role, real_name }
     */
    setAuth(token, user) {
      this.token = token
      this.user = user
      this.userLoaded = true
      localStorage.setItem(TOKEN_KEY, token)
    },

    /**
     * 从服务端拉取当前管理员信息（刷新页面后恢复登录态）
     * 成功回填 user；token 失效时清理登录态并抛出
     * @returns {Promise<Object>} 用户信息
     */
    async loadUser() {
      const user = await getProfile()
      this.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        real_name: user.real_name
      }
      this.userLoaded = true
      return user
    },

    /**
     * 退出登录，清除本地状态和缓存
     */
    logout() {
      this.token = ''
      this.user = { id: null, username: '', role: '', real_name: '' }
      localStorage.removeItem(TOKEN_KEY)
    }
  }
})
