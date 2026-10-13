// pages/lostfound/publish/index.js
// 发布招领页 - 失物招领 / 寻物启事
// 填写物品名 / 分类 / 地点 / 事件时间 / 描述 / 图片，提交后调用 api.lostfound.create

const api = require('../../../api/index.js')
const { isLoggedIn, checkLogin, getUploadKey } = require('../../../utils/auth')
const { uploadImages } = require('../../../utils/upload')
const { checkLocation } = require('../../../utils/permission')
const eventBus = require('../../../store/eventBus')

// 分类选项（picker 使用）
const CATEGORY_OPTIONS = ['电子产品', '证件卡类', '钥匙', '衣物', '书籍', '钱包', '宠物', '其他']

Page({
  /**
   * 页面数据
   */
  data: {
    // 招领类型 lost / found
    kind: 'lost',
    // 类型展示文案（默认 lost→寻物启事）
    kindText: '寻物启事',
    // 物品名称
    itemName: '',
    // 分类
    category: '',
    // 分类索引
    categoryIndex: 0,
    // 分类选项
    categoryOptions: CATEGORY_OPTIONS,
    // 地点
    location: '',
    // 纬度（地图定位，0 表示未定位）
    latitude: 0,
    // 经度（地图定位，0 表示未定位）
    longitude: 0,
    // 事件时间（时间戳）
    eventTime: '',
    // 事件时间展示文案
    eventTimeText: '',
    // 描述
    description: '',
    // 本地图片临时路径数组
    images: [],
    // 是否提交中
    submitting: false
  },

  /**
   * 页面加载
   * 获取传入的 kind，默认 lost
   */
  onLoad(options) {
    const kind = options.kind || 'lost'
    this.setData({
      kind,
      // 语义对齐：lost=丢失物品→寻物启事，found=捡到物品→失物招领
      kindText: kind === 'found' ? '失物招领' : '寻物启事'
    })

    if (!isLoggedIn()) {
      checkLogin()
        .then((ok) => {
          if (!ok) {
            wx.redirectTo({ url: '/pages/user/login/index' })
          }
        })
    }
  },

  /**
   * 物品名称输入
   */
  onItemNameInput(e) {
    this.setData({ itemName: e.detail.value })
  },

  /**
   * 分类 picker 变化
   */
  onCategoryInput(e) {
    const index = Number(e.detail.value)
    this.setData({
      categoryIndex: index,
      category: CATEGORY_OPTIONS[index]
    })
  },

  /**
   * 地点输入（手动输入）
   * 手动编辑地点文本时保留坐标：用户可能只是在地图选点基础上补充细节，
   * 坐标仍代表大致位置，无需清除
   */
  onLocationInput(e) {
    this.setData({ location: e.detail.value })
  },

  /**
   * 地图定位选择
   * 调用微信 chooseLocation API，用户在地图上选点后自动填充地点名称和坐标
   * 先检查定位权限，未授权则引导用户前往设置页开启
   */
  onChooseLocation() {
    checkLocation().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需要定位权限才能使用地图选点', icon: 'none' })
        return
      }
      wx.chooseLocation({
        success: (res) => {
          // res.name: 位置名称，res.address: 详细地址
          // res.latitude / res.longitude: 经纬度
          const locationText = res.name || res.address || ''
          this.setData({
            location: locationText,
            latitude: res.latitude,
            longitude: res.longitude
          })
        },
        fail: (err) => {
          // 用户取消选择时不提示错误
          if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
            wx.showToast({ title: '获取位置失败，请重试', icon: 'none' })
          }
        }
      })
    })
  },

  /**
   * 事件时间 picker 变化
   */
  onEventTimeChange(e) {
    const value = e.detail.value
    // 补 T00:00:00 按本地时区解析，避免 new Date('YYYY-MM-DD') 按 UTC 零点偏移 8 小时
    const timestamp = new Date(value + 'T00:00:00').getTime()
    this.setData({
      eventTime: timestamp,
      eventTimeText: value
    })
  },

  /**
   * 描述输入
   */
  onDescInput(e) {
    this.setData({ description: e.detail.value })
  },

  /**
   * 图片上传组件变化回调
   */
  onImagesChange(e) {
    this.setData({ images: e.detail.images })
  },

  /**
   * 点击发布按钮
   */
  onSubmit() {
    if (this.data.submitting) return

    const { kind, itemName, category, location, latitude, longitude, eventTime, description, images } = this.data

    // 表单校验
    if (!itemName.trim()) {
      wx.showToast({ title: '请输入物品名称', icon: 'none' })
      return
    }
    if (!location.trim()) {
      wx.showToast({ title: '请输入地点', icon: 'none' })
      return
    }

    // 再次校验登录态
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }

    // ---- 幂等键（P1）：同一份内容复用同一 clientId，弱网重试时服务端据此去重；
    //      内容变化则重新生成，避免误伤「确实要再发一条相同内容」的场景 ----
    const signature = [kind, itemName.trim(), category || '', location.trim(), description.trim(), eventTime || 0, images.length].join('\u0001')
    if (!this._clientId || this._clientSignature !== signature) {
      this._clientId = 'lf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8)
      this._clientSignature = signature
    }
    const clientId = this._clientId

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...', mask: true })

    // 先上传图片（若有）
    const uploadTask = images.length
      ? uploadImages(images, getUploadKey(), {
          // 进度反馈（P1）：此前多图上传全程只有转圈，现实时显示整体百分比
          onProgress: (percent) => {
            wx.showLoading({ title: '上传图片 ' + percent + '%', mask: true })
          }
        })
      : Promise.resolve([])

    uploadTask
      .then((imageUrls) => {
        return api.lostfound.create({
          kind,
          itemName: itemName.trim(),
          category: category || CATEGORY_OPTIONS[this.data.categoryIndex],
          location: location.trim(),
          latitude,
          longitude,
          eventTime: eventTime || Date.now(),
          description: description.trim(),
          images: imageUrls,
          clientId
        })
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '发布成功', icon: 'success' })
        // 通知招领大厅刷新（P1：发布后返回大厅立即显示新记录，无需手动下拉）
        eventBus.emit('refreshLostfound')
        setTimeout(() => {
          wx.navigateBack()
        }, 800)
      })
      .catch((err) => {
        wx.hideLoading()
        console.error('[lostfound-publish] 发布失败:', err)
        const msg = (err && err.message) || '发布失败，请重试'
        wx.showToast({ title: msg, icon: 'none' })
      })
      .then(() => {
        this.setData({ submitting: false })
      })
  }
})
