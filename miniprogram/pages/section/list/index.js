// pages/section/list/index.js
// 板块专区页 - 每个板块的独立内容页面
// 通过 URL 参数 section 指定板块，展示该板块下的所有帖子
// 支持排序（推荐/最新/热门）、分页加载、下拉刷新、点赞、发帖

const api = require('../../../api/index.js')
const eventBus = require('../../../store/eventBus.js')
const { getSectionMeta } = require('../../../utils/shared/constants.js')
const userStore = require('../../../store/user')

/**
 * 摘要截断（Skyline 不支持 line-clamp，置顶条文字需 JS 截断）
 * @param {string} text 原始文本
 * @param {number} max 最大字符数
 * @returns {string} 截断后的文本
 */
function truncateText(text, max) {
  if (!text) return ''
  const t = String(text).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

Page({
  /**
   * 页面数据
   */
  data: {
    // 板块标识
    section: '',
    // 板块中文名
    sectionName: '',
    // 板块主题色（仅用于图标底与小圆点标识）
    sectionColor: '#4A90D9',
    // 板块图标路径
    sectionIcon: '',
    // 板块帖子总数（页头展示）
    total: 0,
    // 是否已关注当前板块
    followed: false,
    // 关注/取关请求进行中（防抖）
    followPending: false,
    // 置顶公告帖（推荐流第一页的置顶帖，无则为 null）
    pinnedPost: null,
    // 排序 Tab
    sortTabs: [
      { key: 'recommend', name: '推荐' },
      { key: 'latest', name: '最新' },
      { key: 'hot', name: '热门' },
      { key: 'essence', name: '精华' }
    ],
    // 当前排序模式
    currentSort: 'recommend',
    // 帖子列表
    posts: [],
    // 游标：0 表示首页，>0 表示上一页最后一条的 sortTime
    cursor: 0,
    // 每页条数
    pageSize: 20,
    // 总数
    total: 0,
    // 是否正在加载
    loading: false,
    // 是否还有更多
    hasMore: true,
    // 点赞状态映射
    likedMap: {},
    // 是否首次加载
    firstLoading: true,
    // 下拉刷新触发状态
    refresherTriggered: false,
    // 当前用户是否被封禁（封禁用户展示提示而非内容）
    isBanned: false
  },

  /**
   * 页面加载
   * 解析 URL 参数，初始化板块信息并加载帖子
   */
  onLoad(options) {
    const section = options.section || ''
    if (!section) {
      wx.showToast({ title: '板块不存在', icon: 'none' })
      setTimeout(() => { wx.navigateBack() }, 1500)
      return
    }

    // ---- 封禁用户拦截：第二道防线，防止通过 URL 直接进入 ----
    if (userStore.isBanned()) {
      this.setData({ isBanned: true, firstLoading: false })
    }

    // 订阅 userStore 变化：app.js 从服务端同步封禁状态后实时拦截
    // 覆盖"页面已打开但封禁状态尚未同步"的场景
    this._offUserStore = userStore.subscribe((newState) => {
      const banned = !!(newState.userInfo && newState.userInfo.status === 'banned')
      if (banned && !this.data.isBanned) {
        this.setData({
          isBanned: true,
          firstLoading: false,
          posts: []
        })
      }
    })

    // 若已被封禁则不加载帖子
    if (this.data.isBanned) return

    // 获取板块元数据
    const meta = getSectionMeta(section)
    // 板块图标路径
    const iconMap = {
      emotion:    '/images/icons/discover/emotion.png',
      secondhand: '/images/icons/discover/secondhand.png',
      parttime:   '/images/icons/discover/parttime.png',
      carpool:    '/images/icons/discover/carpool.png',
      activity:   '/images/icons/discover/activity.png',
      help:       '/images/icons/discover/help.png',
      daily:      '/images/icons/discover/daily.png'
    }

    this.setData({
      section,
      sectionName: meta.name,
      sectionColor: meta.color,
      sectionIcon: iconMap[section] || ''
    })

    // 拉取关注状态（未登录静默跳过）
    this.loadFollowState()

    // 加载帖子
    this.loadPosts(true)

    // 监听用户资料更新（昵称/头像修改后刷新）
    this._offProfileUpdate = eventBus.on('profileUpdated', () => {
      this._needRefresh = true
    })

    // 监听发帖/点赞/评论后的刷新事件
    this._offRefresh = eventBus.on('refreshFeed', () => {
      this._needRefresh = true
    })
  },

  /**
   * 页面显示
   * 如果有待刷新标志，重新加载帖子
   * 同步封禁状态（app.js onShow 可能已触发服务端同步）
   */
  onShow() {
    // 同步封禁状态：若刚被封禁则立即拦截
    const banned = userStore.isBanned()
    if (banned && !this.data.isBanned) {
      this.setData({ isBanned: true, firstLoading: false, posts: [] })
      return
    }
    if (this._needRefresh && !this.data.isBanned) {
      this._needRefresh = false
      this.loadPosts(true)
    }
  },

  /**
   * 页面卸载
   * 清理事件监听器
   */
  onUnload() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
    }
    if (typeof this._offRefresh === 'function') {
      this._offRefresh()
    }
    if (typeof this._offUserStore === 'function') {
      this._offUserStore()
    }
  },

  /**
   * 加载帖子列表（游标分页 + 服务端排序 + 请求竞态保护）
   * @param {boolean} reset 是否重置到第一页
   */
  loadPosts(reset = false) {
    if (this.data.loading) return

    const cursor = reset ? 0 : this.data.cursor

    // 请求序列号：防止切换排序时旧请求覆盖新结果
    const seq = (this._postsSeq || 0) + 1
    this._postsSeq = seq

    this.setData({
      loading: true,
      cursor,
      hasMore: reset ? true : this.data.hasMore,
      firstLoading: reset ? true : this.data.firstLoading
    })

    api.post.feed({
      module: 'community',
      section: this.data.section,
      cursor,
      pageSize: this.data.pageSize,
      sort: this.data.currentSort
    })
      .then((res) => {
        // 序列号校验：丢弃过期请求结果
        if (seq !== this._postsSeq) return

        const data = (res && res.data) || {}
        const list = data.list || data.posts || []
        const total = data.total || 0
        const nextCursor = data.nextCursor || 0

        const merged = reset ? list : this.data.posts.concat(list)

        const patch = {
          posts: merged,
          total,
          hasMore: data.hasMore || false,
          cursor: nextCursor,
          firstLoading: false
        }
        // 置顶公告条：仅从推荐流第一页提取置顶帖（后端按 isTop 优先返回且已清理过期标记）
        if (reset && this.data.currentSort === 'recommend') {
          const found = merged.find((p) => p.isTop)
          patch.pinnedPost = found
            ? {
                _id: found._id,
                _pinText: truncateText(found.title || found.content, 60)
              }
            : null
        }

        this.setData(patch)

        // 拉取当前页帖子的点赞状态
        this.checkLiked(list)
      })
      .catch((err) => {
        if (seq !== this._postsSeq) return
        console.error('[section] 加载帖子失败:', err)
        // 弱网友好提示
        const msg = (err && err.message && err.message.indexOf('超时') !== -1)
          ? '网络超时，请下拉刷新'
          : '加载失败，请重试'
        wx.showToast({ title: msg, icon: 'none' })
        this.setData({ firstLoading: false })
      })
      .then(() => {
        if (seq !== this._postsSeq) return
        this.setData({ loading: false })
        wx.stopPullDownRefresh()
        this.setData({ refresherTriggered: false })
      })
  },

  /**
   * 批量检查帖子点赞状态
   * P0-6 优化：优先使用服务端返回的 liked 字段，降级调用 batchCheck
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
        console.warn('[section] 点赞状态拉取失败:', err)
      })
  },

  /**
   * 切换排序模式
   * 重置列表并从第一页按新排序模式拉取（服务端排序）
   */
  onSortChange(e) {
    const { key } = e.detail
    if (key === this.data.currentSort) return
    this.setData({
      currentSort: key,
      posts: [],
      cursor: 0,
      hasMore: true,
      firstLoading: true
    })
    this.loadPosts(true)
  },

  /**
   * 点击帖子，跳转详情页
   * 防抖：防止快速连续点击
   */
  onPostTap(e) {
    if (this._navPending) return
    const postId = e.detail.postId
    if (!postId) return

    this._navPending = true
    wx.navigateTo({
      url: `/pages/post/detail/index?postId=${postId}`,
      complete: () => {
        setTimeout(() => {
          this._navPending = false
        }, 300)
      }
    })
  },

  /**
   * 点击置顶公告条，跳转对应帖子详情
   */
  onPinnedTap() {
    const pinned = this.data.pinnedPost
    if (!pinned || this._navPending) return

    this._navPending = true
    wx.navigateTo({
      url: `/pages/post/detail/index?postId=${pinned._id}`,
      complete: () => {
        setTimeout(() => {
          this._navPending = false
        }, 300)
      }
    })
  },

  /**
   * 拉取当前用户对当前板块的关注状态（未登录静默跳过）
   */
  loadFollowState() {
    if (!userStore.state.isLoggedIn) return
    api.post.myFollowSections()
      .then((res) => {
        const sections = (res && res.data && res.data.sections) || []
        this.setData({ followed: sections.indexOf(this.data.section) !== -1 })
      })
      .catch(() => { /* 静默：关注状态拉取失败不提示 */ })
  },

  /**
   * 关注/取关板块（乐观更新 + 失败回滚）
   * 未登录引导跳转登录页
   */
  onToggleFollow() {
    if (this.data.followPending) return
    if (!userStore.state.isLoggedIn) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }

    const next = !this.data.followed
    this.setData({ followed: next, followPending: true })

    const call = next ? api.post.followSection : api.post.unfollowSection
    call(this.data.section)
      .then((res) => {
        if (res && (res.code === 0 || res.code === 200)) {
          wx.showToast({ title: next ? '已关注，有新帖会提醒你' : '已取消关注', icon: 'none' })
        } else {
          throw new Error((res && res.message) || '操作失败')
        }
      })
      .catch(() => {
        // 失败回滚
        this.setData({ followed: !next })
        wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      })
      .then(() => {
        this.setData({ followPending: false })
      })
  },

  /**
   * 点击点赞
   * 乐观更新 + 防抖
   */
  onLikeTap(e) {
    const { postId } = e.detail
    if (!postId) return

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

    // 防抖
    this._likePending = this._likePending || {}
    if (this._likePending[postId]) return

    const liked = !!this.data.likedMap[postId]
    // 找到当前帖子获取点赞数
    const post = this.data.posts.find(p => p._id === postId)
    const stats = (post && post.stats) || {}
    const currentLikes = stats.likes || 0

    // 乐观更新点赞状态
    const likedMap = Object.assign({}, this.data.likedMap)
    likedMap[postId] = !liked
    this.setData({ likedMap })

    // 乐观更新帖子点赞数
    if (post) {
      const posts = this.data.posts.map(p => {
        if (p._id === postId) {
          const next = Object.assign({}, p)
          const statsNew = Object.assign({}, next.stats || {})
          statsNew.likes = Math.max(0, currentLikes + (liked ? -1 : 1))
          next.stats = statsNew
          return next
        }
        return p
      })
      this.setData({ posts })
    }

    this._likePending[postId] = true
    api.like.toggle(postId, 'post')
      .then(() => {
        eventBus.emit('refreshFeed')
      })
      .catch((err) => {
        console.error('[section] 点赞失败:', err)
        // 回滚
        const rollbackMap = Object.assign({}, this.data.likedMap)
        rollbackMap[postId] = liked
        this.setData({ likedMap: rollbackMap })
        if (post) {
          const posts = this.data.posts.map(p => {
            if (p._id === postId) {
              const next = Object.assign({}, p)
              const statsNew = Object.assign({}, next.stats || {})
              statsNew.likes = currentLikes
              next.stats = statsNew
              return next
            }
            return p
          })
          this.setData({ posts })
        }
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._likePending[postId] = false
      })
  },

  /**
   * 下拉刷新
   */
  onRefresherRefresh() {
    this.setData({ refresherTriggered: true })
    this.loadPosts(true)
  },

  /**
   * 滚动到底部加载更多（游标分页）
   */
  onLoadMore() {
    if (this.data.loading || !this.data.hasMore) return
    this.loadPosts(false)
  },

  /**
   * 点击发帖按钮
   * 跳转到发帖页，自动带上板块标签
   */
  onTapPublish() {
    if (this._navPending) return
    this._navPending = true
    wx.navigateTo({
      url: `/pages/post/publish/index?section=${this.data.section}`,
      complete: () => {
        setTimeout(() => {
          this._navPending = false
        }, 300)
      }
    })
  }
})
