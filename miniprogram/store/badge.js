// store/badge.js
// 消息未读角标状态管理（单例模式）
// ------------------------------------------------------------
// 负责：轮询未读消息计数、维护全局角标状态、通过 eventBus 广播更新
// 设计要点：
// 1. 进入前台立即查询一次，保证及时性
// 2. 后台轮询间隔 30s，平衡及时性与性能（云函数调用计费）
// 3. 进入后台停止轮询，避免无谓请求
// 4. 外部可手动触发刷新（如标记已读、发帖后）
// 5. 并发去重：同时只允许一个 unread 请求在途

const api = require('../api/index.js')
const eventBus = require('./eventBus.js')

// 轮询间隔（毫秒）：30 秒，兼顾及时性与云函数调用成本
const POLL_INTERVAL = 30000

// 单例状态
let state = {
  // 未读总数
  unreadCount: 0,
  // 按类型分组的未读数 { like: 2, comment: 1, ... }
  byType: {},
  // 是否正在请求中（并发去重）
  fetching: false,
  // 上次成功查询时间戳
  lastFetchAt: 0,
  // 轮询定时器 ID
  timerId: null,
  // 是否已初始化（避免重复监听 app 生命周期）
  inited: false
}

/**
 * 查询未读消息计数
 * 并发去重：fetching 为 true 时跳过，避免重复请求
 * @param {boolean} [force] 是否强制刷新（忽略最小间隔）
 * @returns {Promise<void>}
 */
async function fetchUnread(force) {
  // 正在请求中则跳过（除非强制）
  if (state.fetching) return
  state.fetching = true
  try {
    // 静默请求：轮询不弹全屏 loading、失败不弹 toast（P0-1 修复）
    const res = await api.notify.unread({ loading: false, silent: true })
    if (res.code === 0) {
      const data = res.data || {}
      const newCount = data.total || 0
      const newByType = data.byType || {}
      // 仅在数量变化时才广播，减少无意义的 setData
      if (force || newCount !== state.unreadCount || JSON.stringify(newByType) !== JSON.stringify(state.byType)) {
        state.unreadCount = newCount
        state.byType = newByType
        state.lastFetchAt = Date.now()
        // 广播角标更新事件，TabBar 组件监听后刷新 UI
        eventBus.emit('badgeUpdate', {
          unreadCount: state.unreadCount,
          byType: state.byType
        })
      }
    }
  } catch (e) {
    console.warn('[badge] 查询未读失败:', e.message)
  } finally {
    state.fetching = false
  }
}

/**
 * 启动后台轮询
 * 仅在前台时轮询，进入后台自动停止
 */
function startPolling() {
  stopPolling()
  state.timerId = setInterval(() => {
    fetchUnread(false)
  }, POLL_INTERVAL)
}

/**
 * 停止后台轮询
 */
function stopPolling() {
  if (state.timerId) {
    clearInterval(state.timerId)
    state.timerId = null
  }
}

/**
 * 初始化角标模块
 * 监听应用前后台切换，自动启停轮询
 * 全局只需调用一次，重复调用会被 inited 标记拦截
 */
function init() {
  if (state.inited) return
  state.inited = true

  // App onShow：进入前台，立即查询 + 启动轮询
  wx.onAppShow && wx.onAppShow(() => {
    fetchUnread(false)
    startPolling()
  })

  // App onHide：进入后台，停止轮询节省资源
  wx.onAppHide && wx.onAppHide(() => {
    stopPolling()
  })

  // 首次初始化时立即查询一次
  fetchUnread(false)
  // 启动轮询
  startPolling()
}

/**
 * 获取当前角标状态（同步）
 * @returns {{ unreadCount: number, byType: object }}
 */
function getBadge() {
  return {
    unreadCount: state.unreadCount,
    byType: state.byType
  }
}

/**
 * 手动触发刷新（外部调用）
 * 场景：标记已读、进入消息页、发帖后等
 * @param {boolean} [force] 是否强制刷新
 */
function refresh(force) {
  fetchUnread(force)
}

/**
 * 本地清零角标（无需请求后端）
 * 场景：标记全部已读后立即更新 UI，不等轮询
 */
function clearBadge() {
  if (state.unreadCount === 0) return
  state.unreadCount = 0
  state.byType = {}
  eventBus.emit('badgeUpdate', {
    unreadCount: 0,
    byType: {}
  })
}

module.exports = {
  init,
  refresh,
  getBadge,
  clearBadge,
  startPolling,
  stopPolling
}
