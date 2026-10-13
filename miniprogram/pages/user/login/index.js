// pages/user/login/index.js
// 登录引导页
// ------------------------------------------------------------
// 页面定位（改造后）：不再是「点一下等于没点」的装饰页，而是承担三件事：
//   1. 合规：显式勾选同意协议 + 微信隐私协议授权（wx.requirePrivacyAuthorize）
//   2. 建立会话：调用云函数 login，拿到随机会话凭证（不含 openid，见 utils/auth.js）
//   3. 完善资料：首次登录时用微信头像昵称能力补全昵称/头像，可跳过
//
// 说明：小程序的用户身份由微信在云函数调用链路上自动注入（getWXContext().OPENID），
// 因此「登录」在技术上是静默的；本页的价值在于合规同意与资料完善，而不是身份获取。

const auth = require('../../../utils/auth')
const api = require('../../../api/index.js')
const userStore = require('../../../store/user')
const eventBus = require('../../../store/eventBus.js')
const { uploadImages } = require('../../../utils/upload')
const { sanitizeImageUrl } = require('../../../utils/format')

// 默认头像（未设置头像时的占位）
const DEFAULT_AVATAR = '/images/icons/user_profile.png'
// 服务端自动生成的默认昵称形如「校园用户12345」，命中则认为资料未完善
const DEFAULT_NICKNAME_RE = /^校园用户\d{4,}$/

Page({
  data: {
    step: 'intro',        // intro=登录引导 / profile=完善资料
    loading: false,       // 登录中
    agreed: false,        // 是否已勾选同意协议（默认不勾选，需用户主动同意）
    // 价值点文案：说明登录后能做什么，避免页面只有 Logo + 按钮导致大片留白
    features: [
      '微信身份一键登录，昵称头像随时可改',
      '发帖、评论、私信，和同学即时互动'
    ],
    nickname: '',         // 待完善的昵称
    avatar: '',           // 待完善的头像
    avatarChanged: false, // 用户是否主动选择过头像
    saving: false,        // 资料保存中
    defaultAvatar: DEFAULT_AVATAR
  },

  onLoad(options) {
    // 记录来源页路由：登录成功后回原页面而非一律跳首页（P1 上下文保留）
    this._redirect = (options && options.redirect) ? decodeURIComponent(options.redirect) : ''
    // 已是登录态且非「主动退出」→ 直接放行
    if (auth.isLoggedIn() && !auth.isLoggedOut()) {
      this.goHome()
    }
  },

  onShow() {
    // 从协议页返回等情况复核登录态；完善资料步骤中不打断
    if (this.data.step !== 'intro' || this.data.loading) return
    if (auth.isLoggedIn() && !auth.isLoggedOut()) {
      this.goHome()
    }
  },

  /**
   * 登录成功后的去向（P1：不再一律跳首页，避免丢失登录前上下文）
   * 优先级：① 显式 redirect 参数 ② 返回上一页（引导登录场景，上一页即原页面）
   *        ③ 兜底回首页（冷启动直达登录页且无 redirect）
   */
  goHome() {
    const redirect = this._redirect || ''
    if (redirect) {
      this.navigateToRedirect(redirect)
      return
    }
    // 栈中存在上一页 → 直接返回，用户回到被登录引导打断的原页面（如帖子详情）
    const pages = getCurrentPages()
    if (pages && pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.switchTab({ url: '/pages/feed/index' })
  },

  /**
   * 按 redirect 目标跳转：Tab 页必须用 switchTab，其余用 redirectTo
   * @param {string} url 目标路由（可能带 query）
   */
  navigateToRedirect(url) {
    const TAB_PAGES = [
      '/pages/feed/index',
      '/pages/discover/index',
      '/pages/publish/index',
      '/pages/message/index',
      '/pages/profile/index'
    ]
    const pure = url.split('?')[0]
    if (TAB_PAGES.indexOf(pure) !== -1) {
      wx.switchTab({ url: pure })
    } else {
      wx.redirectTo({ url })
    }
  },

  /**
   * 勾选 / 取消勾选同意协议
   */
  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  /**
   * 查看用户协议 / 隐私政策
   */
  onAgreement(e) {
    const type = e.currentTarget.dataset.type === 'agreement' ? 'agreement' : 'privacy'
    wx.navigateTo({ url: '/pages/agreement/index?type=' + type })
  },

  /**
   * 微信隐私协议授权
   * - 已在小程序后台配置隐私协议且需要授权时，弹出官方隐私弹窗
   * - 未配置隐私协议、或基础库不支持该接口时直接放行（降级不阻断）
   * @returns {Promise<boolean>} 用户是否已授权
   */
  requirePrivacy() {
    return new Promise((resolve) => {
      if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
        resolve(true)
        return
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res || !res.needAuthorization) {
            resolve(true)
            return
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: () => resolve(false)
          })
        },
        fail: () => resolve(true)
      })
    })
  },

  /**
   * 判断用户资料是否需要引导完善
   * 服务端首次建档会给「校园用户+随机数」的昵称且头像为空，据此判断
   * @param {object} info 用户公开资料
   * @returns {boolean}
   */
  needCompleteProfile(info) {
    if (!info) return true
    const nickname = (info.nickname || '').trim()
    const avatar = (info.avatar || '').trim()
    const defaultNickname = !nickname || DEFAULT_NICKNAME_RE.test(nickname)
    return defaultNickname || !avatar
  },

  /**
   * 点击「微信登录」
   * 勾选校验 → 隐私授权 → 云函数登录 → 资料完善或直接进首页
   */
  onLogin() {
    if (this.data.loading) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意《用户协议》和《隐私政策》', icon: 'none' })
      return
    }
    this.setData({ loading: true })

    this.requirePrivacy()
      .then((granted) => {
        if (!granted) {
          const err = new Error('PRIVACY_REJECTED')
          throw err
        }
        return auth.login()
      })
      .then((data) => {
        const info = (data && data.userInfo) || {}
        // 同步到全局用户状态，各页面立即生效
        userStore.setUser(info)
        if (this.needCompleteProfile(info)) {
          this.enterProfileStep(info)
        } else {
          wx.showToast({ title: '登录成功', icon: 'success' })
          this.goHome()
        }
      })
      .catch((err) => {
        console.error('登录失败', err)
        const rejected = err && err.message === 'PRIVACY_REJECTED'
        wx.showToast({
          title: rejected ? '需同意隐私政策后才能登录' : '登录失败，请重试',
          icon: 'none'
        })
      })
      .then(() => {
        // 无论成功失败都恢复按钮态
        this.setData({ loading: false })
      })
  },

  /**
   * 进入「完善资料」步骤
   * @param {object} info 用户公开资料
   */
  enterProfileStep(info) {
    const nickname = (info && info.nickname) || ''
    this.setData({
      step: 'profile',
      // 默认昵称不回填，让用户直接使用微信昵称
      nickname: DEFAULT_NICKNAME_RE.test(nickname) ? '' : nickname,
      avatar: sanitizeImageUrl((info && info.avatar) || '', DEFAULT_AVATAR),
      avatarChanged: false
    })
  },

  /**
   * 选择微信头像（button open-type="chooseAvatar"）
   */
  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (avatarUrl) {
      this.setData({ avatar: avatarUrl, avatarChanged: true })
    }
  },

  /**
   * 昵称输入（input type="nickname"，可唤起微信昵称填写）
   */
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  /**
   * 暂不完善资料，直接进首页
   */
  onSkipProfile() {
    this.goHome()
  },

  /**
   * 提交完善后的资料
   */
  onSubmitProfile() {
    if (this.data.saving) return
    const nickname = (this.data.nickname || '').trim()
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    this.setData({ saving: true })

    this.uploadAvatarIfNeeded()
      .then((finalAvatar) => this.saveProfile(nickname, finalAvatar))
      .then(() => {
        wx.showToast({ title: '资料已完善', icon: 'success' })
        // 广播资料更新，通知首页/详情等页面刷新作者信息
        eventBus.emit('profileUpdated')
        setTimeout(() => this.goHome(), 600)
      })
      .catch((err) => {
        console.error('完善资料失败', err)
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
      .then(() => {
        wx.hideLoading()
        this.setData({ saving: false })
      })
  },

  /**
   * 按需上传头像
   * chooseAvatar 返回的是本地临时路径，必须上传云存储后才能持久化；
   * 仅 cloud://（已上传）与 https://（微信 CDN 长期有效）无需重复上传。
   * @returns {Promise<string|undefined>} 最终头像地址；未修改头像时返回 undefined
   */
  uploadAvatarIfNeeded() {
    const { avatar, avatarChanged } = this.data
    const needUpload = avatarChanged
      && avatar
      && avatar.indexOf('cloud://') !== 0
      && avatar.indexOf('https://') !== 0
      && avatar.indexOf(DEFAULT_AVATAR) !== 0

    if (!needUpload) {
      // 未修改头像：不提交 avatar 字段，避免把 HTTP 临时 URL 覆盖回数据库
      return Promise.resolve(undefined)
    }

    wx.showLoading({ title: '上传头像中', mask: true })
    return uploadImages([avatar], auth.getUploadKey()).then((res) => {
      const cloudAvatar = (res && res[0]) || ''
      if (!cloudAvatar) {
        const err = new Error('头像上传失败')
        throw err
      }
      return cloudAvatar
    })
  },

  /**
   * 保存资料并同步全局状态
   * @param {string} nickname 昵称
   * @param {string|undefined} finalAvatar 头像（未修改时为空）
   * @returns {Promise}
   */
  saveProfile(nickname, finalAvatar) {
    const payload = { nickname }
    if (finalAvatar) payload.avatar = finalAvatar

    return api.user.updateProfile(payload).then((res) => {
      const info = (res && res.data) || null
      if (info) {
        userStore.setUser(info)
      } else {
        const cached = (userStore.getState() && userStore.getState().userInfo) || {}
        userStore.setUser(Object.assign({}, cached, payload))
      }
      return info
    })
  }
})
