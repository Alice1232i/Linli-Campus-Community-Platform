// pages/setting/feedback/index.js
// 意见箱 - 收集测试版本意见与问题
// 提交后写入 feedbacks 集合，管理后台「意见箱」阅览处理；
// 处理结果（status/reply）在本页「我的反馈」中回显

const api = require('../../../api/index.js')
const { formatListTime } = require('../../../utils/format')

// 反馈类型（与云函数白名单一致）
const TYPES = [
  { key: 'suggestion', name: '功能建议' },
  { key: 'bug', name: '问题反馈' },
  { key: 'other', name: '其他' }
]

// 类型中文映射（列表标签用）
const TYPE_LABEL = {
  suggestion: '功能建议',
  bug: '问题反馈',
  other: '其他'
}

// 内容长度限制（与云函数 schema 一致）
const CONTENT_MIN = 5
const CONTENT_MAX = 500

Page({
  data: {
    // 反馈类型选项
    types: TYPES,
    // 表单
    form: {
      type: 'suggestion',
      content: '',
      contact: ''
    },
    // 提交中
    submitting: false,
    // 我的反馈列表
    list: [],
    page: 1,
    hasMore: false,
    loading: false
  },

  onLoad() {
    this.loadMine(true)
  },

  /**
   * 选择反馈类型
   */
  onTypeTap(e) {
    const { key } = e.currentTarget.dataset
    if (key && key !== this.data.form.type) {
      this.setData({ 'form.type': key })
    }
  },

  /**
   * 输入反馈内容
   */
  onContentInput(e) {
    this.setData({ 'form.content': e.detail.value })
  },

  /**
   * 输入联系方式
   */
  onContactInput(e) {
    this.setData({ 'form.contact': e.detail.value })
  },

  /**
   * 提交反馈
   * 校验：内容 5-500 字；联系方式选填
   */
  onSubmit() {
    if (this.data.submitting) return

    const { type, content, contact } = this.data.form
    const text = (content || '').trim()
    if (text.length < CONTENT_MIN) {
      wx.showToast({ title: `再多写几个字吧（至少 ${CONTENT_MIN} 字）`, icon: 'none' })
      return
    }
    if (text.length > CONTENT_MAX) {
      wx.showToast({ title: `内容不能超过 ${CONTENT_MAX} 字`, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    api.feedback.submit({
      type,
      content: text,
      contact: (contact || '').trim(),
      // 尽力获取小程序版本号（体验版/正式版有值，开发工具为空），便于后台定位测试版本
      appVersion: this.getAppVersion()
    })
      .then((res) => {
        if (res.code === 0) {
          wx.showToast({ title: '已提交，感谢反馈', icon: 'success' })
          // 清空表单并回到列表顶部
          this.setData({
            form: { type: 'suggestion', content: '', contact: this.data.form.contact }
          })
          this.loadMine(true)
        } else {
          wx.showToast({ title: res.message || '提交失败，请稍后重试', icon: 'none' })
        }
      })
      .catch(() => {
        wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' })
      })
      .then(() => {
        this.setData({ submitting: false })
      })
  },

  /**
   * 加载我的反馈列表
   * @param {boolean} reset 是否重置到第一页
   */
  loadMine(reset = false) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page
    this.setData({ loading: true })
    api.feedback.listMine(page)
      .then((res) => {
        if (res.code === 0) {
          const data = res.data || {}
          const list = (data.list || []).map((item) => ({
            ...item,
            _typeText: TYPE_LABEL[item.type] || '其他',
            _timeText: formatListTime(item.createdAt)
          }))
          this.setData({
            list: reset ? list : this.data.list.concat(list),
            total: data.total || 0,
            hasMore: data.hasMore || false,
            page
          })
        }
      })
      .catch((e) => {
        console.error('[feedback] 加载我的反馈失败:', e)
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 上拉加载更多
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadMine(false)
  },

  /**
   * 获取小程序版本号（尽力而为，取不到返回空串）
   * @returns {string}
   */
  getAppVersion() {
    try {
      if (typeof wx.getAccountInfoSync === 'function') {
        const info = wx.getAccountInfoSync()
        return (info && info.miniProgram && info.miniProgram.version) || ''
      }
    } catch (e) {
      // 低版本基础库无此接口，忽略
    }
    return ''
  }
})
