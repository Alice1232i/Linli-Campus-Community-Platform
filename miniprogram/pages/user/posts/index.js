// pages/user/posts/index.js
// 用户帖子页 - 展示指定用户（或当前用户）发布的帖子列表
// 支持分页加载、点击跳转帖子详情、删除帖子（仅本人帖子可删）
// 查看他人时顶部展示作者信息卡片，标题为"作者的空间"

const api = require('../../../api/index.js')
const { formatListTime } = require('../../../utils/format')
const eventBus = require('../../../store/eventBus.js')
const userStore = require('../../../store/user')

/**
 * 摘要截断（对齐 post-card 的 JS 截断兜底方案）
 * Skyline 不支持 -webkit-line-clamp，长文会撑破列表项高度
 * @param {string} content 原始正文
 * @param {number} max 最大字符数
 * @returns {string} 截断后的摘要
 */
function truncateSummary(content, max) {
  if (!content) return ''
  const text = String(content).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

// 内容类型筛选 Tab：key 与云函数 post.myPosts 的 module 白名单对应（all = 不筛选）
// 说明：失物招领与社区帖都存在 posts 集合，不筛选时两类内容会混排
// 跑腿模块已整体下架（2026-10-11），不再提供筛选入口
const MODULE_TABS = [
  { key: 'all', name: '全部' },
  { key: 'community', name: '社区' },
  { key: 'lostfound', name: '失物招领' }
]

// 各类型的空状态文案
const EMPTY_TEXT = {
  all: { text: '还没有发布过帖子', sub: '去发布第一条帖子吧' },
  community: { text: '还没有社区帖子', sub: '去板块里发一条吧' },
  lostfound: { text: '还没有失物招领', sub: '捡到或丢了东西都可以发布' }
}

// 帖子类型标签：社区帖为列表默认内容，不加标签，避免每条都挂一个「社区」
const MODULE_LABEL = {
  lostfound: '失物招领'
}

Page({
  /**
   * 页面数据
   */
  data: {
    // 帖子列表
    postList: [],
    // 加载中
    loading: true,
    // 分页参数
    page: 1,
    pageSize: 20,
    hasMore: false,
    total: 0,
    // 目标用户 ID（为空时查当前用户帖子）
    userId: '',
    // 是否为查看他人帖子（控制删除按钮显隐、作者卡片展示）
    isOther: false,
    // 导航栏标题（查看自己"我的帖子"，查看他人"作者的空间"）
    navTitle: '我的帖子',
    // 作者信息（查看他人时加载，含昵称/头像/简介/统计等脱敏字段）
    authorInfo: null,
    // 作者信息加载中标记
    authorLoading: false,
    // 内容类型筛选（仅查看自己的帖子时展示 Tab）
    moduleTabs: MODULE_TABS,
    activeModule: 'all',
    // 空状态文案（随所选类型变化）
    emptyText: EMPTY_TEXT.all.text,
    emptySub: EMPTY_TEXT.all.sub
  },

  /**
   * 页面加载
   * 接收可选的 userId 参数，有则查他人帖子，无则查当前用户帖子
   * 封禁用户拦截：防止通过 URL 直接进入（第二道防线）
   */
  onLoad(options) {
    const userId = options.userId || ''
    this.setData({
      userId,
      isOther: !!userId,
      // 查看他人时标题为"作者的空间"，查看自己时为"我的帖子"
      navTitle: userId ? '作者的空间' : '我的帖子'
    })

    // ---- 封禁用户拦截：查看自己的帖子时拦截，查看他人帖子不拦截 ----
    if (!userId && userStore.isBanned()) {
      this.setData({ loading: false })
      wx.showToast({ title: '账号已被封禁，无法查看内容', icon: 'none' })
      setTimeout(() => { wx.navigateBack() }, 1500)
      return
    }

    // 查看他人时先加载作者信息（脱敏），再加载帖子列表
    if (userId) {
      this.loadAuthor(userId)
    }
    this.loadPosts()
  },

  /**
   * 监听用户资料更新，刷新列表以展示最新作者信息
   */
  onShow() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
    }
    this._offProfileUpdate = eventBus.on('profileUpdated', () => {
      this.loadPosts()
    })
  },

  onUnload() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
      this._offProfileUpdate = null
    }
  },

  /**
   * 加载作者信息（查看他人帖子时调用）
   * 调用 user 云函数 getUser action，返回脱敏公开信息
   * 使用 silent 模式：不显示全局 loading，避免与 loadPosts 的 loading 冲突
   * @param {string} userId 目标用户 ID（_id 或 openid）
   */
  async loadAuthor(userId) {
    this.setData({ authorLoading: true })
    try {
      const res = await api.user.getUser(userId, { silent: true, loading: false })
      if (res.code === 0) {
        // 院系信息展示文案：学院 · 专业 · X 届
        const info = res.data || {}
        const parts = []
        if (info.college) parts.push(info.college)
        if (info.major) parts.push(info.major)
        if (info.grade) parts.push(info.grade + ' 届')
        this.setData({
          authorInfo: info,
          academyText: parts.join(' · ')
        })
      } else {
        console.warn('[userPosts] 加载作者信息失败:', res.message)
      }
    } catch (e) {
      console.error('[userPosts] 加载作者信息异常:', e)
    } finally {
      this.setData({ authorLoading: false })
    }
  },

  /**
   * 加载帖子列表
   * 有 userId 时调 userPosts，否则调 myPosts
   */
  async loadPosts() {
    const { page, userId, activeModule } = this.data
    this.setData({ loading: true })
    try {
      // 我的帖子支持按内容类型筛选；查看他人时保持全量（不做筛选）
      const moduleKey = userId || activeModule === 'all' ? '' : activeModule
      const res = userId
        ? await api.post.userPosts(userId, page)
        : await api.post.myPosts(page, moduleKey)
      if (res.code === 0) {
        const data = res.data || {}
        const list = (data.list || []).map((item) => {
          return Object.assign({}, item, {
            _timeText: formatListTime(item.createdAt || item.sortTime),
            // 摘要 JS 截断：Skyline 下 line-clamp 兜底
            _contentText: truncateSummary(item.content, 60),
            // 类型标签（社区帖为空串，不渲染）
            _typeText: MODULE_LABEL[item.module] || ''
          })
        })
        this.setData({
          postList: page === 1 ? list : this.data.postList.concat(list),
          total: data.total || 0,
          hasMore: data.hasMore || false
        })
      } else {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('[userPosts] 加载失败:', e)
      wx.showToast({ title: '网络错误', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 切换内容类型筛选（全部 / 社区 / 失物招领）
   * 重置列表并回到第一页：total / hasMore 一并复位，避免残留上一类型的分页状态
   * @param {object} e feed-tabs 事件，e.detail.key 为类型 key
   */
  onTapModule(e) {
    const { key } = e.detail
    if (!key || key === this.data.activeModule) return
    const empty = EMPTY_TEXT[key] || EMPTY_TEXT.all
    this.setData({
      activeModule: key,
      postList: [],
      page: 1,
      total: 0,
      hasMore: false,
      emptyText: empty.text,
      emptySub: empty.sub
    })
    this.loadPosts()
  },

  /**
   * 上拉加载更多
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadPosts()
  },

  /**
   * 点击帖子项，跳转详情
   * 通过路由分发工具按 refType 跳转到对应业务详情页
   */
  onTapPost(e) {
    const { id } = e.currentTarget.dataset
    // 从列表中查找帖子对象获取 refType / refId
    const post = this.data.postList.find(p => p._id === id)
    const route = require('../../../utils/route.js')
    route.navigateToDetail(post || { _id: id })
  },

  /**
   * 长按帖子项，弹出操作菜单（仅本人帖子可操作）
   */
  onLongPressPost(e) {
    // 查看他人帖子时不显示删除选项
    if (this.data.isOther) return
    const { id } = e.currentTarget.dataset
    const post = this.data.postList.find(p => p._id === id)
    // 失物招领有自己的业务详情与编辑流程，本处菜单的「编辑帖子」会把它带进社区发帖页，
    // 故对非社区内容只提示到对应详情页操作（类型筛选 Tab 上线后该误操作更易触发）
    if (post && post.module && post.module !== 'community') {
      wx.showToast({ title: '请到失物招领详情页操作', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ['编辑帖子', '删除帖子'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.editPost(id)
        } else if (res.tapIndex === 1) {
          this.confirmDelete(id)
        }
      }
    })
  },

  /**
   * 编辑帖子：跳转发布页进入编辑模式
   * @param {string} postId 帖子 ID
   */
  editPost(postId) {
    wx.navigateTo({ url: `/pages/post/publish/index?postId=${postId}` })
  },

  /**
   * 确认删除帖子
   */
  confirmDelete(postId) {
    wx.showModal({
      title: '提示',
      content: '确定要删除这篇帖子吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const result = await api.post.delete(postId)
          if (result.code === 0) {
            wx.showToast({ title: '已删除', icon: 'success' })
            // 从列表中移除
            const postList = this.data.postList.filter((p) => p._id !== postId)
            this.setData({
              postList,
              total: this.data.total - 1
            })
          } else {
            wx.showToast({ title: result.message || '删除失败', icon: 'none' })
          }
        } catch (e) {
          console.error('[myPosts] 删除失败:', e)
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  }
})
