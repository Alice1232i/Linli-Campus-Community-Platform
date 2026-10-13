// pages/profile/index.js
// 我的页 - 用户信息卡片 + 统计数据 + 功能入口列表
// 已登录时拉取最新资料；未登录展示「点击登录」引导

const api = require('../../api/index.js')
const { isLoggedIn } = require('../../utils/auth')
const userStore = require('../../store/user')
const { sanitizeImageUrl } = require('../../utils/format')
const { checkBanBeforeNavigate } = require('../../utils/ban-check.js')
const eventBus = require('../../store/eventBus.js')

// 默认头像（未登录 / 未设置头像时占位）
const DEFAULT_AVATAR = '/images/icons/user_profile.png'

// 功能入口配置：左图标 + 名称（tag 为右侧附加标签，如「公测」）
const ENTRIES = [
  { key: 'verify', name: '学生认证', icon: '/images/icons/check_circle.png' },
  { key: 'posts', name: '我的帖子', icon: '/images/icons/list.png' },
  { key: 'favorites', name: '我的收藏', icon: '/images/icons/heart_outline.png' },
  { key: 'feedback', name: '意见箱', icon: '/images/icons/megaphone.png', tag: '公测' },
  { key: 'settings', name: '设置', icon: '/images/icons/info_circle.png' }
]

Page({
  data: {
    isLoggedIn: false,
    // 用户信息（未登录态默认值）
    userInfo: {
      nickname: '点击登录',
      avatar: DEFAULT_AVATAR,
      verifyBadge: false // 学生认证徽章
    },
    // 统计数据：帖子 / 收藏（由 loadAggregatedStats 并行加载）
    stats: {
      posts: 0,
      favorites: 0
    },
    verifyEnabled: false, // 学生认证功能开关（默认关闭，从服务端配置读取）
    entries: ENTRIES,
    // 账号状态：active 正常 / muted 禁言 / banned 封禁
    accountStatus: 'active'
  },

  /**
   * 页面加载
   * 订阅「收藏发生变化」事件：帖子详情页收藏 / 取消收藏成功后会 emit，
   * 用于让本页统计在返回时立即刷新（否则会被 30 秒节流挡在旧值上）
   */
  onLoad() {
    this._offFavoritesChanged = eventBus.on('favoritesChanged', () => {
      this._statsDirty = true
    })
  },

  /**
   * 页面卸载：解绑事件监听
   */
  onUnload() {
    if (typeof this._offFavoritesChanged === 'function') {
      this._offFavoritesChanged()
      this._offFavoritesChanged = null
    }
  },

  /**
   * 页面显示
   * 1. 更新自定义 TabBar 选中态为「我的」（索引 4）
   * 2. 已登录则拉取最新资料（节流：30秒内不重复请求）
   * 3. 统计脏标记（收藏发生变化）优先于节流，立即刷新统计
   */
  onShow() {
    // Skyline 异步回调 + WebView 同步返回兼容
    if (typeof this.getTabBar === 'function') {
      const result = this.getTabBar((tabBar) => {
        if (tabBar && typeof tabBar.updateSelected === 'function') {
          tabBar.updateSelected(4)
        }
      })
      if (result && typeof result.updateSelected === 'function') {
        result.updateSelected(4)
      }
    }

    const now = Date.now()
    // ---- 统计脏标记优先于节流 ----
    // 详情页收藏 / 取消收藏后会 emit favoritesChanged；从收藏列表返回本页时
    // 若被下面的 30 秒节流跳过，就会出现「收藏列表里能看到帖子，但统计仍为 0」。
    if (this._statsDirty) {
      this._statsDirty = false
      this._lastLoadTime = now
      this.loadAggregatedStats()
      return
    }
    // 节流：距上次加载不足 30 秒则跳过网络请求，直接用已有数据
    // 首次进入（未登录态）仍需执行 refreshUser 以展示登录引导
    if (!this._lastLoadTime || now - this._lastLoadTime > 30000) {
      this._lastLoadTime = now
      // 配置与用户资料并行请求，互不阻塞
      this.loadVerifyConfig()
      this.refreshUser()
    }
  },

  /**
   * 加载学生认证功能开关
   * 从服务端 config 读取 verifyEnabled，关闭时隐藏认证入口
   */
  loadVerifyConfig() {
    api.common.getConfig('verifyEnabled')
      .then(res => {
        const config = (res && res.data && res.data.config) || {}
        const enabled = config.verifyEnabled === true
        this.setData({ verifyEnabled: enabled })
      })
      .catch(err => {
        console.error('获取认证开关失败', err)
      })
  },

  /**
   * 刷新用户信息
   * 已登录从服务端拉取用户资料与统计数据，两者并行请求减少等待时间
   * 未登录重置为游客态
   */
  refreshUser() {
    if (!isLoggedIn()) {
      this.resetToGuest()
      return
    }
    // 用户资料与统计数据并行请求，互不阻塞，减少整体加载时间
    api.user.getProfile()
      .then(res => {
        const info = (res && res.data) || null
        if (info) {
          // 同步到全局状态
          userStore.setUser(info)
          this.applyUserInfo(info)
        } else {
          this.applyUserInfoFromStore()
        }
      })
      .catch(err => {
        console.error('获取用户资料失败', err)
        // 接口失败时回退到本地缓存
        this.applyUserInfoFromStore()
      })
    // 统计数据与用户资料并行加载，不依赖用户资料结果
    this.loadAggregatedStats()
  },

  /**
   * 加载聚合统计数据（帖子数 + 收藏数 + 订单数）
   * 三项并行请求，任一失败不影响其他
   */
  async loadAggregatedStats() {
    try {
      const [postRes, favRes] = await Promise.all([
        // 静默请求：避免切 Tab 时闪现全屏 loading 遮罩（第二个参数为内容类型，留空=全部）
        api.post.myPosts(1, '', { loading: false, silent: true }).catch(() => null),
        api.favorite.list(1, { loading: false, silent: true }).catch(() => null)
      ])
      // 仅在请求成功时覆盖对应数值，失败时保留上一次的值。
      // 此前失败会落到 `: 0`，导致「一次静默失败就把统计清零」——
      // 叠加会话失效（favorite.list 返回 2001）时会长期显示 0，且因 silent 无任何提示。
      const patch = {}
      if (postRes && postRes.code === 0 && postRes.data) {
        patch['stats.posts'] = postRes.data.total || 0
      }
      if (favRes && favRes.code === 0 && favRes.data) {
        patch['stats.favorites'] = favRes.data.total || 0
      }
      if (Object.keys(patch).length) {
        this.setData(patch)
      }
    } catch (e) {
      console.error('加载聚合统计失败', e)
    }
  },

  /**
   * 将服务端用户信息应用到视图
   * 注意：不在此处设置 stats，避免与 loadAggregatedStats 的异步结果产生数字闪烁
   * stats 仅由 loadAggregatedStats 统一更新，保留屏幕上已有数值直到新数据返回
   */
  applyUserInfo(info) {
    // 净化头像：防止数据库中残留的 wxfile:// 临时路径导致加载失败
    const rawAvatar = info.avatar || ''
    const avatar = sanitizeImageUrl(rawAvatar, DEFAULT_AVATAR)
    // 院系信息展示文案：学院 · 专业 · X 届（编辑资料填写后展示）
    const metaParts = []
    if (info.college) metaParts.push(info.college)
    if (info.major) metaParts.push(info.major)
    if (info.grade) metaParts.push(info.grade + ' 届')
    this.setData({
      isLoggedIn: true,
      userInfo: {
        nickname: info.nickname || '同学',
        avatar: avatar,
        verifyBadge: !!(info.verifyBadge || info.verified || info.verifyStatus === 'approved')
      },
      collegeText: metaParts.join(' · '),
      // 同步账号状态：active 正常 / muted 禁言 / banned 封禁
      accountStatus: info.status || 'active'
      // stats 不在此处更新，由 loadAggregatedStats 统一设置，避免数字闪烁
    })
  },

  /**
   * 从全局 store 读取用户信息
   */
  applyUserInfoFromStore() {
    const state = userStore.getState()
    if (state && state.userInfo) {
      this.applyUserInfo(state.userInfo)
    } else {
      this.resetToGuest()
    }
  },

  /**
   * 重置为游客态
   */
  resetToGuest() {
    this.setData({
      isLoggedIn: false,
      userInfo: {
        nickname: '点击登录',
        avatar: DEFAULT_AVATAR,
        verifyBadge: false
      },
      collegeText: '',
      stats: { posts: 0, favorites: 0, orders: 0 },
      accountStatus: 'active'
    })
  },

  /**
   * 点击顶部用户卡片
   * 已登录跳转编辑页，未登录跳转登录页
   */
  onTapUserCard() {
    if (this.data.isLoggedIn) {
      this.goEdit()
    } else {
      wx.navigateTo({ url: '/pages/user/login/index' })
    }
  },

  /**
   * 跳转编辑资料页
   */
  goEdit() {
    wx.navigateTo({ url: '/pages/user/edit/index' })
  },

  /**
   * 跳转学生认证页
   */
  goVerify() {
    wx.navigateTo({ url: '/pages/user/verify/index' })
  },

  /**
   * 我的帖子
   * 封禁用户不可进入社区内容页面
   */
  goPosts() {
    if (!checkBanBeforeNavigate()) return
    wx.navigateTo({ url: '/pages/user/posts/index' })
  },

  /**
   * 跳转意见箱（收集测试版本意见，提交至管理后台）
   */
  goFeedback() {
    wx.navigateTo({ url: '/pages/setting/feedback/index' })
  },

  /**
   * 我的收藏
   * 封禁用户不可进入社区内容页面
   */
  goFavorites() {
    if (!checkBanBeforeNavigate()) return
    wx.navigateTo({ url: '/pages/post/favorites/index' })
  },

  /**
   * 设置
   */
  goSettings() {
    wx.navigateTo({ url: '/pages/setting/index' })
  },

  /**
   * 点击功能入口，按 key 路由
   */
  onTapEntry(e) {
    const { key } = e.currentTarget.dataset
    switch (key) {
      case 'verify':
        this.goVerify()
        break
      case 'posts':
        this.goPosts()
        break
      case 'favorites':
        this.goFavorites()
        break
      case 'feedback':
        this.goFeedback()
        break
      case 'settings':
        this.goSettings()
        break
      default:
        break
    }
  },

  /**
   * 点击统计栏「帖子」数字
   * 未登录时引导登录，已登录跳转我的帖子页
   */
  onTapStatPosts() {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    this.goPosts()
  },

  /**
   * 点击统计栏「收藏」数字
   * 未登录时引导登录，已登录跳转我的收藏页
   */
  onTapStatFavorites() {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    this.goFavorites()
  },


  /**
   * 退出登录
   * userStore.logout() 会清除全局用户状态、清除本地会话，
   * 并通知服务端撤销会话（置「主动退出」标记，不再被静默登录顶回）
   */
  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      confirmText: '退出',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (!res.confirm) return
        // 清理 app.globalData，避免退到登录页瞬间仍显示已登录
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.isLoggedIn = false
          app.globalData.userInfo = null
        }
        // 清除全局用户状态 + 本地会话 + 服务端会话
        userStore.logout()
        this.resetToGuest()
        wx.showToast({ title: '已退出登录', icon: 'none' })
        // 跳转登录页
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/user/login/index' })
        }, 400)
      }
    })
  }
})
