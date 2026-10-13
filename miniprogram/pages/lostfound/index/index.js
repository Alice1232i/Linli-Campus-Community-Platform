// pages/lostfound/index/index.js
// 招领中心 - 失物招领 / 寻物启事 列表
// 提供 lost / found 双 tab 切换 + 分页列表 + 悬浮发布入口

const api = require('../../../api/index.js')
const eventBus = require('../../../store/eventBus')
const { formatTime } = require('../../../utils/format')
const userStore = require('../../../store/user')

// 类型映射表
const KIND_MAP = {
  lost: { name: '寻物启事', color: '#FF6B6B' },
  found: { name: '失物招领', color: '#6BCF7F' }
}

Page({
  /**
   * 页面数据
   */
  data: {
    // 双 tab：寻物启事 / 失物招领
    // 语义对齐：lost=丢失物品→寻物启事，found=捡到物品→失物招领
    tabs: [
      { key: 'lost', name: '寻物启事' },
      { key: 'found', name: '失物招领' }
    ],
    // 当前选中类型
    currentTab: 'lost',
    // 列表
    list: [],
    // 当前页码
    page: 1,
    // 是否还有更多
    hasMore: true,
    // 是否正在加载
    loading: false,
    // 是否首次加载
    firstLoading: true,
    // 下拉刷新状态（控制 refresher-triggered）
    refreshing: false,
    // 当前用户是否被封禁（封禁用户展示提示而非内容）
    isBanned: false
  },

  /**
   * 页面加载
   * 初始化加载第一页
   */
  onLoad() {
    // 封禁用户拦截：防止通过 URL 直接进入
    if (userStore.isBanned()) {
      this.setData({ isBanned: true, firstLoading: false })
      return
    }
    // 记录首次加载时间，onShow 节流跳过首次重复加载
    this._lastRefreshAt = Date.now()
    // P1：监听发布页的成功事件，置脏标记
    // 发布成功后返回大厅时 onShow 命中脏标记立即刷新，绕过 30 秒节流
    this._offRefreshLostfound = eventBus.on('refreshLostfound', () => {
      this._dirty = true
    })
    this.loadList(true)
  },

  /**
   * 页面卸载：解绑事件监听
   */
  onUnload() {
    if (this._offRefreshLostfound) {
      this._offRefreshLostfound()
      this._offRefreshLostfound = null
    }
  },

  /**
   * 页面显示：节流刷新
   * P1 修复：此前每次 onShow 都无条件 loadList(true) 整页重载，丢失浏览位置；
   * 现改为「脏标记优先 + 30 秒节流」。
   */
  onShow() {
    // 封禁用户不加载内容
    if (this.data.isBanned) return
    const now = Date.now()
    if (this._dirty) {
      this._dirty = false
      this._lastRefreshAt = now
      this.loadList(true)
      return
    }
    if (this._lastRefreshAt && now - this._lastRefreshAt < 30000) return
    this._lastRefreshAt = now
    this.loadList(true)
  },

  /**
   * 切换 tab
   */
  onTabChange(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.currentTab) return
    // 正在加载时忽略切换，避免 firstLoading 被置 true 后因 loadList 提前 return 而卡住
    if (this.data.loading) return
    this.setData({
      currentTab: key,
      list: [],
      page: 1,
      hasMore: true,
      firstLoading: true
    })
    this.loadList(true)
  },

  /**
   * 加载列表
   * @param {boolean} reset 是否重置到第一页
   */
  loadList(reset = false) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page
    this.setData({
      loading: true,
      page,
      hasMore: reset ? true : this.data.hasMore
    })

    api.lostfound.list(this.data.currentTab, page)
      .then((res) => {
        const data = (res && res.data) || {}
        const list = data.list || data.items || []
        // 给每条记录补上展示文案
        const decorated = list.map((item) => {
          const kindInfo = KIND_MAP[item.kind] || KIND_MAP[this.data.currentTab]
          return Object.assign({}, item, {
            _kindName: kindInfo.name,
            _kindColor: kindInfo.color,
            _timeText: item.eventTime ? formatTime(item.eventTime) : ''
          })
        })
        const merged = reset ? decorated : this.data.list.concat(decorated)

        this.setData({
          list: merged,
          hasMore: list.length >= 10,
          firstLoading: false
        })
      })
      .catch((err) => {
        console.error('[lostfound] 加载列表失败:', err)
        wx.showToast({ title: '加载失败，请重试', icon: 'none' })
        this.setData({ firstLoading: false })
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 下拉刷新（scroll-view refresher 回调）
   * P1：此前依赖 onPullDownRefresh 但页面用全屏 scroll-view 承接滚动，原生下拉不会触发，
   * 属死代码；现改走 scroll-view 的 refresher-enabled。
   */
  onRefresh() {
    if (this.data.isBanned) {
      this.setData({ refreshing: false })
      return
    }
    this.setData({ refreshing: true })
    this._lastRefreshAt = Date.now()
    this._dirty = false
    Promise.resolve(this.loadList(true))
      .then(() => { this.setData({ refreshing: false }) })
      .catch(() => { this.setData({ refreshing: false }) })
  },

  /**
   * 点击列表项，跳转详情
   */
  onTapItem(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/lostfound/detail/index?id=${id}`
    })
  },

  /**
   * 点击悬浮按钮，跳转发布页（带上当前 tab 类型）
   */
  onPublish() {
    wx.navigateTo({
      url: `/pages/lostfound/publish/index?kind=${this.data.currentTab}`
    })
  },

  /**
   * 上拉加载更多
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadList(false)
  }
})
