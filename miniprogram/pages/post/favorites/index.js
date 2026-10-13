// pages/post/favorites/index.js
// 我的收藏页
// 展示当前用户收藏过的帖子列表，支持分页加载

const api = require('../../../api/index.js')
const eventBus = require('../../../store/eventBus.js')
const userStore = require('../../../store/user')

Page({
  /**
   * 页面数据
   */
  data: {
    // 收藏列表
    list: [],
    // 当前页码
    page: 1,
    // 每页条数
    pageSize: 20,
    // 是否还有更多
    hasMore: true,
    // 是否正在加载
    loading: false,
    // 是否首次加载
    firstLoading: true,
    // 点赞状态映射 { postId: true/false }
    likedMap: {},
    // 下拉刷新状态（控制 scroll-view 的 refresher-triggered）
    refreshing: false
  },

  /**
   * 页面加载
   * 封禁用户拦截：防止通过 URL 直接进入（第二道防线）
   */
  onLoad() {
    // ---- 封禁用户拦截 ----
    if (userStore.isBanned()) {
      this.setData({ loading: false, firstLoading: false })
      wx.showToast({ title: '账号已被封禁，无法查看内容', icon: 'none' })
      setTimeout(() => { wx.navigateBack() }, 1500)
      return
    }

    this.loadFavorites(true)
  },

  /**
   * 监听用户资料更新，刷新收藏列表的作者信息
   */
  onShow() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
    }
    this._offProfileUpdate = eventBus.on('profileUpdated', () => {
      this.loadFavorites(true)
    })
    // 每次回到页面都刷新：详情页取消收藏/新收藏后返回列表能同步
    this.loadFavorites(true)
  },

  onUnload() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
      this._offProfileUpdate = null
    }
  },

  /**
   * 加载收藏列表
   * @param {boolean} reset 是否重置到第一页
   */
  loadFavorites(reset = false) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page
    this.setData({
      loading: true,
      page,
      hasMore: reset ? true : this.data.hasMore,
      firstLoading: reset ? true : this.data.firstLoading
    })

    return api.favorite.list(page)
      .then((res) => {
        const data = (res && res.data) || {}
        // 云函数返回完整帖子对象列表（已关联 posts 集合，已过滤已删除帖子）
        const list = data.list || []
        // 使用服务端返回的 hasMore 标志，比 merged.length < total 更可靠
        // （total 是过滤后的当前页有效数，不适合做分页判断）
        const hasMore = data.hasMore || false

        const merged = reset ? list : this.data.list.concat(list)

        this.setData({
          list: merged,
          hasMore,
          firstLoading: false
        })

        // 拉取当前页帖子的点赞状态
        this.checkLiked(list)
      })
      .catch((err) => {
        console.error('[favorites] 加载收藏失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ firstLoading: false })
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 点击帖子跳转详情
   * 通过路由分发工具按 refType 跳转到对应业务详情页
   */
  onPostTap(e) {
    const { postId, refType, refId } = e.detail
    const route = require('../../../utils/route.js')
    route.navigateToDetail({ _id: postId, refType, refId })
  },

  /**
   * 批量检查帖子点赞状态
   * P0-6 优化：优先使用服务端返回的 liked 字段，降级调用 batchCheck
   * @param {Array} list 当前页帖子列表
   */
  checkLiked(list) {
    if (!list || !list.length) return

    // 优先使用服务端返回的 liked 字段，避免额外 API 调用
    var hasServerLiked = list.some(function(p) { return typeof p.liked === 'boolean' })
    if (hasServerLiked) {
      var map = {}
      list.forEach(function(p) {
        if (p.liked) map[p._id] = true
      })
      this.setData({
        likedMap: Object.assign({}, this.data.likedMap, map)
      })
      return
    }

    // 降级：服务端未返回 liked 字段时，调用 batchCheck API
    var ids = list.map(function(p) { return p._id })
    api.like.batchCheck(ids, 'post')
      .then((res) => {
        var likedIds = (res && res.data && res.data.likedIds) || []
        var map = {}
        likedIds.forEach(function(id) { map[id] = true })
        this.setData({
          likedMap: Object.assign({}, this.data.likedMap, map)
        })
      })
      .catch(function(err) {
        console.warn('[favorites] 点赞状态拉取失败:', err)
      })
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
    if (this._likePending && this._likePending[postId]) return

    const liked = !!this.data.likedMap[postId]
    // 乐观更新：先切换本地状态
    const likedMap = Object.assign({}, this.data.likedMap)
    likedMap[postId] = !liked
    this.setData({ likedMap })

    // 同步更新对应帖子的点赞数
    const list = this.data.list.map(function(p) {
      if (p._id === postId) {
        var next = Object.assign({}, p)
        var stats = Object.assign({}, next.stats || {})
        stats.likes = Math.max(0, (stats.likes || 0) + (liked ? -1 : 1))
        next.stats = stats
        return next
      }
      return p
    })
    this.setData({ list: list })

    // 标记防抖
    if (!this._likePending) this._likePending = {}
    this._likePending[postId] = true

    api.like.toggle(postId, 'post')
      .catch((err) => {
        console.error('[favorites] 点赞失败:', err)
        // 回滚
        var rollbackMap = Object.assign({}, this.data.likedMap)
        rollbackMap[postId] = liked
        var rollbackList = this.data.list.map(function(p) {
          if (p._id === postId) {
            var next = Object.assign({}, p)
            var stats = Object.assign({}, next.stats || {})
            stats.likes = Math.max(0, (stats.likes || 0) + (liked ? 1 : -1))
            next.stats = stats
            return next
          }
          return p
        })
        this.setData({ likedMap: rollbackMap, list: rollbackList })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._likePending[postId] = false
      })
  },

  /**
   * 上拉加载更多
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadFavorites(false)
  },

  /**
   * 下拉刷新（scroll-view refresher 回调）
   * P1：此前依赖 onPullDownRefresh，但页面用全屏 scroll-view 承接滚动，
   * 原生下拉不会触发，属死代码；现改走 scroll-view 的 refresher-enabled。
   */
  onRefresh() {
    this.setData({ refreshing: true })
    Promise.resolve(this.loadFavorites(true))
      .then(() => { this.setData({ refreshing: false }) })
      .catch(() => { this.setData({ refreshing: false }) })
  }
})
