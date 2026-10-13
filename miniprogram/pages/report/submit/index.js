// pages/report/submit/index.js
// 举报提交页
// 从 URL 参数获取举报目标，选择理由 + 描述 + 证据图片后提交

const api = require('../../../api/index.js')
const { getToken } = require('../../../utils/auth')
const { uploadImages } = require('../../../utils/upload.js')
const { ensurePrivacy, isUserCancel, showChooseFailDialog } = require('../../../utils/privacy')

Page({
  /**
   * 页面数据
   */
  data: {
    // 举报目标类型，如 'post' / 'comment' / 'user'
    targetType: '',
    // 目标 ID
    targetId: '',
    // 选中的举报理由
    reason: '',
    // 举报理由选项
    // value 必须与云函数 REASONS 白名单一致（英文枚举）
    reasonOptions: [
      { value: 'spam', label: '垃圾广告' },
      { value: 'abuse', label: '辱骂攻击' },
      { value: 'porn', label: '色情低俗' },
      { value: 'fraud', label: '欺诈' },
      { value: 'privacy', label: '侵犯隐私' },
      { value: 'other', label: '其他' }
    ],
    // 详细描述
    detail: '',
    // 证据图片地址列表
    evidence: [],
    // 是否正在提交
    submitting: false,
    // 是否允许提交（举报目标缺失时禁用）
    canSubmit: true
  },

  /**
   * 页面加载
   * 解析举报目标类型与 ID
   */
  onLoad(options) {
    const targetType = options.targetType || ''
    const targetId = options.targetId || ''

    // 举报目标缺失时禁止提交，避免提交空目标举报
    if (!targetType || !targetId) {
      this.setData({ targetType, targetId, canSubmit: false })
      wx.showToast({ title: '举报目标缺失', icon: 'none' })
      return
    }

    this.setData({ targetType, targetId, canSubmit: true })
  },

  /**
   * 举报理由变化（radio-group）
   */
  onReasonChange(e) {
    this.setData({ reason: e.detail.value })
  },

  /**
   * 详细描述输入（textarea）
   */
  onDetailInput(e) {
    this.setData({ detail: e.detail.value })
  },

  /**
   * 选择证据图片（可选）
   */
  onChooseEvidence() {
    const remain = 3 - this.data.evidence.length
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 3 张', icon: 'none' })
      return
    }
    // 相册/相机属隐私接口：必须先取得隐私授权，否则 chooseMedia 会失败
    ensurePrivacy().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私政策后才能选择图片', icon: 'none' })
        return
      }
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const tempFiles = res.tempFiles || []
          const paths = tempFiles.map((f) => f.tempFilePath)
          this.setData({
            evidence: this.data.evidence.concat(paths)
          })
        },
        fail: (err) => {
          // 用户主动取消：静默；其余失败必须提示，否则表现为「点了没反应」
          if (isUserCancel(err)) return
          console.error('[report] 选择图片失败:', err)
          showChooseFailDialog(err)
        }
      })
    })
  },

  /**
   * 删除已选证据图片
   */
  onRemoveEvidence(e) {
    const { index } = e.currentTarget.dataset
    const evidence = this.data.evidence.filter((_, i) => i !== index)
    this.setData({ evidence })
  },

  /**
   * 预览证据图片
   */
  onPreviewEvidence(e) {
    const { src } = e.currentTarget.dataset
    wx.previewImage({
      current: src,
      urls: this.data.evidence
    })
  },

  /**
   * 提交举报
   * 双重防抖：实例级同步锁 + data.submitting 状态锁
   * 防止快速双击时 setData 异步延迟导致穿透
   */
  async onSubmit() {
    // 实例级同步锁：防止 setData 异步延迟期间的快速双击穿透
    if (this._submitting) return
    this._submitting = true

    if (this.data.submitting) {
      this._submitting = false
      return
    }

    const { targetType, targetId, reason, detail, evidence, canSubmit } = this.data

    // 校验：举报目标必须存在
    if (!canSubmit || !targetType || !targetId) {
      this._submitting = false
      wx.showToast({ title: '举报目标缺失', icon: 'none' })
      return
    }

    // 校验：必须选择理由
    if (!reason) {
      this._submitting = false
      wx.showToast({ title: '请选择举报理由', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      // 证据图片先上传到云存储，获取 fileID / 资源地址后再提交
      let evidenceUrls = evidence || []
      if (evidenceUrls.length) {
        evidenceUrls = await uploadImages(evidenceUrls, getUploadKey())
      }

      await api.report.submit(targetType, targetId, reason, detail, evidenceUrls)

      wx.showToast({ title: '举报已提交', icon: 'success' })
      // 成功后不重置锁（页面即将销毁）
      // 延迟返回，让用户看到成功提示
      setTimeout(() => {
        wx.navigateBack()
      }, 800)
    } catch (err) {
      console.error('[report/submit] 提交举报失败:', err)
      const msg = (err && err.message) || '提交失败，请重试'
      wx.showToast({ title: msg, icon: 'none' })
      // 失败时重置锁，允许重试
      this._submitting = false
      this.setData({ submitting: false })
    }
  }
})
