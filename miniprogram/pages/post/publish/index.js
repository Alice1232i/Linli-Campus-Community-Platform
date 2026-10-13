// pages/post/publish/index.js
// 发帖页 - 发布社区图文帖
// 流程：检查登录态 -> 填写标题/正文/图片/标签 -> 上传图片 -> 调用 api.post.create

const api = require('../../../api/index.js')
const eventBus = require('../../../store/eventBus')
const { checkLogin, isLoggedIn, getUploadKey } = require('../../../utils/auth')
const { uploadImages } = require('../../../utils/upload')
const { ensurePrivacy, isUserCancel, showChooseFailDialog } = require('../../../utils/privacy')
const userStore = require('../../../store/user')
const { SECTIONS } = require('../../../utils/shared/constants')

/** 草稿本地存储键 */
const DRAFT_KEY = 'post_draft_v1'

Page({
  /**
   * 页面数据
   */
  data: {
    // 板块列表：引用全局常量，与首页宫格导航名称保持一致
    sections: SECTIONS,
    // 当前选中板块（空字符串表示未选择，发布前必须显式选择）
    section: '',
    // 板块 picker 选中索引（-1 表示未选择，显示「请选择板块」）
    sectionIndex: -1,
    // 标题（可选）
    title: '',
    // 正文
    content: '',
    // 本地图片临时路径数组
    images: [],
    // 标签（逗号分隔的字符串）
    tagInput: '',
    // 是否提交中
    submitting: false,
    // 是否编辑模式（由详情页带入 postId 触发）
    editMode: false,
    // ===== 二手交易字段（section=secondhand 时使用）=====
    // 商品价格（元）
    tradePrice: '',
    // 商品成色
    tradeCondition: '全新',
    // 成色选项
    conditionOptions: ['全新', '几乎全新', '九成新', '八成新', '七成新及以下'],
    // 成色 picker 索引
    conditionIndex: 0,
    // 交易类型：sell 出售 / buy 求购
    tradeType: 'sell',
    // ===== 匿名发帖开关 =====
    // 开启后帖子作者展示为随机匿名昵称，后台仍记录真实 openid
    isAnonymous: false
  },

  /**
   * 页面加载
   * 检查登录态，未登录跳转登录页
   * 支持通过 URL 参数 section 预选板块（从专区页发帖时自动带入）
   */
  onLoad(options) {
    // 显示值 -> 原始 cloud:// fileID 的映射（仅编辑模式会填充）。
    // 提交时据此把「原帖图片的显示链接」还原为 fileID 原样回传，避免保存时清空原图。
    this._imageFileIdByUrl = {}

    // 编辑模式：从帖子详情页带入 postId，加载原帖内容回显
    if (options && options.postId) {
      this._editingPostId = options.postId
      this.setData({ editMode: true })
      this.loadPostForEdit(options.postId)
      return
    }

    // 如果传入了板块参数，自动选中对应板块
    if (options && options.section) {
      const sectionKey = options.section
      const sections = this.data.sections
      const index = sections.findIndex(s => s.key === sectionKey)
      if (index !== -1) {
        this.setData({
          section: sectionKey,
          sectionIndex: index
        })
      }
    }

    // 消费发布弹窗带入的图片（相册/拍照选择的本地临时路径）
    // 读取后立即清空 globalData，防止下次「写文字」进入时串入旧图片
    const app = getApp()
    const pending = app && app.globalData && app.globalData.pendingImages
    if (pending && pending.length) {
      this.setData({ images: pending.slice(0, 9) })
      app.globalData.pendingImages = null
    } else {
      // 无带图进入时才检查草稿（避免草稿覆盖刚选的图）
      this.loadDraftIfAny()
    }

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
   * 编辑模式：加载原帖内容回显
   * 图片会一并回显，且支持增删（新增图片在提交时上传，原有图片原样保留）
   * @param {string} postId 帖子 ID
   */
  loadPostForEdit(postId) {
    wx.showLoading({ title: '加载中...', mask: true })
    api.post.detail(postId)
      .then((res) => {
        const post = (res && res.data) || null
        wx.hideLoading()
        if (!post) {
          wx.showToast({ title: '帖子不存在', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 800)
          return
        }
        const sections = this.data.sections
        const index = Math.max(0, sections.findIndex((s) => s.key === post.section))

        // ---- 图片回显（修复：此前这里完全没有 setData images，编辑时照片会「消失」）----
        // post.images 已被服务端转换成可显示的 HTTP 临时链接；
        // post.imageFileIds 是服务端额外下发的原始 cloud:// fileID（仅作者可得，与 images 一一对应）。
        // 记下两者的对应关系，提交时才能把原图原样回传 —— 否则会用空数组覆盖、清空原帖图片。
        const displayImages = Array.isArray(post.images) ? post.images.filter(Boolean) : []
        const rawIds = Array.isArray(post.imageFileIds) ? post.imageFileIds : []
        displayImages.forEach((url, i) => {
          if (rawIds[i]) this._imageFileIdByUrl[url] = rawIds[i]
        })

        this.setData({
          section: post.section || 'daily',
          sectionIndex: index,
          title: post.title || '',
          content: post.content || '',
          tagInput: (post.tags || []).join('，'),
          isAnonymous: !!post.isAnonymous,
          images: displayImages
        })
      })
      .catch((err) => {
        wx.hideLoading()
        console.error('[publish] 加载帖子失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
      })
  },

  /**
   * 板块 picker 变化
   */
  onSectionChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      sectionIndex: index,
      section: this.data.sections[index].key
    })
  },

  /**
   * 价格输入
   */
  onPriceInput(e) {
    this.setData({ tradePrice: e.detail.value })
  },

  /**
   * 成色 picker 变化
   */
  onConditionChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      conditionIndex: index,
      tradeCondition: this.data.conditionOptions[index]
    })
  },

  /**
   * 交易类型切换：出售 / 求购
   */
  onTradeTypeChange(e) {
    this.setData({ tradeType: e.currentTarget.dataset.type })
  },

  /**
   * 匿名发帖开关切换
   * 开启后帖子作者展示为随机匿名昵称，后台仍记录真实身份
   */
  onAnonymousChange(e) {
    this._clientId = null
    this.setData({ isAnonymous: e.detail.value })
  },

  /**
   * 标题输入
   * 修改内容后清除幂等键，确保重新提交创建新帖而非返回旧帖
   */
  onTitleInput(e) {
    this._clientId = null
    this.setData({ title: e.detail.value })
  },

  /**
   * 正文输入
   * 修改内容后清除幂等键，确保重新提交创建新帖而非返回旧帖
   */
  onContentInput(e) {
    this._clientId = null
    this.setData({ content: e.detail.value })
  },

  /**
   * 标签输入
   * 修改内容后清除幂等键
   */
  onTagInput(e) {
    this._clientId = null
    this.setData({ tagInput: e.detail.value })
  },

  /**
   * 图片上传组件变化回调（兼容旧组件用法）
   */
  onImagesChange(e) {
    this.setData({ images: e.detail.images })
  },

  /**
   * 图片横滑条：继续添加（最多 9 张）
   */
  onAddImages() {
    const remain = 9 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 9 张', icon: 'none' })
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
        sizeType: ['compressed'],
        success: (res) => {
          const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
          if (!paths.length) return
          this._clientId = null
          this.setData({ images: this.data.images.concat(paths).slice(0, 9) })
        },
        fail: (err) => {
          // 用户主动取消：静默；其余失败必须提示，否则表现为「点了没反应」
          if (isUserCancel(err)) return
          console.error('[publish] 选择图片失败:', err)
          showChooseFailDialog(err)
        }
      })
    })
  },

  /**
   * 图片横滑条：预览
   */
  onPreviewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    })
  },

  /**
   * 图片横滑条：删除
   */
  onRemoveImage(e) {
    const index = e.currentTarget.dataset.index
    const next = this.data.images.slice()
    next.splice(index, 1)
    this._clientId = null
    this.setData({ images: next })
  },

  /**
   * 存草稿：文本信息存本地 Storage + 图片用 saveFile 落盘（临时路径重启后失效）
   */
  onSaveDraft() {
    const { section, sectionIndex, title, content, images, tagInput, isAnonymous } = this.data
    if (!content.trim() && !title.trim() && !images.length) {
      wx.showToast({ title: '还没有内容可保存', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...', mask: true })
    this._persistImages(images)
      .then((savedPaths) => {
        wx.setStorageSync(DRAFT_KEY, {
          section,
          sectionIndex,
          title,
          content,
          tagInput,
          isAnonymous,
          images: savedPaths,
          updatedAt: Date.now()
        })
        wx.hideLoading()
        wx.showToast({ title: '已存草稿', icon: 'success' })
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      })
  },

  /**
   * 图片落盘：临时路径 -> 本地持久路径（超 10MB 上限时该图降级丢弃）
   * @param {Array} paths 本地临时路径
   * @returns {Promise<Array>} 持久化后的路径数组
   */
  _persistImages(paths) {
    if (!paths || !paths.length) return Promise.resolve([])
    const fs = wx.getFileSystemManager()
    const userPath = (wx.env && wx.env.USER_DATA_PATH) || ''
    return Promise.all(paths.map((p) => new Promise((resolve) => {
      // 已是持久路径则原样保留
      if (userPath && p.indexOf(userPath) === 0) {
        resolve(p)
        return
      }
      fs.saveFile({
        tempFilePath: p,
        success: (r) => resolve(r.savedFilePath || ''),
        fail: () => resolve('')
      })
    }))).then((arr) => arr.filter(Boolean))
  },

  /**
   * 进入发帖页时检查草稿：有则询问恢复（编辑模式/带图进入时不打扰）
   */
  loadDraftIfAny() {
    const draft = wx.getStorageSync(DRAFT_KEY)
    if (!draft) return
    wx.showModal({
      title: '发现草稿',
      content: '上次有一篇没发出去的草稿，要恢复吗？',
      confirmText: '恢复',
      cancelText: '不用了',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            section: draft.section || '',
            sectionIndex: typeof draft.sectionIndex === 'number' ? draft.sectionIndex : -1,
            title: draft.title || '',
            content: draft.content || '',
            images: (draft.images || []).slice(0, 9),
            tagInput: draft.tagInput || '',
            isAnonymous: !!draft.isAnonymous
          })
        } else {
          wx.removeStorageSync(DRAFT_KEY)
        }
      }
    })
  },

  /**
   * 页面卸载
   * P1：内容非空、非编辑模式、非发布成功时，静默把草稿落到本地 Storage，
   * 避免「长文 + 9 图误触返回」导致内容全丢（社区类产品的高频投诉点）。
   * 采用静默保存而非拦截弹窗：用户无需做选择即可保全内容，下次进入发帖页会提示恢复。
   */
  onUnload() {
    // 编辑已有帖子：不属于「未完成的发帖」，不写草稿
    if (this._editingPostId) return
    // 已发布成功：无需留草稿
    if (this._published) return
    const { section, sectionIndex, title, content, images, tagInput, isAnonymous } = this.data
    // 无实质内容不写，避免产生空草稿打扰下次进入
    if (!content.trim() && !title.trim() && !images.length) return
    // 图片临时路径重启后失效，先落盘为持久路径再写入草稿
    this._persistImages(images)
      .then((savedPaths) => {
        wx.setStorageSync(DRAFT_KEY, {
          section,
          sectionIndex,
          title,
          content,
          tagInput,
          isAnonymous,
          images: savedPaths,
          updatedAt: Date.now()
        })
        console.info('[publish] 离开页面时已自动保存草稿')
      })
      .catch((e) => {
        console.warn('[publish] 自动保存草稿失败:', e && e.message)
      })
  },

  /**
   * 点击发布按钮
   * 双重防抖：实例属性同步锁 + data.submitting 状态锁
   * 成功后不重置锁（页面即将销毁），仅失败时重置允许重试
   */
  onSubmit() {
    // 实例级同步锁：防止极端快速双击在 setData 生效前穿透
    if (this._submitting) return
    this._submitting = true

    // data 状态锁：控制按钮 disabled 样式
    if (this.data.submitting) return

    // 封禁/禁言用户不可发帖
    if (userStore.isBanned()) {
      this._submitting = false
      wx.showToast({ title: '账号已被封禁，无法发帖', icon: 'none' })
      return
    }
    if (userStore.isMuted()) {
      this._submitting = false
      wx.showToast({ title: '账号已被禁言，无法发帖', icon: 'none' })
      return
    }

    // ---- 幂等键：同一批发帖请求复用同一 clientId ----
    // 弱网超时重试时，服务端用 clientId 去重，避免创建重复帖子
    // 用户修改内容后重新提交时，onContentInput 会清除 _clientId，生成新的
    if (!this._clientId) {
      this._clientId = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8)
    }
    const clientId = this._clientId

    const { section, title, content, images, tagInput, tradePrice, tradeCondition, tradeType, isAnonymous } = this.data

    // 表单校验（顺序：先板块，再内容）
    // 1. 板块必选：板块是内容分发的前提，未选不允许发布
    if (!section) {
      this._submitting = false
      wx.showToast({ title: '请先选择板块', icon: 'none' })
      return
    }

    // 2. 正文与图片至少填一项（纯图片帖 / 纯文字帖都允许）
    if (!content.trim() && images.length === 0) {
      this._submitting = false
      wx.showToast({ title: '请输入正文或添加图片', icon: 'none' })
      return
    }

    // 二手板块额外校验：价格必填
    if (section === 'secondhand') {
      const price = parseFloat(tradePrice)
      if (!tradePrice || isNaN(price) || price < 0) {
        this._submitting = false
        wx.showToast({ title: '请输入有效价格', icon: 'none' })
        return
      }
    }

    // 再次校验登录态
    if (!isLoggedIn()) {
      this._submitting = false
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }

    this.setData({ submitting: true })

    // 请求订阅消息授权（举报结果通知）：发布内容后若被举报并处理，可收到微信服务通知；拒绝不影响发帖
    wx.requestSubscribeMessage({
      tmplIds: ['e9e-G1oO7Ed6uFKtUlZR9o2RHcdtGdi0P9_xtHYxdw4'],
      fail: function() {
        // 用户拒绝或系统不支持时静默跳过
      }
    })

    // 多图发帖时图片审核较慢，提示用户耐心等待
    const loadingText = images.length > 0 ? '发布中（审核图片）...' : '发布中...'
    wx.showLoading({ title: loadingText, mask: true })

    // 1. 解析待上传的图片
    // 传入 uploadKey 嵌入云存储路径，服务端据此校验图片归属（安全改造后不再使用 openid）
    // 编辑模式下：原帖图片已能通过 _imageFileIdByUrl 还原成 fileID、无需重新上传，
    //             只上传用户新选的图片；因此「凡是映射表里没有的都是新选的本地路径」。
    const isEdit = !!this._editingPostId
    const uploadKey = getUploadKey() || ''
    const idByUrl = this._imageFileIdByUrl || {}
    // 兜底：形如 http(s):// 的显示链接不能被当作本地文件上传（否则 getFileInfo 失败会整单报错）。
    // 正常流程下这些链接都能在 _imageFileIdByUrl 里找到原始 fileID，不会走到这里。
    const pendingPaths = images.filter((u) => !idByUrl[u] && !/^https?:\/\//.test(u))
    const uploadTask = pendingPaths.length
      ? uploadImages(pendingPaths, uploadKey, {
          // 进度反馈（P1）：9 图场景此前全程只有转圈，现实时显示整体百分比
          onProgress: (percent) => {
            wx.showLoading({ title: '上传图片 ' + percent + '%', mask: true })
          }
        })
      : Promise.resolve([])

    uploadTask
      .then((uploadedUrls) => {
        // 本地路径 -> 本次新上传的 fileID
        const uploadedByPath = {}
        const newFileIds = []
        pendingPaths.forEach((p, i) => {
          if (uploadedUrls[i]) {
            uploadedByPath[p] = uploadedUrls[i]
            newFileIds.push(uploadedUrls[i])
          }
        })
        // 按当前展示顺序组装最终 fileID 列表：
        //   原帖图片 → 用映射还原的原始 fileID（原样保留，否则会清空原图）
        //   新选图片 → 刚上传拿到的 fileID
        // 两者都取不到的项直接丢弃（例如上传失败），避免把非法地址写进帖子
        const finalImages = images
          .map((u) => idByUrl[u] || uploadedByPath[u] || '')
          .filter(Boolean)
        // 仅记录「本次新上传」的 fileID 供失败时清理孤儿图片 —— 原帖图片绝不能被删
        this._uploadedImageUrls = newFileIds

        // 2. 解析标签
        const tags = tagInput
          ? tagInput.split(/[,，]/).map(t => t.trim()).filter(Boolean)
          : []

        // 3. 组装 tradeInfo（仅二手板块）
        const tradeInfo = section === 'secondhand' ? {
          price: parseFloat(tradePrice),
          condition: tradeCondition,
          tradeType
        } : undefined

        // 4. 调用发布/编辑接口
        if (isEdit) {
          // 编辑：更新文本与图片（板块/交易信息/匿名设置保持不变）
          return api.post.update(this._editingPostId, {
            title: title.trim(),
            content: content.trim(),
            images: finalImages,
            tags
          })
        }
        return api.post.create({
          module: 'community',
          section,
          title: title.trim(),
          content: content.trim(),
          images: finalImages,
          tags,
          type: finalImages.length > 0 ? 'image' : 'text',
          tradeInfo,
          isAnonymous: !!isAnonymous,
          clientId
        })
      })
      .then(() => {
        wx.hideLoading()
        // 清理暂存的图片 fileID（发帖成功，图片已绑定到帖子）
        this._uploadedImageUrls = null
        // 发布成功：清除本地草稿，并标记 _published 以免 onUnload 再次写入
        wx.removeStorageSync(DRAFT_KEY)
        this._published = true
        // 通知首页刷新
        eventBus.emit('refreshFeed')

        // 编辑模式：提示保存成功并返回详情页
        if (isEdit) {
          wx.showToast({ title: '保存成功', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack()
          }, 800)
          return
        }

        // 发布成功引导：去首页看看 / 继续发帖
        wx.showModal({
          title: '发布成功',
          content: '内容已发布，去首页看看？',
          confirmText: '去看看',
          cancelText: '继续发帖',
          success: (res) => {
            if (res.confirm) {
              // switchTab 会关闭当前发帖页，直接回首页信息流
              wx.switchTab({ url: '/pages/feed/index' })
            } else {
              // 继续发帖：重置表单，保持页面不解锁（重新走一遍提交锁）
              this.resetForm()
            }
          },
          fail: () => {
            wx.navigateBack()
          }
        })
      })
      .catch((err) => {
        console.error('[publish] 发帖失败:', err)
        const errMsg = (err && err.message) || ''
        // 是否为超时/网络错误（业务码 -1）：此时服务端可能已创建帖子，
        // 绝不能清理图片，否则会出现「帖子在但图被删」的情况（9 图审核慢易触发）
        const isTimeout = errMsg.indexOf('超时') !== -1 || errMsg.indexOf('timed out') !== -1
        // 是否为明确业务失败（业务码 > 0，如审核不通过/频率限制）：服务端已拒绝，帖子未创建，可安全清理
        const isBusinessError = err && typeof err.code === 'number' && err.code > 0 && !isTimeout

        // ---- 孤儿图片清理：仅明确业务失败时删除已上传图片；超时/网络错误保留（服务端可能已创建）----
        if (isBusinessError && this._uploadedImageUrls && this._uploadedImageUrls.length > 0) {
          wx.cloud.deleteFile({
            fileList: this._uploadedImageUrls
          }).catch(function(e) {
            console.warn('[publish] 清理孤儿图片失败:', e)
          })
          this._uploadedImageUrls = null
        }
        wx.hideLoading()
        // 弱网友好提示：区分超时、审核失败和其他错误
        var msg = '发布失败，请重试'
        if (errMsg) {
          if (isTimeout) {
            msg = '网络较慢，可能已发布成功，请到「我的帖子」确认'
          } else if (errMsg.indexOf('违规') !== -1 || errMsg.indexOf('审核') !== -1) {
            msg = errMsg
          } else if (errMsg.indexOf('频繁') !== -1) {
            msg = errMsg
          } else {
            msg = errMsg
          }
        }
        wx.showToast({ title: msg, icon: 'none', duration: 3000 })
        // 失败时重置锁，允许用户重试
        this._submitting = false
        this.setData({ submitting: false })
      })
  },

  /**
   * 重置表单（发布成功后「继续发帖」使用）
   * 清空内容与提交锁，回到初始未选板块状态
   */
  resetForm() {
    this._submitting = false
    this._clientId = null
    this.setData({
      section: '',
      sectionIndex: -1,
      title: '',
      content: '',
      images: [],
      tagInput: '',
      isAnonymous: false,
      tradePrice: '',
      tradeCondition: '全新',
      conditionIndex: 0,
      tradeType: 'sell',
      submitting: false
    })
  }
})
