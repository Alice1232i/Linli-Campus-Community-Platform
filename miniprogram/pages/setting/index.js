// pages/setting/index.js
// 设置页
// 包含拉黑管理（列表 + 解除拉黑）、关于、清除缓存等功能项

const api = require('../../api/index.js')
const userStore = require('../../store/user')
const { sanitizeImageUrl } = require('../../utils/format')

// 默认头像
const DEFAULT_AVATAR = '/images/icons/user.png'

Page({
  /**
   * 页面数据
   */
  data: {
    // 拉黑用户列表
    blockList: [],
    // 当前页码
    page: 1,
    // 是否还有更多
    hasMore: true,
    // 是否正在加载
    loading: false,
    // 下拉刷新状态（控制 scroll-view 的 refresher-triggered）
    refreshing: false
  },

  /**
   * 页面加载
   * 首次拉取拉黑列表
   */
  onLoad() {
    this.loadBlockList(true)
  },

  /**
   * 页面显示
   * 返回该页时刷新拉黑列表
   */
  onShow() {
    this.loadBlockList(true)
  },

  /**
   * 加载拉黑列表
   * @param {boolean} reset 是否重置到第一页
   */
  loadBlockList(reset = false) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page
    this.setData({
      loading: true,
      page,
      hasMore: reset ? true : this.data.hasMore
    })

    return api.block.list(page)
      .then((res) => {
        const data = (res && res.data) || {}
        const list = data.list || data.blockList || []
        // 净化拉黑用户头像：防止 wxfile:// 临时路径导致加载失败
        list.forEach(item => {
          if (item.targetAvatar) {
            item.targetAvatar = sanitizeImageUrl(item.targetAvatar, DEFAULT_AVATAR)
          }
          if (item.avatar) {
            item.avatar = sanitizeImageUrl(item.avatar, DEFAULT_AVATAR)
          }
        })
        const merged = reset ? list : this.data.blockList.concat(list)
        this.setData({
          blockList: merged,
          hasMore: merged.length < (data.total || merged.length)
        })
      })
      .catch((err) => {
        console.error('[setting] 加载拉黑列表失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 解除拉黑
   */
  onUnblock(e) {
    const { userid, index } = e.currentTarget.dataset
    wx.showModal({
      title: '解除拉黑',
      content: '确定要解除对该用户的拉黑吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        api.block.unblock(userid)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已解除拉黑', icon: 'success' })
            // 从列表移除
            const blockList = this.data.blockList.filter((_, i) => i !== index)
            this.setData({ blockList })
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('[setting] 解除拉黑失败:', err)
            wx.showToast({ title: '操作失败', icon: 'none' })
          })
      }
    })
  },

  /**
   * 联系客服
   * 预留企业微信客服接口，后续填入企业ID即可启用
   * 当前通过微信小程序客服消息作为备选方案
   */
  contactCustomerService() {
    // ===== 企业微信客服接口（预留）=====
    // 使用前需在微信公众平台配置企业微信客服，并填入正确的 corpId
    // 文档：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/service-chat/wx.openCustomerServiceChat.html
    const WORK_WX_CORP_ID = '' // TODO: 填入企业微信 corpId 后启用企业微信客服

    if (WORK_WX_CORP_ID) {
      // 已配置企业微信：打开企业微信客服会话
      wx.openCustomerServiceChat({
        extInfo: { url: '' },
        corpId: WORK_WX_CORP_ID,
        fail: (err) => {
          console.error('[setting] 打开企业微信客服失败:', err)
          wx.showToast({ title: '打开客服失败，请稍后重试', icon: 'none' })
        }
      })
    } else {
      // 未配置企业微信：协议与关于页均把这里作为联系方式之一，故不能只弹一句「即将上线」
      // （否则用户在文档里被引导到死路）。先给出当前可用的反馈路径。
      wx.showModal({
        title: '联系客服',
        content: '客服会话正在接入中。你可以先在社区内容右上角的「举报」入口说明问题并留下联系方式，我们会在后台处理。',
        showCancel: false,
        confirmText: '知道了'
      })
    }
  },

  /**
   * 跳转协议文档页（用户协议 / 隐私政策）
   * @param {object} e 事件对象，dataset.type: agreement | privacy
   */
  goDoc(e) {
    const type = e.currentTarget.dataset.type === 'agreement' ? 'agreement' : 'privacy'
    wx.navigateTo({ url: '/pages/agreement/index?type=' + type })
  },

  /**
   * 跳转「关于我们」
   * 由原弹窗改为独立页面：需要承载公益定位说明、能力清单与版本信息
   */
  goAbout() {
    wx.navigateTo({ url: '/pages/agreement/index?type=about' })
  },

  /**
   * 清除缓存
   * 清空本地存储后重启到首页
   */
  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地缓存数据并重启小程序，确定继续吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '清理中...' })
        try {
          wx.clearStorageSync()
        } catch (e) {
          console.warn('[setting] 清除缓存异常:', e)
        }
        // 清理内存登录态与 app.globalData，避免清除缓存后仍显示已登录
        userStore.clear()
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.isLoggedIn = false
          app.globalData.userInfo = null
        }
        wx.hideLoading()
        // 重新启动到首页
        wx.reLaunch({ url: '/pages/feed/index' })
      }
    })
  },

  /**
   * 上拉加载更多
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadBlockList(false)
  },

  /**
   * 下拉刷新（scroll-view refresher 回调）
   * P1：此前依赖 onPullDownRefresh，但页面用全屏 scroll-view 承接滚动，
   * 原生下拉不会触发，属死代码；现改走 scroll-view 的 refresher-enabled。
   */
  onRefresh() {
    this.setData({ refreshing: true })
    Promise.resolve(this.loadBlockList(true))
      .then(() => { this.setData({ refreshing: false }) })
      .catch(() => { this.setData({ refreshing: false }) })
  }
})
