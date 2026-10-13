// pages/message/index.js
// 消息页 - 通知入口（Tab 页）
// 通知标签展示通知类型入口（带未读红点）+ 最近通知列表（支持触底分页）

const api = require('../../api/index.js')
const { formatTime, sanitizeImageUrl } = require('../../utils/format')
const { isLoggedIn } = require('../../utils/auth')
const { checkBanBeforeNavigate } = require('../../utils/ban-check.js')
const badgeStore = require('../../store/badge.js')

// 默认头像
const DEFAULT_AVATAR = '/images/icons/user.png'

/** 通知类型配置：图标 + 名称 */
const NOTIFY_TYPES = [
  { key: 'like', name: '点赞', icon: '/images/icons/like.png', color: '#FF6B6B' },
  { key: 'comment', name: '评论', icon: '/images/icons/chat_bold.png', color: '#4A90D9' },
  { key: 'favorite', name: '收藏', icon: '/images/icons/heart_outline.png', color: '#6BCF7F' },
  { key: 'system', name: '系统', icon: '/images/icons/megaphone.png', color: '#FFD93D' }
]

Page({
  /**
   * 页面数据
   */
  data: {
    // 通知类型入口（带未读计数）
    notifyTypes: NOTIFY_TYPES.map((t) => Object.assign({}, t, { unread: 0 })),
    // 通知列表（累积已加载页）
    notifyList: [],
    // 通知加载中（首次 / 重置加载）
    notifyLoading: false,
    // 上拉加载更多中
    loadingMore: false,
    // 是否加载失败（P1：区分「加载失败」与「确实为空」，避免失败时误显示暂无通知）
    loadError: false,
    // 下一页页码（已加载页数 + 1）
    page: 1,
    // 是否还有更多通知
    hasMore: true,
    // 当前筛选的通知类型（'' 表示全部），上拉加载时需沿用
    filterType: '',
    // 未读通知总数
    unreadTotal: 0,
    // 下拉刷新状态（控制 refresher-triggered）
    refreshing: false
  },

  /**
   * 页面显示
   * 更新自定义 TabBar 选中态，刷新通知
   * 节流：30秒内不重复请求，避免频繁切 Tab 时的长时间加载
   */
  onShow() {
    // Skyline 异步回调 + WebView 同步返回兼容
    if (typeof this.getTabBar === 'function') {
      const result = this.getTabBar((tabBar) => {
        if (tabBar && typeof tabBar.updateSelected === 'function') {
          tabBar.updateSelected(3)
        }
      })
      if (result && typeof result.updateSelected === 'function') {
        result.updateSelected(3)
      }
    }
    if (isLoggedIn()) {
      // 节流：距上次加载不足 30 秒则跳过，直接用已有数据
      const now = Date.now()
      if (!this._lastLoadTime || now - this._lastLoadTime > 30000) {
        this._lastLoadTime = now
        // 两个请求并行发起，互不阻塞
        this.loadUnreadCount()
        this.loadNotifications(true)
      }
    }
  },

  /**
   * 下拉刷新
   * 强制刷新（忽略节流），刷新完成后关闭刷新动画
   */
  onRefresh() {
    if (!isLoggedIn()) {
      this.setData({ refreshing: false })
      return
    }
    // 标记刷新中
    this.setData({ refreshing: true })
    // 更新节流时间戳，避免 onShow 紧接着重复请求
    this._lastLoadTime = Date.now()
    // 两个请求并行发起，全部完成后关闭刷新动画
    Promise.all([
      this.loadUnreadCount(),
      this.loadNotifications(true)
    ]).then(() => {
      this.setData({ refreshing: false })
    }).catch(() => {
      this.setData({ refreshing: false })
    })
  },

  /**
   * 加载未读通知计数（按类型分组）
   */
  async loadUnreadCount() {
    try {
      const res = await api.notify.unread({ loading: false, silent: true })
      if (res.code === 0) {
        const { total, byType } = res.data
        // 将未读数合并到通知类型配置中
        const types = NOTIFY_TYPES.map((t) => {
          return Object.assign({}, t, { unread: byType[t.key] || 0 })
        })
        this.setData({
          notifyTypes: types,
          unreadTotal: total || 0
        })
      }
    } catch (e) {
      console.error('[message] 加载未读计数失败:', e)
    }
  },

  /**
   * 加载通知列表
   * 使用请求序号防竞态：快速切换类型筛选时，仅最新请求的结果会渲染
   * P1：支持触底分页（此前固定 page=1，超过 20 条的历史通知永远看不到）
   * @param {boolean} [reset=true] 是否重置到第一页（false 表示追加下一页）
   */
  async loadNotifications(reset = true) {
    if (this.data.notifyLoading || this.data.loadingMore) return
    const page = reset ? 1 : this.data.page
    this.setData(reset ? { notifyLoading: true, loadError: false } : { loadingMore: true })
    // 递增请求序号，后续返回的旧请求结果会被丢弃
    this._notifyReqId = (this._notifyReqId || 0) + 1
    const reqId = this._notifyReqId
    try {
      const res = await api.notify.list(this.data.filterType, page, { loading: false, silent: true })
      // 竞态防护：如果期间发起了新请求，丢弃本次结果
      if (reqId !== this._notifyReqId) return
      if (res.code === 0) {
        const data = res.data || {}
        const list = (data.list || []).map((item) => {
          return Object.assign({}, item, {
            _timeText: formatTime(item.createdAt),
            // 净化发送者头像：防止 wxfile:// 临时路径导致加载失败
            senderAvatar: sanitizeImageUrl(item.senderAvatar, DEFAULT_AVATAR),
            _swipeOpen: false
          })
        })
        this.setData({
          notifyList: reset ? list : this.data.notifyList.concat(list),
          page: page + 1,
          hasMore: !!data.hasMore,
          loadError: false
        })
      } else {
        // 业务层失败：仅在重置加载时进入错误态（加载更多失败不必整屏报错）
        this.setData({ loadError: reset })
      }
    } catch (e) {
      console.error('[message] 加载通知列表失败:', e)
      // 网络/服务异常：标记错误态，供页面展示「加载失败 + 重试」而非「暂无通知」
      if (reqId === this._notifyReqId) {
        this.setData({ loadError: reset })
      }
    } finally {
      if (reqId === this._notifyReqId) {
        this.setData({ notifyLoading: false, loadingMore: false })
      }
    }
  },

  /**
   * 上拉加载更多通知（触底分页）
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.notifyLoading || this.data.loadingMore) return
    this.loadNotifications(false)
  },

  /**
   * 通知加载失败后重试（P1 错误态入口）
   */
  onRetryNotify() {
    this.setData({ loadError: false })
    this.loadNotifications(true)
    this.loadUnreadCount()
  },

  /**
   * 点击通知类型入口，按类型筛选通知
   */
  onTapNotifyType(e) {
    const { key } = e.currentTarget.dataset
    // 重新加载该类型的通知
    this.filterNotificationsByType(key)
  },

  /**
   * 按类型筛选通知（重置到第一页，后续分页沿用该类型）
   * 复用 loadNotifications 的分页 + 竞态防护逻辑，避免双份实现漂移
   * @param {string} type 通知类型
   */
  filterNotificationsByType(type) {
    this.setData({ filterType: type || '', hasMore: true })
    return this.loadNotifications(true)
  },

  /**
   * 点击通知项，标记已读并跳转
   */
  onTapNotification(e) {
    // 如果是左滑操作触发的 tap，不执行跳转
    if (this._swipeMoved) return
    const { id, reftype, refid } = e.currentTarget.dataset

    // 先跳转，不阻塞用户操作
    this.navigateByRefType(reftype, refid)

    // 后台标记已读 + 本地乐观更新（不阻塞跳转）
    if (id) {
      // 本地乐观更新：标记该通知为已读，递减未读计数
      const notifyList = this.data.notifyList.map((item) => {
        if (item._id === id) {
          return Object.assign({}, item, { read: true })
        }
        return item
      })
      this.setData({
        notifyList,
        unreadTotal: Math.max(0, this.data.unreadTotal - 1)
      })
      // 后台异步标记已读（不阻塞跳转，失败仅记日志）
      api.notify.markRead(id).catch((err) => {
        console.error('[message] 标记已读失败:', err)
      })
    }

    // 同步刷新全局角标（含未读总数），替代单独的 loadUnreadCount 调用
    badgeStore.refresh(true)
  },

  /**
   * 根据通知引用类型跳转到对应页面
   * 支持帖子、评论、失物招领
   * 封禁用户不可跳转帖子/评论/失物招领等社区内容页面
   * 未匹配到可跳转类型（旧版举报通知 refType='report'、跑腿等已下架业务的历史通知）统一兜底提示，
   * 避免用户点击后「毫无反应」而误判为卡死
   */
  navigateByRefType(refType, refId) {
    if (!refType || !refId) return
    // 社区内容类跳转需检查封禁状态（跑腿已下架，其余通知均为社区内容）
    const communityRefTypes = ['post', 'comment', 'lostfound']
    if (communityRefTypes.indexOf(refType) !== -1) {
      if (!checkBanBeforeNavigate()) return
    }
    const urlMap = {
      post: `/pages/post/detail/index?id=${refId}`,
      comment: `/pages/post/detail/index?id=${refId}`,
      lostfound: `/pages/lostfound/detail/index?id=${refId}`
    }
    const toastUnsupported = () => {
      wx.showToast({ title: '该通知暂不支持查看详情', icon: 'none' })
    }

    const url = urlMap[refType]
    if (url) {
      // fail 兜底：目标页可能已下架（如历史数据指向已删除的页面）
      wx.navigateTo({ url, fail: toastUnsupported })
      return
    }
    toastUnsupported()
  },

  /**
   * 全部已读
   */
  async onMarkAllRead() {
    if (this.data.unreadTotal === 0) {
      wx.showToast({ title: '没有未读通知', icon: 'none' })
      return
    }
    try {
      const res = await api.notify.markAllRead()
      if (res.code === 0) {
        wx.showToast({ title: '已全部已读', icon: 'success' })
        // 刷新数据
        this.loadUnreadCount()
        this.loadNotifications(true)
        // 本地立即清零全局角标，不等轮询
        badgeStore.clearBadge()
      } else {
        wx.showToast({ title: res.message || '操作失败', icon: 'none' })
      }
    } catch (e) {
      console.error('[message] 全部已读失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  /**
   * 清空全部通知
   */
  onClearAll() {
    if (this.data.notifyList.length === 0) {
      wx.showToast({ title: '暂无通知可清空', icon: 'none' })
      return
    }
    wx.showModal({
      title: '提示',
      content: '确定要清空全部通知吗？此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (!res.confirm) return
        api.notify.clearAll()
          .then((res2) => {
            if (res2.code === 0) {
              wx.showToast({ title: '已清空', icon: 'success' })
              // 清空后重置分页状态，避免残留 hasMore 触发无意义的触底请求
              this.setData({
                notifyList: [],
                unreadTotal: 0,
                page: 1,
                hasMore: false,
                loadError: false
              })
              this.loadUnreadCount()
            } else {
              wx.showToast({ title: res2.message || '操作失败', icon: 'none' })
            }
          })
          .catch((err) => {
            console.error('[message] 清空通知失败:', err)
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
      }
    })
  },

  /**
   * 左滑：触摸开始
   */
  onSwipeTouchStart(e) {
    this._swipeStartX = e.touches[0].clientX
    this._swipeStartY = e.touches[0].clientY
    this._swipeMoved = false
  },

  /**
   * 左滑：触摸移动（仅记录是否发生水平滑动）
   */
  onSwipeTouchMove(e) {
    const dx = e.touches[0].clientX - this._swipeStartX
    const dy = e.touches[0].clientY - this._swipeStartY
    // 水平滑动距离大于垂直时标记为已滑动，阻止 tap 事件
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      this._swipeMoved = true
    }
  },

  /**
   * 左滑：触摸结束（根据滑动距离决定展开/收起）
   */
  onSwipeTouchEnd(e) {
    if (!this._swipeMoved) return
    const dx = e.changedTouches[0].clientX - this._swipeStartX
    const { index } = e.currentTarget.dataset
    const list = this.data.notifyList
    // 先收起所有已展开项
    const updated = list.map((item, i) => {
      return Object.assign({}, item, { _swipeOpen: false })
    })
    // 向左滑超过阈值则展开当前项
    if (dx < -40 && index < updated.length) {
      updated[index]._swipeOpen = true
    }
    this.setData({ notifyList: updated })
  },

  /**
   * 删除单条通知
   */
  onDeleteNotify(e) {
    const { id, index } = e.currentTarget.dataset
    wx.showModal({
      title: '提示',
      content: '确定要删除这条通知吗？',
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (!res.confirm) return
        api.notify.delete(id)
          .then((res2) => {
            if (res2.code === 0) {
              wx.showToast({ title: '已删除', icon: 'success' })
              const list = this.data.notifyList.filter((_, i) => i !== index)
              this.setData({ notifyList: list })
              this.loadUnreadCount()
            } else {
              wx.showToast({ title: res2.message || '删除失败', icon: 'none' })
            }
          })
          .catch((err) => {
            console.error('[message] 删除通知失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          })
      }
    })
  }
})
