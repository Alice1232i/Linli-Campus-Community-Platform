/**
 * axios 实例与拦截器
 * - 统一 baseURL：通过 vite 代理 /api -> http://localhost:3000
 * - 请求拦截器：自动注入 JWT token
 * - 响应拦截器：统一处理后端返回格式 { code, data, message }
 */
import axios from 'axios'
import { ElMessage } from 'element-plus'

// token 在 localStorage 中的键名
const TOKEN_KEY = 'admin_token'

// 创建 axios 实例
const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15000
})

// 请求拦截器：注入 Authorization 头
service.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：统一处理后端返回结构
service.interceptors.response.use(
  (response) => {
    const res = response.data
    // code === 0 表示成功，直接返回 data 字段
    if (res.code === 0) {
      return res.data
    }
    // 2001 / 2003 表示 token 失效或无效，需重新登录
    if (res.code === 2001 || res.code === 2003) {
      localStorage.removeItem(TOKEN_KEY)
      ElMessage.error(res.message || '登录已失效，请重新登录')
      // 避免在登录页重复跳转
      if (location.pathname !== '/login') {
        location.href = '/login'
      }
      return Promise.reject(new Error(res.message || '登录已失效'))
    }
    // 其他业务错误，弹出错误提示
    ElMessage.error(res.message || '请求失败')
    return Promise.reject(new Error(res.message || '请求失败'))
  },
  (error) => {
    // HTTP 401/403：登录失效或无权限，清理登录态并跳转登录
    // 此前统一提示「网络异常」导致 token 过期后用户无法感知需重新登录
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      localStorage.removeItem(TOKEN_KEY)
      ElMessage.error('登录已失效，请重新登录')
      if (location.pathname !== '/login') {
        location.href = '/login'
      }
      return Promise.reject(error)
    }
    // 网络错误或服务端 5xx
    ElMessage.error('网络异常，请稍后重试')
    return Promise.reject(error)
  }
)

export default service
