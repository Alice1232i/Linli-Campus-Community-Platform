// pages/user/edit/index.js
// 编辑资料页
// 加载并编辑用户头像、昵称、性别、学院 / 专业 / 届数、个人简介
// 保存后同步到全局 userStore 并返回上一页

const api = require('../../../api/index.js')
const { getUploadKey } = require('../../../utils/auth')
const userStore = require('../../../store/user')
const eventBus = require('../../../store/eventBus.js')
const { uploadImages } = require('../../../utils/upload')
const { sanitizeImageUrl } = require('../../../utils/format')
const { COLLEGE_MAJORS, GRADE_YEARS } = require('../../../utils/shared/constants.js')

// 默认头像（未设置头像时占位）
const DEFAULT_AVATAR = '/images/icons/user_profile.png'

// 学院名列表（供 picker 直接使用）
const COLLEGE_NAMES = COLLEGE_MAJORS.map(function (c) { return c.name })

/**
 * 取某学院下的专业列表
 * @param {string} college 学院名
 * @returns {string[]}
 */
function majorsOf(college) {
  for (let i = 0; i < COLLEGE_MAJORS.length; i++) {
    if (COLLEGE_MAJORS[i].name === college) return COLLEGE_MAJORS[i].majors
  }
  return []
}

Page({
  data: {
    loading: true,      // 资料加载中
    saving: false,      // 保存中
    // 是否加载失败（P0-4：失败时展示错误占位 + 重试，避免展示空白表单）
    loadError: false,
    // 加载失败提示文案
    loadErrorText: '',
    avatar: '',         // 头像地址
    avatarChanged: false, // 头像是否被用户修改（仅修改后才需上传/提交）
    nickname: '',       // 昵称
    gender: 0,          // 性别：0 保密 / 1 男 / 2 女
    bio: '',            // 个人简介
    // ---- 院系信息 ----
    college: '',        // 学院
    major: '',          // 专业（依赖学院）
    grade: '',          // 届数（毕业年份，字符串）
    // picker 数据源
    collegeNames: COLLEGE_NAMES,
    collegeIndex: 0,
    majorOptions: [],   // 当前学院下的专业（选了学院才有）
    majorIndex: 0,
    gradeYears: GRADE_YEARS,
    gradeIndex: 0,
    defaultAvatar: DEFAULT_AVATAR
  },

  onLoad() {
    this.loadProfile()
  },

  /**
   * 加载当前用户资料
   */
  loadProfile() {
    this.setData({ loading: true, loadError: false })
    api.user.getProfile()
      .then(res => {
        const info = (res && res.data) || {}
        // 净化头像：数据库中可能残留 wxfile:// 临时路径，替换为默认头像
        const rawAvatar = info.avatar || ''
        const avatar = sanitizeImageUrl(rawAvatar, DEFAULT_AVATAR)

        // 回显院系信息：学院 → 联动出专业列表 → 再定位专业与届数
        const college = info.college || ''
        const major = info.major || ''
        const grade = info.grade || ''
        const majorOptions = college ? majorsOf(college) : []

        this.setData({
          avatar: avatar,
          avatarChanged: false, // 加载原始资料，重置修改标记
          nickname: info.nickname || '',
          gender: typeof info.gender === 'number' ? info.gender : 0,
          bio: info.bio || '',
          college: college,
          major: major,
          grade: grade,
          collegeIndex: Math.max(0, COLLEGE_NAMES.indexOf(college)),
          majorOptions: majorOptions,
          majorIndex: Math.max(0, majorOptions.indexOf(major)),
          gradeIndex: Math.max(0, GRADE_YEARS.indexOf(grade)),
          loadError: false
        })
      })
      .catch(err => {
        console.error('加载资料失败', err)
        // P0-4：进入错误态并提供「重新加载」，避免展示空白表单
        this.setData({
          loadError: true,
          loadErrorText: (err && err.message) || '加载失败，请检查网络后重试'
        })
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  /**
   * 重新加载资料（P0-4 错误态重试入口）
   */
  onRetry() {
    this.loadProfile()
  },

  /**
   * 选择头像
   * 使用 button open-type="chooseAvatar" 获取微信头像
   */
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    if (avatarUrl) {
      // 标记头像已被用户修改，保存时才需要上传并提交
      this.setData({ avatar: avatarUrl, avatarChanged: true })
    }
  },

  /**
   * 昵称输入（input type="nickname"）
   */
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  /**
   * 性别选择
   */
  onGenderChange(e) {
    this.setData({ gender: Number(e.detail.value) })
  },

  /**
   * 学院变更：联动刷新专业列表
   * 原专业若仍属于新学院则保留，否则清空（避免出现「学院与专业不匹配」）
   */
  onCollegeChange(e) {
    const index = Number(e.detail.value)
    const college = this.data.collegeNames[index] || ''
    const majorOptions = majorsOf(college)
    const major = majorOptions.indexOf(this.data.major) !== -1 ? this.data.major : ''
    this.setData({
      college: college,
      collegeIndex: index,
      majorOptions: majorOptions,
      major: major,
      majorIndex: Math.max(0, majorOptions.indexOf(major))
    })
  },

  /**
   * 专业变更
   */
  onMajorChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      major: this.data.majorOptions[index] || '',
      majorIndex: index
    })
  },

  /**
   * 届数变更
   */
  onGradeChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      grade: this.data.gradeYears[index] || '',
      gradeIndex: index
    })
  },

  /**
   * 个人简介输入
   */
  onBioInput(e) {
    this.setData({ bio: e.detail.value })
  },

  /**
   * 保存资料
   * 头像仅在被用户修改时才上传云存储并提交；
   * 未修改头像时不传 avatar 字段，避免把 HTTP 临时 URL 覆盖回数据库
   * 成功后更新 userStore 并返回
   */
  onSave() {
    if (this.data.saving) return
    const {
      nickname, avatar, gender, bio, avatarChanged,
      college, major, grade
    } = this.data
    if (!nickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    // 前置校验：专业必须挂在学院下（与服务端校验保持一致，避免无效请求）
    if (major && !college) {
      wx.showToast({ title: '请先选择学院', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    // 仅当用户修改了头像，且新头像是本地临时路径时才需上传到云存储
    // 注意：微信 chooseAvatar 返回的是 http://tmp/xxx 本地临时路径，必须上传；
    //       仅 cloud://（已上传）与 https://（微信 CDN 长期有效）不重复上传。
    // 修复：此前把 http:// 前缀一律当作有效网络 URL 跳过上传，导致临时头像直接存库、重启后失效。
    const needUpload = avatarChanged
      && avatar
      && avatar.indexOf('cloud://') !== 0
      && avatar.indexOf('https://') !== 0
      && avatar.indexOf(DEFAULT_AVATAR) !== 0

    const doSave = (finalAvatar) => {
      // 构造更新数据：未修改头像时不传 avatar 字段，保留数据库中的原始 cloud:// fileID
      // 学院/专业/届数始终提交（空字符串表示清空），由服务端做清单校验
      const updateData = {
        nickname: nickname.trim(),
        gender,
        bio: bio.trim(),
        college: college || '',
        major: major || '',
        grade: grade || ''
      }
      if (avatarChanged) {
        updateData.avatar = finalAvatar
      }
      api.user.updateProfile(updateData)
        .then(res => {
          // 接口若返回最新资料则直接写入全局状态
          const info = (res && res.data) || null
          if (info) {
            userStore.setUser(info)
          } else {
            // 否则用本地编辑结果合并当前缓存后写入
            const cached = (userStore.getState() && userStore.getState().userInfo) || {}
            const merged = Object.assign({}, cached, {
              nickname: nickname.trim(),
              gender,
              bio: bio.trim(),
              college: college || '',
              major: major || '',
              grade: grade || ''
            })
            // 仅在头像被修改时才覆盖缓存中的头像
            if (avatarChanged) {
              merged.avatar = finalAvatar
            }
            userStore.setUser(merged)
          }
          wx.showToast({ title: '保存成功', icon: 'success' })
          // 广播资料更新事件，通知首页/详情/我的帖子等页面刷新作者信息
          eventBus.emit('profileUpdated')
          setTimeout(() => wx.navigateBack(), 600)
        })
        .catch(err => {
          console.error('保存失败', err)
          const msg = (err && err.message) || '保存失败，请重试'
          wx.showToast({ title: msg, icon: 'none' })
        })
        .then(() => {
          this.setData({ saving: false })
        })
    }

    if (needUpload) {
      // 临时头像先上传云存储，拿到 cloud:// fileID 再提交
      wx.showLoading({ title: '上传头像中', mask: true })
      uploadImages([avatar], getUploadKey())
        .then(res => {
          const cloudAvatar = (res && res[0]) || ''
          if (!cloudAvatar) {
            throw new Error('头像上传失败')
          }
          this.setData({ avatar: cloudAvatar })
          doSave(cloudAvatar)
        })
        .catch(err => {
          console.error('头像上传失败', err)
          wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
          this.setData({ saving: false })
        })
        .then(() => {
          wx.hideLoading()
        })
    } else {
      doSave(avatar)
    }
  }
})
