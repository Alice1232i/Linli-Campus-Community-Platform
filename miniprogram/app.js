// app.js
// 临里校园 - 小程序入口
const config = require('./api/config.js')
const auth = require('./utils/auth')
const userStore = require('./store/user')
const badgeStore = require('./store/badge')

App({
  /**
   * 小程序启动
   * 1. 初始化微信云开发
   * 2. 静默登录（先恢复本地缓存，再异步调云函数刷新）
   * 3. 获取系统信息缓存到全局
   */
  onLaunch() {
    // 初始化云开发（仅在使用云开发时初始化）
    if (config.USE_CLOUD && wx.cloud) {
      wx.cloud.init({
        env: config.CLOUD_ENV,
        traceUser: true
      })
    }

    // 获取并缓存系统信息（自定义导航栏需用到状态栏高度等）
    this.initSystemInfo()

    // 静默登录：先恢复本地缓存（快速展示），再异步调云函数刷新登录态
    this.silentLogin()
  },

  /**
   * 小程序显示
   * 每次从后台切回前台时：
   * 1. 检查登录态是否有效
   * 2. 节流同步用户状态（30 秒内不重复），确保封禁/禁言等状态及时生效
   */
  onShow() {
    this.checkLoginStatus()
    this.syncUserStatus()
  },

  /**
   * 获取系统信息并缓存
   * 兼容新版 getWindowInfo / getDeviceInfo 与旧版 getSystemInfoSync
   */
  initSystemInfo() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
      const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
      this.globalData.systemInfo = Object.assign({}, windowInfo, deviceInfo, appBaseInfo)
    } catch (e) {
      console.error('获取系统信息失败', e)
    }
  },

  /**
   * 静默登录
   * 1. 先从本地缓存恢复登录态（快速，避免首屏空白）
   * 2. 再异步调用 user 云函数 login action 刷新登录态
   *    - 云函数通过 cloud.getWXContext().OPENID 获取用户身份
   *    - 首次登录自动创建 users 记录
   *    - 后续登录更新 updatedAt
   */
  silentLogin() {
    // 用户主动退出登录后不再自动登录：
    // 此前用 globalData._manualLogoutAt + 30 秒时间窗兜底，导致退出后稍等一会儿
    // 就被静默登录顶回登录态，退出功能形同虚设。现改为持久标记（utils/auth.loggedOut），
    // 只有用户再次点击「微信登录」才会清除（auth.login 成功时自动清除）。
    if (auth.isLoggedOut()) {
      this.globalData.isLoggedIn = false
      this.globalData.userInfo = null
      return
    }

    // 第一步：快速恢复本地缓存
    try {
      const token = wx.getStorageSync('token')
      if (token) {
        this.globalData.isLoggedIn = true
        this.globalData.userInfo = wx.getStorageSync('userInfo') || null
      }
    } catch (e) {
      console.error('恢复本地登录态失败', e)
    }

    // 第二步：异步调云函数刷新登录态（不阻塞首屏渲染）
    auth.login()
      .then((data) => {
        if (data && data.userInfo) {
          // 登录成功（auth.login 内部已清除「主动退出」标记）
          this.globalData.isLoggedIn = true
          this.globalData.userInfo = data.userInfo
          // 同步到 userStore 内存状态（含封禁/禁言状态），各页面立即生效
          userStore.setUser(data.userInfo)
          // 初始化消息未读角标模块（监听前后台切换 + 启动轮询）
          // 登录成功后才初始化，避免未登录时发起无效请求
          badgeStore.init()
          // 记录本次同步时间，供 onShow 节流判断
          this._lastSyncTime = Date.now()
          // 通知所有页面登录态已更新
          this._loginReady = true
          if (this._loginCallbacks) {
            this._loginCallbacks.forEach(cb => cb(data.userInfo))
            this._loginCallbacks = []
          }
        }
      })
      .catch((err) => {
        console.error('云函数登录失败', err)
      })
  },

  /**
   * 检查登录态
   * 从后台切回前台时，如本地无会话则重新静默登录
   * 用户主动「退出登录」后保持退出态，不自动重登（需用户再次点击「微信登录」）
   */
  checkLoginStatus() {
    if (auth.isLoggedOut()) return
    if (!auth.isLoggedIn()) {
      this.silentLogin()
    }
  },

  /**
   * 节流同步用户状态
   * 从后台切回前台时，若距上次同步超过 30 秒则从服务端拉取最新用户信息
   * 确保管理员封禁/解封操作能及时反映到小程序端
   * - 未登录时跳过
   * - 同步失败静默处理，不阻断用户操作（后端 API 仍有封禁校验兜底）
   */
  syncUserStatus() {
    if (!auth.isLoggedIn()) return
    const now = Date.now()
    if (this._lastSyncTime && now - this._lastSyncTime < 30000) return
    this._lastSyncTime = now
    userStore.syncFromServer().catch((err) => {
      console.warn('[app] 同步用户状态失败:', err)
    })
  },

  /**
   * 等待登录就绪（页面可在 onShow 时调用）
   * 若登录已完成则立即回调，否则加入队列等待
   * @param {Function} cb 登录完成回调
   */
  onLoginReady(cb) {
    if (this._loginReady) {
      cb(this.globalData.userInfo)
    } else {
      if (!this._loginCallbacks) this._loginCallbacks = []
      this._loginCallbacks.push(cb)
    }
  },

  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,      // 当前用户信息
    isLoggedIn: false,   // 登录态
    systemInfo: null     // 系统信息（状态栏高度等）
  }
})
