// components/post-card/post-card.js
// 帖子卡片组件
// 信息流与收藏列表的统一帖子展示单元
// 通过属性接收帖子数据与点赞状态，向父组件派发 tap / liketap 事件

const { formatListTime } = require('../../utils/format')
const { formatNumber } = require('../../utils/format')
const { sanitizeImageUrl } = require('../../utils/format')
// 板块展示元数据统一来自公共常量，避免多处硬编码导致不一致
const { getSectionMeta } = require('../../utils/shared/constants')

// 默认头像（作者头像为空 / 临时路径时占位）
const DEFAULT_AVATAR = '/images/icons/user.png'

// 正文摘要最大字符数
// Skyline 渲染模式不支持 CSS line-clamp，正文截断必须在 JS 层完成
// 否则长帖正文会全部展开，导致卡片在信息流中过高
const MAX_CONTENT_CHARS = 70        // 纯文字 / 多图场景：约 3 行
const MAX_CONTENT_INLINE_CHARS = 45 // 单图场景：文字区更窄，约 3 行

/**
 * 截断正文摘要
 * 1. 统一换行符，压缩 3+ 连续换行为 2 个，避免超大空行撑高卡片
 * 2. 超过最大字符数则截断并追加「…全文」提示，引导用户点进详情
 * @param {string} content 原始正文
 * @param {number} max 最大字符数
 * @returns {string} 截断后的展示文本
 */
function truncateContent(content, max) {
  if (!content) return ''
  let text = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  if (text.length <= max) return text
  return text.slice(0, max) + '…全文'
}

Component({
  /**
   * 组件属性
   */
  properties: {
    // 帖子对象
    post: {
      type: Object,
      value: {}
    },
    // 是否已点赞
    liked: {
      type: Boolean,
      value: false
    }
  },

  /**
   * 组件初始数据
   */
  data: {
    // 格式化后的相对时间
    timeText: '',
    // 格式化后的点赞数
    likeText: '0',
    // 格式化后的评论数
    commentText: '0',
    // 板块中文名称
    sectionName: '',
    // 板块标签颜色
    sectionColor: '#9CA3AF',
    // 板块标签底色
    sectionBgColor: '#F5F5F5',
    // 格式化后的价格（如 ¥99.00）
    priceText: '',
    // 是否已售
    isSold: false,
    // 是否置顶
    isTop: false,
    // 是否加精
    isEssence: false,
    // 截断后的正文摘要（纯文字 / 多图场景）
    displayContent: '',
    // 截断后的正文摘要（单图场景，文字区更窄，阈值更小）
    displayContentInline: ''
  },

  observers: {
    /**
     * 帖子对象变化时，预格式化展示字段
     * 兼容 stats.likes / likeCount 两种字段命名
     */
    'post'(post) {
      if (!post) return
      const stats = post.stats || {}
      const likeCount = stats.likes !== undefined ? stats.likes : (post.likeCount || 0)
      const commentCount = stats.comments !== undefined ? stats.comments : (post.commentCount || 0)
      // 板块标签：优先用接口返回的 sectionName，否则用公共映射兜底
      const sectionMeta = getSectionMeta(post.section)
      const sectionName = post.sectionName || sectionMeta.name
      const sectionColor = sectionMeta.color
      const sectionBgColor = sectionMeta.bgColor || '#F5F5F5'
      // 二手交易价格格式化
      const trade = post.tradeInfo
      const priceText = trade && trade.price !== undefined ? '¥' + Number(trade.price).toFixed(2) : ''
      const isSold = !!(trade && trade.isSold)
      // 净化作者头像：防止 wxfile:// 临时路径导致图片加载失败
      // 不直接修改 props（违反单向数据流），存入组件 data 中
      const authorAvatar = (post.author && post.author.avatar)
        ? sanitizeImageUrl(post.author.avatar, DEFAULT_AVATAR)
        : DEFAULT_AVATAR
      this.setData({
        timeText: formatListTime(post.createdAt || post.createTime),
        likeText: formatNumber(likeCount),
        commentText: formatNumber(commentCount),
        sectionName,
        sectionColor,
        sectionBgColor,
        priceText,
        isSold,
        isTop: !!post.isTop,
        isEssence: !!post.isEssence,
        authorAvatar,
        // 正文摘要：Skyline 不支持 line-clamp，此处 JS 层截断保证卡片不会过高
        displayContent: truncateContent(post.content, MAX_CONTENT_CHARS),
        displayContentInline: truncateContent(post.content, MAX_CONTENT_INLINE_CHARS)
      })
    }
  },

  methods: {
    /**
     * 点击卡片，派发 tap 事件
     * 携带 refType / refId 供父组件做路由分发（失物招领跳各自详情页）
     */
    onTapCard() {
      const post = this.data.post || {}
      // 使用 cardtap 而非 tap，避免与原生 tap 事件名冲突导致 Skyline 下事件丢失
      this.triggerEvent('cardtap', {
        postId: post._id,
        refType: post.refType || '',
        refId: post.refId || ''
      })
    },

    /**
     * 点击点赞按钮（catch 阻止冒泡，避免触发卡片点击）
     */
    onTapLike() {
      this.triggerEvent('liketap', { postId: this.data.post._id })
    }
  }
})
