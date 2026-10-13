// pages/user/verify/index.js
// 学生认证页
// 展示认证状态：已认证显示徽章，未认证引导通过校园邮箱完成认证
// 流程：输入校园邮箱 -> 发送验证码 -> 输入验证码 -> 提交认证

const api = require('../../../api/index.js')
const userStore = require('../../../store/user')
const eventBus = require('../../../store/eventBus')

Page({
  data: {
    loading: true,        // 认证状态加载中
    verifyEnabled: false,  // 认证功能是否开启（默认关闭）
    status: '',           // 认证状态：approved 已认证 / 其它视为未认证
    verifiedEmail: '',    // 已认证邮箱
    email: '',            // 输入的校园邮箱
    code: '',             // 输入的验证码
    codeSent: false,      // 是否已发送验证码（控制验证码输入区显示）
    sending: false,       // 发送验证码中
    submitting: false,    // 提交认证中
    countdown: 0          // 发送验证码倒计时（秒）
  },

  onLoad() {
    this.loadVerifyConfig()
  },

  onUnload() {
    // 页面卸载时清理倒计时定时器，避免内存泄漏
    this.clearTimer()
  },

  /**
   * 加载认证功能开关
   * 关闭时显示暂停提示，开启时加载认证状态
   */
  loadVerifyConfig() {
    api.common.getConfig('verifyEnabled')
      .then(res => {
        const config = (res && res.data && res.data.config) || {}
        const enabled = config.verifyEnabled === true
        this.setData({ verifyEnabled: enabled })
        if (enabled) {
          this.loadStatus()
        } else {
          this.setData({ loading: false })
        }
      })
      .catch(err => {
        console.error('获取认证开关失败', err)
        this.setData({ loading: false })
      })
  },

  /**
   * 获取当前认证状态
   */
  loadStatus() {
    this.setData({ loading: true })
    api.verify.getStatus()
      .then(res => {
        const data = (res && res.data) || {}
        this.setData({
          status: data.status || '',
          verifiedEmail: data.email || ''
        })
      })
      .catch(err => {
        console.error('获取认证状态失败', err)
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 校园邮箱输入
   */
  onEmailInput(e) {
    this.setData({ email: e.detail.value })
  },

  /**
   * 验证码输入
   */
  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  /**
   * 校验校园邮箱格式（要求 .edu.cn 结尾）
   * @param {string} email
   * @returns {boolean}
   */
  isValidEduEmail(email) {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.edu\.cn$/.test(email)
  },

  /**
   * 发送验证码
   * 调用 api.verify.sendCode(email)，成功后开始 60 秒倒计时
   */
  onSendCode() {
    // 发送中或倒计时未结束时不允许重复发送
    if (this.data.sending || this.data.countdown > 0) return
    const email = (this.data.email || '').trim()
    if (!this.isValidEduEmail(email)) {
      wx.showToast({ title: '请输入正确的校园邮箱', icon: 'none' })
      return
    }

    this.setData({ sending: true })
    api.verify.sendCode(email)
      .then(() => {
        wx.showToast({ title: '验证码已发送', icon: 'success' })
        this.setData({ codeSent: true })
        this.startCountdown()
      })
      .catch(err => {
        console.error('发送验证码失败', err)
        wx.showToast({ title: '发送失败，请重试', icon: 'none' })
      })
      .then(() => {
        this.setData({ sending: false })
      })
  },

  /**
   * 开始 60 秒倒计时
   */
  startCountdown() {
    this.clearTimer()
    this.setData({ countdown: 60 })
    this.timer = setInterval(() => {
      if (this.data.countdown <= 1) {
        this.clearTimer()
        this.setData({ countdown: 0 })
      } else {
        this.setData({ countdown: this.data.countdown - 1 })
      }
    }, 1000)
  },

  /**
   * 清除倒计时定时器
   */
  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /**
   * 提交认证
   * 调用 api.verify.submit(email, code)，成功后切换为已认证视图
   */
  onSubmit() {
    if (this.data.submitting) return
    const email = (this.data.email || '').trim()
    const code = (this.data.code || '').trim()
    if (!this.isValidEduEmail(email)) {
      wx.showToast({ title: '请输入正确的校园邮箱', icon: 'none' })
      return
    }
    if (code.length !== 6) {
      wx.showToast({ title: '请输入6位验证码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    // 请求订阅消息授权（审核结果通知）：用户允许后认证结果可推送微信通知；拒绝不影响认证流程
    wx.requestSubscribeMessage({
      tmplIds: ['jnLR5PoHvETJxCq7wNKAmKO8y6KHBaJQHjAtuoPsE-o'],
      fail: function() {
        // 用户拒绝或系统不支持时静默跳过
      }
    })

    api.verify.submit(email, code)
      .then(res => {
        const data = (res && res.data) || {}
        wx.showToast({ title: '认证成功', icon: 'success' })
        // 认证成功，更新页面为已认证状态
        this.setData({
          status: data.status || 'approved',
          verifiedEmail: data.email || email
        })
        // 同步 userStore 并广播事件，让「我的」页认证徽章立即生效
        userStore.syncFromServer().catch(() => {})
        eventBus.emit('profileUpdated')
        this.clearTimer()
      })
      .catch(err => {
        console.error('提交认证失败', err)
        wx.showToast({ title: '认证失败，请重试', icon: 'none' })
      })
      .then(() => {
        this.setData({ submitting: false })
      })
  }
})
