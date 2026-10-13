// pages/feed/index.js
// 首页 - 社区信息流（改版）
// 搜索栏 + Banner 轮播 + 功能宫格 + 排序 Tab + 帖子分页列表 + 点赞状态批量拉取

const api = require('../../api/index.js')
const { formatTime } = require('../../utils/format.js')
const eventBus = require('../../store/eventBus.js')
const storage = require('../../utils/storage.js')
const schools = require('../../utils/schools.js')
const userStore = require('../../store/user')
const { checkBanBeforeNavigate } = require('../../utils/ban-check.js')

Page({
  /**
   * 页面数据
   */
  data: {
    // ===== Banner 轮播数据 =====
    // 主图（主）放第一张，停留时间更长；其余按顺序切换
    banners: [
      {
        id: 0,
        image: '/images/banners/banner-main.jpg',
        link: '',
        interval: 6000  // 主图停留 6 秒
      },
      {
        id: 1,
        image: '/images/banners/banner-1.jpg',
        link: '',
        interval: 3500  // 普通横幅停留 3.5 秒
      },
      {
        id: 2,
        image: '/images/banners/banner-2.jpg',
        link: '',
        interval: 3500
      },
      {
        id: 3,
        image: '/images/banners/banner-3.jpg',
        link: '',
        interval: 3500
      },
      {
        id: 4,
        image: '/images/banners/banner-4.jpg',
        link: '',
        interval: 3500
      }
    ],
    // 当前 swiper 当前页索引（手动控制切换）
    bannerCurrent: 0,

    // ===== 功能宫格（可折叠）=====
    // 常驻高频功能行：折叠时始终展示，4 项高频入口
    // 图标统一使用 discover 目录彩色图标，与发现页保持一致
    gridPinnedItems: [
      {
        key: 'help',
        name: '求助问答',
        icon: '/images/icons/discover/help.png',
        color: '#2ECC71', // 翠绿
        type: 'section',
        section: 'help'
      },
      {
        key: 'daily',
        name: '闲聊吐槽',
        icon: '/images/icons/discover/daily.png',
        color: '#4A90D9', // 天蓝
        type: 'section',
        section: 'daily'
      },
      {
        key: 'secondhand',
        name: '二手交易',
        icon: '/images/icons/discover/secondhand.png',
        color: '#E67E22', // 橙
        type: 'section',
        section: 'secondhand'
      },
      {
        key: 'emotion',
        name: '表白墙',
        icon: '/images/icons/discover/emotion.png',
        color: '#E74C8F', // 粉
        type: 'section',
        section: 'emotion'
      }
    ],
    // 展开后的额外功能行：折叠时收起，释放信息流空间
    gridExtraItems: [
      {
        key: 'lostfound',
        name: '失物招领',
        icon: '/images/icons/discover/lostfound.png',
        color: '#3498DB', // 蓝
        type: 'module',
        url: '/pages/lostfound/index/index'
      },
      {
        key: 'parttime',
        name: '兼职信息',
        icon: '/images/icons/discover/parttime.png',
        color: '#F39C12', // 暖黄
        type: 'section',
        section: 'parttime'
      },
      {
        key: 'carpool',
        name: '拼车搭子',
        icon: '/images/icons/discover/carpool.png',
        color: '#1ABC9C', // 青绿
        type: 'section',
        section: 'carpool'
      },
      {
        key: 'activity',
        name: '活动组队',
        icon: '/images/icons/discover/activity.png',
        color: '#6C5CE7', // 紫
        type: 'section',
        section: 'activity'
      }
    ],
    // 宫格折叠状态：false=展开八宫格，true=仅展示高频常驻栏
    gridCollapsed: false,

    // ===== 排序 Tab（替代原板块切换条） =====
    sortTabs: [
      { key: 'recommend', name: '推荐' },
      { key: 'latest', name: '最新' },
      { key: 'hot', name: '热门' },
      { key: 'school', name: '同校' }
    ],
    // 当前排序模式
    currentSort: 'recommend',

    // ===== 板块筛选（由宫格社区板块入口设置） =====
    currentSection: '',
    currentSectionName: '',

    // ===== 帖子列表状态 =====
    posts: [],
    // 游标：0 表示首页，>0 表示上一页最后一条的 sortTime
    cursor: 0,
    pageSize: 20,
    total: 0,
    loading: false,
    hasMore: true,
    likedMap: {},
    firstLoading: true,
    // scroll-view 自定义下拉刷新触发状态
    refresherTriggered: false,
    // SWR 缓存时间戳（内存缓存，30 秒内复用，超时后台刷新）
    _cacheTime: 0,
    // 当前用户是否被封禁（封禁用户信息流返回空，显示专属提示）
    isBanned: false,

    // ===== 定位学校（导航栏左上角选择器） =====
    // 名单见 utils/schools.js；本地只存 id，未选择过时用「定位推荐」学校（当前为杭电信工）
    schoolList: schools.getList(),
    currentSchool: schools.getDefault(),
    schoolPickerVisible: false
  },

  /**
   * 页面加载
   * 初始化并加载第一页
   */
  onLoad() {
    // 读取本地存储的宫格折叠状态：默认收起，仅保留高频功能行；老用户记忆上次状态
    const collapsed = storage.get('feed_grid_collapsed', true)
    // 恢复上次选择的学校；未选择过（或名单调整导致本地 id 失效）时回落到定位推荐学校
    this.setData({
      gridCollapsed: collapsed !== false,
      currentSchool: schools.getCurrent()
    })
    this.loadFeed(true)
  },

  /**
   * 页面显示
   * 更新自定义 TabBar 选中态为首页（索引 0）
   * 注册 eventBus 的 refreshFeed 事件（发帖/详情页操作后刷新）
   * 注意：不在 onHide 中解绑，避免发帖页 emit 时首页收不到事件
   */
  onShow() {
    // Skyline 模式下 getTabBar 为异步回调，WebView 模式为同步返回
    if (typeof this.getTabBar === 'function') {
      const result = this.getTabBar((tabBar) => {
        if (tabBar && typeof tabBar.updateSelected === 'function') {
          tabBar.updateSelected(0)
        }
      })
      if (result && typeof result.updateSelected === 'function') {
        result.updateSelected(0)
      }
    }

    // 先解绑旧监听器（避免重复注册），再注册新的
    if (typeof this._offRefresh === 'function') {
      this._offRefresh()
    }
    this._offRefresh = eventBus.on('refreshFeed', () => {
      this._needRefresh = true
    })

    // ---- 同步当前用户封禁状态 ----
    // 封禁用户信息流返回空列表，前端展示专属提示而非「还没有帖子」
    this.setData({ isBanned: userStore.isBanned() })

    // 订阅 userStore 变化：app.js 从服务端同步封禁状态后实时更新
    if (typeof this._offUserStore === 'function') {
      this._offUserStore()
    }
    this._offUserStore = userStore.subscribe((newState) => {
      const banned = !!(newState.userInfo && newState.userInfo.status === 'banned')
      if (banned !== this.data.isBanned) {
        this.setData({
          isBanned: banned,
          // 封禁时清空帖子列表，避免残留内容
          posts: banned ? [] : this.data.posts,
          firstLoading: false
        })
      }
    })

    // 监听用户资料更新（昵称/头像修改后刷新帖子列表的作者信息）
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
    }
    this._offProfileUpdate = eventBus.on('profileUpdated', () => {
      this._needRefresh = true
    })

    // 监听发现页板块跳转（从发现页点击板块后切换到首页并设置筛选）
    if (typeof this._offDiscoverSection === 'function') {
      this._offDiscoverSection()
    }
    this._offDiscoverSection = eventBus.on('discoverSectionTap', (data) => {
      this._pendingSection = data
    })

    // 如果有待处理的板块跳转（从发现页切换过来），应用板块筛选
    if (this._pendingSection) {
      const { section, name } = this._pendingSection
      this._pendingSection = null
      this.setData({
        currentSection: section,
        currentSectionName: name,
        currentSort: 'recommend',
        posts: [],
        cursor: 0,
        hasMore: true,
        firstLoading: true,
        _cacheTime: 0
      })
      this.loadFeed(true)
    } else if (this._needRefresh) {
      // 如果有待刷新标志（发帖页返回时），立即刷新
      this._needRefresh = false
      this.setData({ _cacheTime: 0 })
      this.loadFeed(true)
    }

    // 启动 Banner 轮播定时器（手动控制，支持每张不同停留时间）
    this._startBannerTimer()
  },

  /**
   * 页面隐藏
   * 不解绑 refreshFeed 监听器，保证发帖页 emit 时首页能收到
   */
  onHide() {
    // 保留监听器，仅记录待刷新状态由 emit 设置
    // 停止 Banner 轮播，避免后台浪费资源
    this._stopBannerTimer()
  },

  /**
   * 页面卸载
   */
  onUnload() {
    if (typeof this._offRefresh === 'function') {
      this._offRefresh()
      this._offRefresh = null
    }
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
      this._offProfileUpdate = null
    }
    if (typeof this._offDiscoverSection === 'function') {
      this._offDiscoverSection()
      this._offDiscoverSection = null
    }
    // 清理 userStore 订阅
    if (typeof this._offUserStore === 'function') {
      this._offUserStore()
      this._offUserStore = null
    }
    // 清理 Banner 定时器
    this._stopBannerTimer()
  },

  /**
   * 启动 Banner 轮播定时器
   * 根据当前页的 interval 字段设置不同停留时间，到时后切换下一张
   */
  _startBannerTimer() {
    this._stopBannerTimer()
    const banners = this.data.banners
    if (!banners || banners.length <= 1) return
    const current = this.data.bannerCurrent || 0
    const interval = (banners[current] && banners[current].interval) || 3500
    this._bannerTimer = setTimeout(() => {
      const next = (this.data.bannerCurrent + 1) % banners.length
      this.setData({ bannerCurrent: next })
      // 递归启动下一轮
      this._startBannerTimer()
    }, interval)
  },

  /**
   * 停止 Banner 轮播定时器
   */
  _stopBannerTimer() {
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer)
      this._bannerTimer = null
    }
  },

  /**
   * 用户手动滑动 Banner 后重置定时器
   * 按当前页的 interval 重新计时
   */
  onBannerChange(e) {
    const current = e.detail.current
    if (current === this.data.bannerCurrent) return
    this.setData({ bannerCurrent: current })
    // 用户手动滑动后，按当前页间隔重新计时
    this._startBannerTimer()
  },

  /**
   * 加载信息流（游标分页 + SWR 缓存 + 请求竞态保护）
   *
   * SWR 策略：
   *   - 首页请求（reset=true）30 秒内复用内存缓存，跳过网络请求
   *   - 超时后静默后台刷新，用户无感知
   *   - 切换排序/板块/下拉刷新时强制清除缓存
   *
   * 竞态保护：
   *   - 每次请求递增 _feedSeq 序列号
   *   - 响应返回时校验序列号，丢弃过期请求结果
   *   - 防止快速切换排序时旧请求覆盖新数据
   *
   * @param {boolean} reset 是否重置到第一页
   */
  loadFeed(reset = false) {
    if (this.data.loading) return

    const now = Date.now()

    // ---- SWR 缓存：首页且 30 秒内有缓存数据时，跳过请求 ----
    if (reset && this.data._cacheTime && now - this.data._cacheTime < 30 * 1000 && this.data.posts.length > 0) {
      this.setData({ loading: false, refresherTriggered: false })
      wx.stopPullDownRefresh()
      return Promise.resolve()
    }

    const cursor = reset ? 0 : this.data.cursor

    // ---- 请求序列号：防止切换排序/板块时旧请求覆盖新结果 ----
    const seq = (this._feedSeq || 0) + 1
    this._feedSeq = seq

    this.setData({
      loading: true,
      cursor,
      hasMore: reset ? true : this.data.hasMore
    })

    api.post.feed({
      module: 'community',
      section: this.data.currentSection,
      cursor,
      pageSize: this.data.pageSize,
      sort: this.data.currentSort
    })
      .then((res) => {
        // 序列号校验：丢弃过期请求结果
        if (seq !== this._feedSeq) return

        const data = (res && res.data) || {}
        const list = data.list || data.posts || []
        const total = data.total || 0
        const nextCursor = data.nextCursor || 0

        const merged = reset ? list : this.data.posts.concat(list)

        this.setData({
          posts: merged,
          total,
          hasMore: data.hasMore || false,
          cursor: nextCursor,
          firstLoading: false,
          // 仅首页请求成功时更新缓存时间戳
          _cacheTime: reset ? now : this.data._cacheTime
        })

        // 拉取当前页帖子的点赞状态
        this.checkLiked(list)
      })
      .catch((err) => {
        if (seq !== this._feedSeq) return
        console.error('[feed] 加载信息流失败:', err)
        // 弱网友好提示：区分超时和其他错误
        const msg = (err && err.message && err.message.indexOf('超时') !== -1)
          ? '网络超时，请下拉刷新'
          : '加载失败，请重试'
        wx.showToast({ title: msg, icon: 'none' })
        this.setData({ firstLoading: false })
      })
      .then(() => {
        if (seq !== this._feedSeq) return
        this.setData({ loading: false })
        // 收起 scroll-view 下拉刷新动画
        wx.stopPullDownRefresh()
        this.setData({ refresherTriggered: false })
      })
  },

  /**
   * 批量检查帖子点赞状态
   * 优先使用服务端返回的 liked 字段（P0-6 优化，减少一次 API 调用）
   * 降级：服务端未返回 liked 字段时，调用 batchCheck API
   * @param {Array} list 当前页帖子列表
   */
  checkLiked(list) {
    if (!list || !list.length) return

    // 优先使用服务端返回的 liked 字段，避免额外 API 调用
    const hasServerLiked = list.some(p => typeof p.liked === 'boolean')
    if (hasServerLiked) {
      const map = {}
      list.forEach((p) => {
        if (p.liked) map[p._id] = true
      })
      this.setData({
        likedMap: Object.assign({}, this.data.likedMap, map)
      })
      return
    }

    // 降级：服务端未返回 liked 字段时，调用 batchCheck API
    const ids = list.map(p => p._id)
    api.like.batchCheck(ids, 'post')
      .then((res) => {
        const likedIds = (res && res.data && res.data.likedIds) || []
        const map = {}
        likedIds.forEach((id) => { map[id] = true })
        this.setData({
          likedMap: Object.assign({}, this.data.likedMap, map)
        })
      })
      .catch((err) => {
        console.warn('[feed] 点赞状态拉取失败:', err)
      })
  },

  /**
   * 切换排序模式
   * 重置列表并从第一页按新排序模式拉取（服务端排序）
   * 清除 SWR 缓存，强制重新请求
   * 同校功能 API 暂不支持，提示开发中
   */
  onSortChange(e) {
    const { key } = e.detail
    if (key === this.data.currentSort) return
    // 同校：API 暂不支持，提示开发中
    if (key === 'school') {
      wx.showToast({ title: '同校功能开发中', icon: 'none' })
      return
    }
    // 切换排序：重置列表，清除缓存，从第一页按新排序拉取
    this.setData({
      currentSort: key,
      posts: [],
      cursor: 0,
      hasMore: true,
      firstLoading: true,
      _cacheTime: 0
    })
    this.loadFeed(true)
  },

  /**
   * 点击功能宫格项
   * module 类型：跳转对应业务模块页面
   * section 类型：跳转到板块专区页面
   */
  onTapGridItem(e) {
    const { type, url, section } = e.currentTarget.dataset

    // 封禁用户不可进入内容浏览页面
    if (!checkBanBeforeNavigate()) return

    if (type === 'module') {
      // 业务模块：跳转页面
      if (!url) {
        wx.showToast({ title: '模块即将上线', icon: 'none' })
        return
      }
      wx.navigateTo({
        url,
        fail: () => {
          wx.showToast({ title: '模块即将上线', icon: 'none' })
        }
      })
      return
    }

    // 社区板块：跳转到板块专区页面
    wx.navigateTo({
      url: `/pages/section/list/index?section=${section}`
    })
  },

  /**
   * 切换功能宫格折叠 / 展开
   * 新用户默认展开八宫格；老用户折叠后记忆状态，下次进入保持折叠
   */
  onToggleGrid() {
    const gridCollapsed = !this.data.gridCollapsed
    this.setData({ gridCollapsed })
    // 持久化折叠状态，下次进入恢复
    storage.set('feed_grid_collapsed', gridCollapsed)
  },

  /**
   * 打开「选择学校」面板（导航栏左上角入口）
   */
  onOpenSchoolPicker() {
    this.setData({ schoolPickerVisible: true })
  },

  /**
   * 关闭「选择学校」面板
   * 遮罩点击、关闭按钮、选择后自动关闭都走这里
   */
  onCloseSchoolPicker() {
    this.setData({ schoolPickerVisible: false })
  },

  /**
   * 面板内部点击占位
   * 由 catchtap 绑定，仅用于阻止冒泡到遮罩（否则点面板任意位置都会关闭）
   */
  onNoop() {},

  /**
   * 选择学校
   * 仅做本地持久化 + 同步导航栏文案；当前不改动信息流内容
   * （「同校」排序的按校筛选需要服务端支持，见 onSortChange 的说明）
   * @param {object} e 事件对象，dataset.id 为学校 id
   */
  onSelectSchool(e) {
    const school = schools.setCurrent(e.currentTarget.dataset.id)
    if (!school) {
      wx.showToast({ title: '该学校暂不可选', icon: 'none' })
      return
    }
    const changed = school.id !== this.data.currentSchool.id
    this.setData({ currentSchool: school, schoolPickerVisible: false })
    if (changed) {
      wx.showToast({ title: '已切换到' + school.shortName, icon: 'none' })
    }
  },

  /**
   * 清除板块筛选，回到全板块
   */
  onClearSection() {
    this.setData({
      currentSection: '',
      currentSectionName: '',
      posts: [],
      cursor: 0,
      hasMore: true,
      firstLoading: true,
      _cacheTime: 0
    })
    this.loadFeed(true)
  },

  /**
   * 点击 Banner
   * link 为空时无动作，有 link 时跳转
   */
  onTapBanner(e) {
    const { link } = e.currentTarget.dataset
    if (link) {
      wx.navigateTo({ url: link })
    }
  },

  /**
   * 点击帖子卡片，跳转详情页
   * 通过路由分发工具按 refType 跳转到对应业务详情页
   * 添加防抖：防止快速点击导致重复 navigateTo（Skyline 下会报 webviewId 错误）
   */
  onPostTap(e) {
    if (this._navigating) return
    const { postId, refType, refId } = e.detail
    if (!postId) return
    this._navigating = true
    const route = require('../../utils/route.js')
    route.navigateToDetail({ _id: postId, refType, refId })
    // 300ms 后恢复，允许下次跳转
    setTimeout(() => { this._navigating = false }, 300)
  },

  /**
   * 点击帖子点赞按钮
   * 乐观更新 + 防抖：同一帖子的点赞请求进行中时忽略后续点击
   */
  onLikeTap(e) {
    const { postId } = e.detail
    // 未登录引导（P0-6：与详情页对齐，避免静默失败后只看到「操作失败」）
    if (!userStore.state.isLoggedIn) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    // 封禁用户不可点赞
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法点赞', icon: 'none' })
      return
    }
    // 防抖：该帖子已有点赞请求在进行中，忽略本次点击
    if (this._likePending && this._likePending[postId]) return

    const liked = !!this.data.likedMap[postId]
    // 乐观更新：先切换本地状态
    const likedMap = Object.assign({}, this.data.likedMap)
    likedMap[postId] = !liked
    this.setData({ likedMap })

    // 同步更新对应帖子的点赞数（stats.likes）
    const posts = this.data.posts.map(p => {
      if (p._id === postId) {
        const next = Object.assign({}, p)
        const stats = Object.assign({}, next.stats || {})
        stats.likes = Math.max(0, (stats.likes || 0) + (liked ? -1 : 1))
        next.stats = stats
        return next
      }
      return p
    })
    this.setData({ posts })

    // 标记防抖
    if (!this._likePending) this._likePending = {}
    this._likePending[postId] = true

    api.like.toggle(postId, 'post')
      .catch((err) => {
        console.error('[feed] 点赞失败:', err)
        // 回滚 likedMap
        const rollbackMap = Object.assign({}, this.data.likedMap)
        rollbackMap[postId] = liked
        // 回滚 posts 中的 stats.likes
        const rollbackPosts = this.data.posts.map(p => {
          if (p._id === postId) {
            const next = Object.assign({}, p)
            const stats = Object.assign({}, next.stats || {})
            stats.likes = Math.max(0, (stats.likes || 0) + (liked ? 1 : -1))
            next.stats = stats
            return next
          }
          return p
        })
        this.setData({ likedMap: rollbackMap, posts: rollbackPosts })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._likePending[postId] = false
      })
  },

  /**
   * 上拉加载更多（游标分页：直接用 this.data.cursor 续页）
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadFeed(false)
  },

  /**
   * scroll-view 自定义下拉刷新
   * 清除 SWR 缓存，强制重新请求
   */
  onRefresherRefresh() {
    this.setData({ refresherTriggered: true, _cacheTime: 0 })
    this.loadFeed(true)
  },

  /**
   * 点击搜索栏，跳转全局搜索页
   */
  onTapSearch() {
    wx.navigateTo({ url: '/pages/search/index' })
  }
})
