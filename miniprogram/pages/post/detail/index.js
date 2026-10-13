// pages/post/detail/index.js
// 帖子详情页
// 展示帖子正文 + 评论列表 + 底部评论输入栏
// 支持点赞、收藏、评论、回复、删除评论

const api = require('../../../api/index.js')
const { formatTime } = require('../../../utils/format')
const { formatNumber } = require('../../../utils/format')
const { isLoggedIn } = require('../../../utils/auth')
const { getSectionMeta } = require('../../../utils/shared/constants')
const { sanitizeImageUrl } = require('../../../utils/format')
const storage = require('../../../utils/storage')
const eventBus = require('../../../store/eventBus')
const userStore = require('../../../store/user')

// 默认头像（作者头像为空 / 临时路径时占位）
const DEFAULT_AVATAR = '/images/icons/user.png'

Page({
  /**
   * 页面数据
   */
  data: {
    // 帖子 ID
    postId: '',
    // 帖子对象
    post: null,
    // 格式化后的时间
    timeText: '',
    // 正文 rich-text 节点（暂用纯文本节点，后续接入 markdown）
    contentNodes: [],
    // 格式化后的点赞数
    likeText: '0',
    // 格式化后的评论数（仅用于显示，与输入框内容分离，避免互相覆盖）
    commentCountText: '0',
    // 是否已点赞
    liked: false,
    // 是否已收藏
    favorited: false,
    // 评论列表
    comments: [],
    // 评论游标：0 表示首页，>0 表示上一页最后一条的 sortTime
    commentCursor: 0,
    // 评论是否还有更多
    commentHasMore: true,
    // 评论输入内容
    commentText: '',
    // 当前回复对象（评论对象）
    replyingTo: null,
    // 回复提示文案
    replyHint: '',
    // 是否正在加载帖子
    loading: true,
    // 是否加载失败（P0-4：失败时展示错误占位 + 重试，避免永久空白页）
    loadError: false,
    // 加载失败提示文案
    loadErrorText: '',
    // 是否正在加载评论
    commentLoading: false,
    // 是否正在提交评论
    submittingComment: false,
    // 评论输入框是否聚焦（回复时自动聚焦）
    commentFocus: false,
    // 板块展示中文名（彩色标签用）
    sectionName: '',
    // 板块标签底色
    sectionColor: '#9CA3AF',
    // 是否置顶
    isTop: false,
    // 是否加精
    isEssence: false
  },

  /**
   * 页面加载
   * 获取 postId，加载帖子与评论
   * 封禁用户拦截：防止通过消息页、分享链接等 URL 直接进入
   */
  onLoad(options) {
    // 兼容 postId 和 id 两种参数名（消息页跳转用 id，首页跳转用 postId）
    const postId = options.postId || options.id || ''
    this.setData({ postId })

    // ---- 封禁用户拦截：第二道防线，防止通过 URL 直接进入 ----
    if (userStore.isBanned()) {
      this.setData({ loading: false })
      wx.showToast({ title: '账号已被封禁，无法查看内容', icon: 'none' })
      setTimeout(() => { wx.navigateBack() }, 1500)
      return
    }

    if (postId) {
      this.loadPost()
      this.loadComments(true)
    } else {
      this.setData({ loading: false })
      wx.showToast({ title: '帖子不存在', icon: 'none' })
    }

    // 监听用户资料更新（昵称/头像修改后刷新帖子和评论的作者信息）
    this._offProfileUpdate = eventBus.on('profileUpdated', () => {
      this.loadPost()
      this.loadComments(true)
    })
  },

  onUnload() {
    if (typeof this._offProfileUpdate === 'function') {
      this._offProfileUpdate()
      this._offProfileUpdate = null
    }
  },

  /**
   * 加载帖子详情
   */
  loadPost() {
    this.setData({ loading: true })
    api.post.detail(this.data.postId)
      .then((res) => {
        const post = (res && res.data) || null
        if (!post) {
          this.setData({ loading: false })
          wx.showToast({ title: '帖子不存在', icon: 'none' })
          return
        }
        // 兜底重定向：业务模块帖子（失物招领）跳转到对应详情页
        // 防止遗漏入口导致用户看到空白的帖子详情页
        // 跑腿模块已下架，不再有 delivery 分支
        const refType = post.refType || ''
        const refId = post.refId || ''
        if (refType && refId) {
          let redirectUrl = ''
          if (refType === 'lostfound') redirectUrl = `/pages/lostfound/detail/index?id=${refId}`
          if (redirectUrl) {
            this.setData({ loading: false })
            wx.redirectTo({ url: redirectUrl })
            return
          }
        }
        // 正文暂用纯文本节点渲染（后续接入 markdown.parse）
        const contentNodes = post.content
          ? [{ type: 'text', text: post.content }]
          : []
        // 云函数返回统计在 post.stats 对象中
        const stats = post.stats || {}
        // 板块展示元数据：优先用接口返回的 sectionName，否则用公共映射兜底
        const sectionMeta = getSectionMeta(post.section)
        // 净化帖子作者头像：防止 wxfile:// 临时路径导致加载失败
        if (post.author && post.author.avatar) {
          post.author.avatar = sanitizeImageUrl(post.author.avatar, DEFAULT_AVATAR)
        }

        this.setData({
          post,
          contentNodes,
          timeText: formatTime(post.createdAt || post.createTime),
          likeText: formatNumber(stats.likes || 0),
          commentCountText: formatNumber(stats.comments || 0),
          sectionName: post.sectionName || sectionMeta.name,
          sectionColor: sectionMeta.color,
          isTop: !!post.isTop,
          isEssence: !!post.isEssence,
          // P0-6：优先使用服务端返回的 liked 字段，减少一次 API 调用
          liked: typeof post.liked === 'boolean' ? post.liked : false,
          loading: false,
          loadError: false
        })
        // 拉取收藏状态（点赞状态已由服务端直接返回）
        // 若服务端未返回 liked 字段，降级调用 batchCheck
        this.checkLikeAndFavorite()
      })
      .catch((err) => {
        console.error('[detail] 加载帖子失败:', err)
        // 区分错误类型给出明确提示
        const code = err && err.code
        const msg = err && err.message
        if (code === 3001 || (msg && msg.indexOf('不存在') !== -1)) {
          // 帖子不存在/已删除：提示后返回上一页，不提供重试（重试无意义）
          this.setData({ loading: false })
          wx.showToast({ title: '帖子不存在或已被删除', icon: 'none' })
          // 延迟返回上一页
          setTimeout(() => { wx.navigateBack() }, 1500)
        } else {
          // P0-4：网络/服务异常时进入错误态，提供「重新加载」，避免永久空白页
          this.setData({
            loading: false,
            loadError: true,
            loadErrorText: msg || '加载失败，请检查网络后重试'
          })
        }
      })
  },

  /**
   * 重新加载帖子与评论（P0-4 错误态重试入口）
   */
  onRetry() {
    this.setData({ loadError: false, loadErrorText: '' })
    this.loadPost()
    this.loadComments(true)
  },

  /**
   * 检查当前用户对帖子的点赞 / 收藏状态
   * P0-6 优化：服务端已返回 liked 字段时跳过 batchCheck 调用
   */
  checkLikeAndFavorite() {
    // 仅在服务端未返回 liked 字段时降级调用 batchCheck
    const post = this.data.post
    if (post && typeof post.liked !== 'boolean') {
      api.like.batchCheck([this.data.postId], 'post')
        .then((res) => {
          // 云函数返回 { likedIds: ['id1', ...] }，判断当前帖子是否已赞
          const likedIds = (res && res.data && res.data.likedIds) || []
          this.setData({ liked: likedIds.indexOf(this.data.postId) !== -1 })
        })
        .catch(() => {})
    }

    api.favorite.check(this.data.postId)
      .then((res) => {
        const data = (res && res.data) || {}
        this.setData({ favorited: !!data.favorited })
      })
      .catch(() => {})
  },

  /**
   * 加载评论列表（游标分页 + 请求竞态保护）
   * @param {boolean} reset 是否重置到第一页
   */
  loadComments(reset = false) {
    if (this.data.commentLoading) return

    const cursor = reset ? 0 : this.data.commentCursor

    // 请求序列号：防止快速操作时旧请求覆盖新结果
    const seq = (this._commentSeq || 0) + 1
    this._commentSeq = seq

    this.setData({
      commentLoading: true,
      commentCursor: cursor,
      commentHasMore: reset ? true : this.data.commentHasMore
    })

    // 使用游标分页参数调用评论列表接口
    api.comment.list(this.data.postId, { cursor, pageSize: 20 })
      .then((res) => {
        // 序列号校验：丢弃过期请求结果
        if (seq !== this._commentSeq) return

        const data = (res && res.data) || {}
        const list = data.list || data.comments || []
        const nextCursor = data.nextCursor || 0
        const merged = reset ? list : this.data.comments.concat(list)
        // 净化评论作者头像：防止 wxfile:// 临时路径导致加载失败
        merged.forEach(c => {
          if (c.author && c.author.avatar) {
            c.author.avatar = sanitizeImageUrl(c.author.avatar, DEFAULT_AVATAR)
          }
        })

        this.setData({
          comments: merged,
          // 使用服务端返回的 hasMore 标志，比 merged.length < total 更可靠
          commentHasMore: data.hasMore || false,
          commentCursor: nextCursor,
          commentCountText: formatNumber(this.data.post ? ((this.data.post.stats && this.data.post.stats.comments) || merged.length) : merged.length)
        })

        // 拉取评论的点赞状态
        if (list.length) {
          this.checkCommentLiked(list)
        }
      })
      .catch((err) => {
        if (seq !== this._commentSeq) return
        console.error('[detail] 加载评论失败:', err)
      })
      .then(() => {
        if (seq !== this._commentSeq) return
        this.setData({ commentLoading: false })
      })
  },

  /**
   * 批量检查评论点赞状态
   */
  checkCommentLiked(list) {
    const ids = list.map(c => c._id)
    api.like.batchCheck(ids, 'comment')
      .then((res) => {
        // 云函数返回 { likedIds: ['id1', ...] }，转为集合便于查找
        const likedIds = (res && res.data && res.data.likedIds) || []
        const likedSet = {}
        likedIds.forEach((id) => { likedSet[id] = true })
        // 把 liked 状态合并进评论对象
        const comments = this.data.comments.map(c => {
          return Object.assign({}, c, { _liked: !!likedSet[c._id] })
        })
        this.setData({ comments })
      })
      .catch(() => {})
  },

  /**
   * 点击帖子点赞
   * 乐观更新 + 防抖：请求进行中时忽略后续点击
   */
  onTapLike() {
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    // 封禁用户不可点赞
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法点赞', icon: 'none' })
      return
    }
    // 防抖：点赞请求进行中时忽略
    if (this._likePending) return

    const liked = this.data.liked
    // 从 post.stats.likes 获取当前点赞数
    const stats = (this.data.post && this.data.post.stats) || {}
    const currentLikes = stats.likes || 0
    // 乐观更新
    this.setData({
      liked: !liked,
      likeText: formatNumber(Math.max(0, currentLikes + (liked ? -1 : 1)))
    })

    this._likePending = true
    api.like.toggle(this.data.postId, 'post')
      .then(() => {
        // 同步 post.stats.likes，避免连续 toggle 时基于过时快照导致计数累积错误
        const newLikes = Math.max(0, currentLikes + (liked ? -1 : 1))
        const post = Object.assign({}, this.data.post)
        const statsNew = Object.assign({}, post.stats || {})
        statsNew.likes = newLikes
        post.stats = statsNew
        this.setData({ post, likeText: formatNumber(newLikes) })
        // 通知首页刷新点赞数据
        eventBus.emit('refreshFeed')
      })
      .catch((err) => {
        console.error('[detail] 点赞失败:', err)
        // 回滚
        this.setData({
          liked: liked,
          likeText: formatNumber(currentLikes)
        })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._likePending = false
      })
  },

  /**
   * 点击收藏
   * 乐观更新 + 防抖：请求进行中时忽略后续点击
   */
  onTapFavorite() {
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    // 封禁用户不可收藏
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法收藏', icon: 'none' })
      return
    }
    // 防抖：收藏请求进行中时忽略
    if (this._favPending) return

    const favorited = this.data.favorited
    this.setData({ favorited: !favorited })

    this._favPending = true
    api.favorite.toggle(this.data.postId)
      .then(() => {
        // 通知「我的」页刷新收藏统计（此前无任何事件，
        // 而「我的」页聚合统计受 30 秒节流保护 → 返回后仍显示旧值，出现「列表有、统计 0」）
        eventBus.emit('favoritesChanged')
      })
      .catch((err) => {
        console.error('[detail] 收藏失败:', err)
        this.setData({ favorited: favorited })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._favPending = false
      })
  },

  /**
   * 评论输入
   */
  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  /**
   * 提交评论
   */
  onSubmitComment() {
    if (this.data.submittingComment) return
    const content = this.data.commentText.trim()
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    // 封禁/禁言用户不可评论
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法评论', icon: 'none' })
      return
    }
    if (userStore.isMuted()) {
      wx.showToast({ title: '账号已被禁言，无法评论', icon: 'none' })
      return
    }

    this.setData({ submittingComment: true })

    const replyingTo = this.data.replyingTo
    // replyTo 为 object { userId, nickname }，符合云函数 schema 要求
    // userId 取服务端返回的 author.userId（users._id），openid 不再下发
    const replyTo = replyingTo ? {
      userId: (replyingTo.author && replyingTo.author.userId) || '',
      nickname: replyingTo.author.nickname || replyingTo.author.nickName || ''
    } : null
    // 生成客户端幂等键：防止弱网重试导致重复评论
    const clientId = 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8)
    api.comment.create(
      this.data.postId,
      content,
      replyingTo ? replyingTo._id : '',
      replyTo,
      clientId
    )
      .then(() => {
        wx.showToast({ title: '评论成功', icon: 'success' })
        // 通知首页刷新评论数据
        eventBus.emit('refreshFeed')
        // 清空输入与回复态
        this.setData({
          commentText: '',
          replyingTo: null,
          replyHint: '',
          commentFocus: false
        })
        // 刷新评论列表
        this.loadComments(true)
        // 帖子评论数 +1（更新 post.stats.comments）
        if (this.data.post) {
          const post = Object.assign({}, this.data.post)
          const stats = Object.assign({}, post.stats || {})
          stats.comments = (stats.comments || 0) + 1
          post.stats = stats
          this.setData({
            post,
            commentCountText: formatNumber(stats.comments)
          })
        }
      })
      .catch((err) => {
        console.error('[detail] 评论失败:', err)
        // 弱网友好提示：区分超时和其他错误
        const msg = (err && err.message && err.message.indexOf('超时') !== -1)
          ? '网络超时，请检查网络后重试'
          : (err && err.message) || '评论失败'
        wx.showToast({ title: msg, icon: 'none' })
      })
      .then(() => {
        this.setData({ submittingComment: false })
      })
  },

  /**
   * 点击回复评论
   */
  onTapReply(e) {
    const { comment } = e.detail
    this.setData({
      replyingTo: comment,
      replyHint: '回复 @' + (comment.author.nickname || comment.author.nickName || '用户'),
      commentFocus: true
    })
  },

  /**
   * 点击评论点赞
   * 防抖 + 完整回滚：请求进行中忽略；失败时同时恢复 _liked 与 likeCount
   */
  onTapCommentLike(e) {
    if (!isLoggedIn()) {
      wx.navigateTo({ url: '/pages/user/login/index' })
      return
    }
    // 封禁用户不可点赞
    if (userStore.isBanned()) {
      wx.showToast({ title: '账号已被封禁，无法点赞', icon: 'none' })
      return
    }
    const { commentId } = e.detail
    // 防抖：同一评论点赞请求进行中时忽略
    this._commentLikePending = this._commentLikePending || {}
    if (this._commentLikePending[commentId]) return

    // 记录回滚快照
    const target = this.data.comments.find(c => c._id === commentId)
    if (!target) return
    const prevLiked = !!target._liked
    const prevLikeCount = target.likeCount || 0

    // 乐观更新
    const comments = this.data.comments.map(c => {
      if (c._id === commentId) {
        const next = Object.assign({}, c)
        next._liked = !next._liked
        next.likeCount = Math.max(0, (next.likeCount || 0) + (next._liked ? 1 : -1))
        return next
      }
      return c
    })
    this.setData({ comments })

    this._commentLikePending[commentId] = true
    api.like.toggle(commentId, 'comment')
      .then(() => {
        // 通知首页刷新（评论点赞数变化）
        eventBus.emit('refreshFeed')
      })
      .catch((err) => {
        console.error('[detail] 评论点赞失败:', err)
        // 完整回滚：同时恢复 _liked 与 likeCount，避免计数永久错乱
        const rollback = this.data.comments.map(c => {
          if (c._id === commentId) {
            const next = Object.assign({}, c)
            next._liked = prevLiked
            next.likeCount = prevLikeCount
            return next
          }
          return c
        })
        this.setData({ comments: rollback })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => {
        this._commentLikePending[commentId] = false
      })
  },

  /**
   * 编辑帖子（仅作者本人可见入口）
   * 跳转发布页并进入编辑模式，回显原帖内容
   */
  onEditPost() {
    if (!this.data.post || !this.data.post._id) return
    wx.navigateTo({ url: `/pages/post/publish/index?postId=${this.data.post._id}` })
  },

  /**
   * 删除评论
   */
  onDeleteComment(e) {
    const { commentId } = e.detail
    wx.showModal({
      title: '提示',
      content: '确定删除这条评论吗？',
      success: (res) => {
        if (!res.confirm) return
        api.comment.delete(commentId)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            // 通知首页刷新评论数
            eventBus.emit('refreshFeed')
            // 从列表移除
            const comments = this.data.comments.filter(c => c._id !== commentId)
            this.setData({ comments })
            // 帖子评论数 -1（更新 post.stats.comments）
            if (this.data.post) {
              const post = Object.assign({}, this.data.post)
              const stats = Object.assign({}, post.stats || {})
              stats.comments = Math.max(0, (stats.comments || 0) - 1)
              post.stats = stats
              this.setData({
                post,
                commentCountText: formatNumber(stats.comments)
              })
            }
          })
          .catch((err) => {
            console.error('[detail] 删除评论失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          })
      }
    })
  },

  /**
   * 点击帖子图片预览
   */
  onTapImage(e) {
    const { src } = e.currentTarget.dataset
    const urls = (this.data.post && this.data.post.images) || []
    wx.previewImage({
      current: src,
      urls
    })
  },

  /**
   * 点击作者头像，跳转该用户的帖子列表页
   */
  onTapAuthor() {
    // 匿名帖子不允许跳转到作者主页（保护匿名身份）
    if (this.data.post.isAnonymous && !(this.data.post.author && this.data.post.author.isOwner)) {
      wx.showToast({ title: '该用户已匿名，无法查看主页', icon: 'none' })
      return
    }
    const authorId = (this.data.post.author && this.data.post.author.userId) || ''
    if (authorId) {
      wx.navigateTo({ url: `/pages/user/posts/index?userId=${authorId}` })
    } else {
      wx.showToast({ title: '无法获取作者信息', icon: 'none' })
    }
  },

  /**
   * 点击举报，跳转举报提交页
   */
  onReport() {
    const postId = this.data.postId
    wx.navigateTo({ url: `/pages/report/submit/index?targetType=post&targetId=${postId}` })
  },

  /**
   * 加载更多评论（游标分页）
   */
  onLoadMoreComments() {
    if (!this.data.commentHasMore || this.data.commentLoading) return
    this.loadComments(false)
  },

  /**
   * 分享
   */
  onShareAppMessage() {
    const post = this.data.post || {}
    return {
      title: post.title || '临里校园',
      path: `/pages/post/detail/index?postId=${this.data.postId}`
    }
  }
})
