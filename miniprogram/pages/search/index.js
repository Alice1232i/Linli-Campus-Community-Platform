// pages/search/index.js
// 全局搜索页 - 支持搜索帖子 / 话题 / 同学
// 通过 Tab 切换搜索类型，共享搜索关键词和历史记录

const api = require('../../api/index.js')
const { formatListTime } = require('../../utils/format')
const userStore = require('../../store/user')

/** 搜索历史本地存储 key */
const HISTORY_KEY = 'search_history'
/** 搜索历史最大保存条数 */
const MAX_HISTORY = 10

/** 搜索类型配置 */
const TABS = [
  { key: 'post', name: '帖子' },
  { key: 'tag', name: '话题' },
  { key: 'user', name: '同学' }
]

/**
 * 摘要截断（对齐 post-card 的 JS 截断兜底方案）
 * Skyline 不支持 -webkit-line-clamp，长文会撑破两行摘要区
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

Page({
  /**
   * 页面数据
   */
  data: {
    // 搜索类型 Tab 配置
    tabs: TABS,
    // 当前激活的 Tab（post / tag / user）
    activeTab: 'post',
    // 搜索关键词
    keyword: '',
    // 搜索结果列表（帖子/话题/同学共用）
    resultList: [],
    // 是否正在搜索
    searching: false,
    // 是否已执行过搜索（控制空状态展示）
    hasSearched: false,
    // 分页参数
    page: 1,
    pageSize: 20,
    hasMore: false,
    total: 0,
    // 搜索历史
    historyList: []
  },

  /**
   * 页面加载
   * 从本地缓存读取搜索历史
   */
  onLoad() {
    this.loadHistory()
  },

  /**
   * 从本地缓存加载搜索历史
   */
  loadHistory() {
    try {
      const history = wx.getStorageSync(HISTORY_KEY) || []
      this.setData({ historyList: history })
    } catch (e) {
      console.error('[search] 读取搜索历史失败:', e)
    }
  },

  /**
   * 保存搜索关键词到历史记录
   * @param {string} keyword 关键词
   */
  saveHistory(keyword) {
    try {
      let history = wx.getStorageSync(HISTORY_KEY) || []
      // 去重：移除已存在的相同关键词
      history = history.filter((item) => item !== keyword)
      // 新关键词添加到头部
      history.unshift(keyword)
      // 限制最大数量
      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY)
      }
      wx.setStorageSync(HISTORY_KEY, history)
      this.setData({ historyList: history })
    } catch (e) {
      console.error('[search] 保存搜索历史失败:', e)
    }
  },

  /**
   * 输入框内容变化
   */
  onInput(e) {
    this.setData({ keyword: e.detail.value || '' })
  },

  /**
   * 点击搜索按钮或键盘确认
   */
  onSearch() {
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入搜索内容', icon: 'none' })
      return
    }
    // 保存到搜索历史
    this.saveHistory(keyword)
    // 重置分页并执行搜索
    this.setData({
      resultList: [],
      page: 1,
      hasSearched: true
    })
    this.doSearch()
  },

  /**
   * 切换搜索类型 Tab
   * 切换后若已有搜索关键词则重新搜索
   */
  onSwitchTab(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.activeTab) return
    this.setData({
      activeTab: key,
      resultList: [],
      page: 1,
      total: 0,
      hasMore: false
    })
    // 如果已有搜索关键词，切换 Tab 后立即搜索
    if (this.data.hasSearched && this.data.keyword.trim()) {
      this.doSearch()
    }
  },

  /**
   * 清空输入框
   */
  onClearInput() {
    this.setData({
      keyword: '',
      resultList: [],
      hasSearched: false,
      total: 0
    })
  },

  /**
   * 点击历史记录项搜索
   */
  onTapHistory(e) {
    const { keyword } = e.currentTarget.dataset
    this.setData({ keyword })
    this.onSearch()
  },

  /**
   * 清空搜索历史
   */
  onClearHistory() {
    wx.showModal({
      title: '提示',
      content: '确定清空搜索历史吗？',
      confirmText: '清空',
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (!res.confirm) return
        wx.removeStorageSync(HISTORY_KEY)
        this.setData({ historyList: [] })
        wx.showToast({ title: '已清空', icon: 'none' })
      }
    })
  },

  /**
   * 执行搜索请求
   * 根据 activeTab 调用不同的 API
   * - post: 按标题/正文搜索帖子
   * - tag: 按标签搜索帖子（话题）
   * - user: 按昵称搜索同学
   */
  async doSearch() {
    const { keyword, page, activeTab } = this.data
    if (!keyword) return

    // 封禁用户不可搜索
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法搜索', icon: 'none' })
      return
    }

    // 请求序列号：防止快速切换 Tab 或连续搜索时旧请求覆盖新结果
    this._searchSeq = (this._searchSeq || 0) + 1
    const seq = this._searchSeq

    this.setData({ searching: true })
    try {
      let res = null
      // 根据 Tab 类型调用不同 API
      if (activeTab === 'post') {
        res = await api.post.search(keyword, page)
      } else if (activeTab === 'tag') {
        res = await api.post.searchByTag(keyword, page)
      } else if (activeTab === 'user') {
        res = await api.user.searchUser(keyword, page)
      }

      // 竞态防护：如果期间发起了新请求，丢弃本次结果
      if (seq !== this._searchSeq) return

      // 拦截器约定 code 为 0 或 200 均算成功
      if (res && (res.code === 0 || res.code === 200)) {
        const data = res.data || {}
        const list = (data.list || []).map((item) => {
          // 帖子结果需要格式化时间；同学结果不需要
          if (activeTab === 'post' || activeTab === 'tag') {
            return Object.assign({}, item, {
              _timeText: formatListTime(item.createdAt || item.sortTime),
              // 摘要 JS 截断：Skyline 下 line-clamp 兜底
              _contentText: truncateSummary(item.content, 60)
            })
          }
          return item
        })
        this.setData({
          resultList: page === 1 ? list : this.data.resultList.concat(list),
          total: data.total || 0,
          hasMore: data.hasMore || false
        })
      } else {
        wx.showToast({ title: (res && res.message) || '搜索失败', icon: 'none' })
      }
    } catch (e) {
      if (seq !== this._searchSeq) return
      console.error('[search] 搜索失败:', e)
      wx.showToast({ title: '网络错误', icon: 'none' })
    } finally {
      if (seq === this._searchSeq) {
        this.setData({ searching: false })
      }
    }
  },

  /**
   * 上拉加载更多
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.searching) return
    this.setData({ page: this.data.page + 1 })
    this.doSearch()
  },

  /**
   * 点击帖子搜索结果，跳转帖子详情
   */
  onTapPost(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.resultList.find(r => r._id === id)
    const route = require('../../utils/route.js')
    route.navigateToDetail(item || { _id: id })
  },

  /**
   * 点击同学搜索结果，跳转该用户的空间页
   */
  onTapUser(e) {
    const { id, openid } = e.currentTarget.dataset
    // 优先使用 _id，兼容 openid
    const userId = id || openid
    if (userId) {
      wx.navigateTo({ url: `/pages/user/posts/index?userId=${userId}` })
    }
  }
})
