// store/user.js
// 用户全局状态
// 维护 userInfo / isLoggedIn / isVerified 三个全局状态
// 提供轻量的发布订阅机制，页面可通过 subscribe 监听状态变化
// 启动时从本地缓存恢复，避免每次进入都请求服务端

const { user } = require('../api/index.js')
const auth = require('../utils/auth')
const storage = require('../utils/storage')
const { sanitizeImageUrl } = require('../utils/format')

const USER_KEY = 'userInfo'
// 默认头像（临时路径 / 空头像时占位）
const DEFAULT_AVATAR = '/images/icons/user_profile.png'

// 全局状态
const state = {
  userInfo: null,
  isLoggedIn: false,
  isVerified: false
}

// 订阅者列表
const listeners = []

/**
 * 通知所有订阅者
 */
function notify() {
  for (let i = 0; i < listeners.length; i++) {
    listeners[i](state)
  }
}

/**
 * 判断用户是否已认证
 */
function pickVerified(userInfo) {
  return !!(userInfo && (userInfo.verified || userInfo.verifyStatus === 'approved'))
}

/**
 * 判断当前用户是否已被封禁
 * 封禁用户不可发帖、评论、点赞、收藏、浏览信息流
 * @returns {boolean}
 */
function isBanned() {
  return !!(state.userInfo && state.userInfo.status === 'banned')
}

/**
 * 判断当前用户是否已被禁言
 * 禁言用户不可发帖、评论，但可点赞、收藏
 * @returns {boolean}
 */
function isMuted() {
  return !!(state.userInfo && state.userInfo.status === 'muted')
}

/**
 * 获取当前状态（返回引用，便于直接绑定到页面 data）
 */
function getState() {
  return state
}

/**
 * 设置用户信息，同步更新登录态与认证态
 * @param {Object} userInfo 用户信息
 */
function setUser(userInfo) {
  state.userInfo = userInfo || null
  state.isLoggedIn = !!userInfo
  state.isVerified = pickVerified(userInfo)
  if (userInfo) {
    storage.set(USER_KEY, userInfo)
  } else {
    storage.remove(USER_KEY)
  }
  notify()
}

/**
 * 清除用户状态（**不**标记为主动退出）
 * 用于「清除缓存」等场景：清完后仍可被静默登录恢复登录态
 */
function clear() {
  state.userInfo = null
  state.isLoggedIn = false
  state.isVerified = false
  storage.remove(USER_KEY)
  auth.clearSession()
  notify()
}

/**
 * 退出登录
 * 清除用户状态并标记为主动退出，之后不再被静默登录顶回登录态
 * @returns {Promise<void>}
 */
function logout() {
  state.userInfo = null
  state.isLoggedIn = false
  state.isVerified = false
  storage.remove(USER_KEY)
  notify()
  return auth.logout()
}

/**
 * 从服务端同步个人资料并更新状态
 *
 * 这是**后台静默同步**（app.onShow 每次切回前台都会触发，30 秒节流），
 * 因此显式关闭全屏 loading 与失败 toast：
 *   - 此前默认 loading=true，导致每次切回前台都闪一次全屏「加载中」；
 *   - 失败提示交由调用方决定，避免在用户当前所在页面弹出与本页无关的错误。
 * 会话失效的自动恢复由 api/interceptor.js 的 recoverAuth 统一处理。
 * @returns {Promise<Object>} 最新的用户信息
 */
function syncFromServer() {
  return user.getProfile({ loading: false, silent: true })
    .then(res => {
      const info = (res && res.data) || null
      setUser(info)
      return info
    })
}

/**
 * 订阅状态变化
 * @param {Function} cb 回调，参数为最新 state
 * @returns {Function} 取消订阅函数
 */
function subscribe(cb) {
  if (typeof cb === 'function') listeners.push(cb)
  return function unsubscribe() {
    const idx = listeners.indexOf(cb)
    if (idx !== -1) listeners.splice(idx, 1)
  }
}

// 启动时从本地缓存恢复用户信息（不触发通知，避免无订阅者时空跑）
// 净化缓存中的头像：历史脏数据可能存了 wxfile:// 临时路径，重启后已失效
// 条件：必须同时存在会话凭证且用户未主动退出，避免「有资料但无会话」被误判为已登录
const cached = storage.get(USER_KEY, null)
if (cached && auth.isLoggedIn() && !auth.isLoggedOut()) {
  if (cached.avatar) {
    cached.avatar = sanitizeImageUrl(cached.avatar, DEFAULT_AVATAR)
  }
  state.userInfo = cached
  state.isLoggedIn = true
  state.isVerified = pickVerified(cached)
}

module.exports = {
  state,
  getState,
  setUser,
  clear,
  logout,
  syncFromServer,
  subscribe,
  isBanned,
  isMuted
}
