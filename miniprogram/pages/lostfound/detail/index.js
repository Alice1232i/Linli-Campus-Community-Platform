// pages/lostfound/detail/index.js
// 招领详情页 - 展示物品信息 + 图片预览 + 关闭招领
// 仅发布人本人可关闭招领

const api = require('../../../api/index.js')
const { formatTime, formatDate, sanitizeImageUrl } = require('../../../utils/format')
const { isLoggedIn } = require('../../../utils/auth')
const storage = require('../../../utils/storage')
const userStore = require('../../../store/user')

// 默认头像
const DEFAULT_AVATAR = '/images/icons/user.png'

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
    // 招领记录 ID
    id: '',
    // 详情对象
    detail: null,
    // 是否正在加载
    loading: true,
    // 是否加载失败（P0-4：失败时展示错误占位 + 重试，避免永久空白页）
    loadError: false,
    // 加载失败提示文案
    loadErrorText: '',
    // 是否为发布人本人
    isOwner: false,
  },

  /**
   * 页面加载
   * 获取 id 并加载详情
   * 封禁用户拦截：防止通过消息页、分享链接等 URL 直接进入
   */
  onLoad(options) {
    const id = options.id || ''
    this.setData({ id })

    // ---- 封禁用户拦截：第二道防线，防止通过 URL 直接进入 ----
    if (userStore.isBanned()) {
      this.setData({ loading: false })
      wx.showToast({ title: '账号已被封禁，无法查看内容', icon: 'none' })
      setTimeout(() => { wx.navigateBack() }, 1500)
      return
    }

    if (id) {
      this.loadDetail()
    } else {
      this.setData({ loading: false })
      wx.showToast({ title: '记录不存在', icon: 'none' })
    }
  },

  /**
   * 加载详情
   */
  loadDetail() {
    this.setData({ loading: true })
    api.lostfound.detail(this.data.id)
      .then((res) => {
        const detail = (res && res.data) || null
        if (!detail) {
          this.setData({ loading: false })
          wx.showToast({ title: '记录不存在', icon: 'none' })
          return
        }
        const kindInfo = KIND_MAP[detail.kind] || { name: '招领', color: '#4A90D9' }
        // 净化发布者头像：防止 wxfile:// 临时路径导致加载失败
        if (detail.publisher && detail.publisher.avatar) {
          detail.publisher.avatar = sanitizeImageUrl(detail.publisher.avatar, DEFAULT_AVATAR)
        }
        if (detail.publisher && detail.publisher.avatarUrl) {
          detail.publisher.avatarUrl = sanitizeImageUrl(detail.publisher.avatarUrl, DEFAULT_AVATAR)
        }
        const decorated = Object.assign({}, detail, {
          _kindName: kindInfo.name,
          _kindColor: kindInfo.color,
          _eventTimeText: detail.eventTime ? formatDate(detail.eventTime) : '',
          _createdAtText: detail.createdAt ? formatTime(detail.createdAt) : '',
          // 地图标记点（有经纬度时构造，用于 map 组件 markers 属性）
          _markers: (detail.latitude && detail.longitude) ? [{
            id: 1,
            latitude: detail.latitude,
            longitude: detail.longitude,
            width: 30,
            height: 30
          }] : []
        })
        // 是否发布人由服务端返回权威字段（openid 不再下发）
        const isOwner = !!detail.isOwner
        this.setData({ detail: decorated, isOwner, loading: false, loadError: false })
      })
      .catch((err) => {
        console.error('[lostfound-detail] 加载详情失败:', err)
        // P0-4：进入错误态并提供「重新加载」，避免永久空白页
        this.setData({
          loading: false,
          loadError: true,
          loadErrorText: (err && err.message) || '加载失败，请检查网络后重试'
        })
      })
  },

  /**
   * 重新加载详情（P0-4 错误态重试入口）
   */
  onRetry() {
    this.setData({ loadError: false, loadErrorText: '' })
    this.loadDetail()
  },

  /**
   * 点击图片预览
   */
  onTapImage(e) {
    const { src } = e.currentTarget.dataset
    const urls = (this.data.detail && this.data.detail.images) || []
    wx.previewImage({
      current: src,
      urls
    })
  },

  /**
   * 打开微信内置地图查看完整位置
   * 使用 wx.openLocation 展示大地图，支持导航功能
   */
  onOpenLocation() {
    const detail = this.data.detail
    if (!detail || !detail.latitude || !detail.longitude) return
    wx.openLocation({
      latitude: detail.latitude,
      longitude: detail.longitude,
      name: detail.location || '招领地点',
      address: detail.location || '',
      scale: 18
    })
  },

  /**
   * 关闭招领（仅发布人）
   */
  onClose() {
    wx.showModal({
      title: '提示',
      content: '关闭后该招领将不再展示，确定关闭吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        api.lostfound.close(this.data.id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已关闭', icon: 'success' })
            // 延迟返回
            setTimeout(() => {
              wx.navigateBack()
            }, 800)
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('[lostfound-detail] 关闭招领失败:', err)
            const msg = (err && err.message) || '操作失败'
            wx.showToast({ title: msg, icon: 'none' })
          })
      }
    })
  }
})
