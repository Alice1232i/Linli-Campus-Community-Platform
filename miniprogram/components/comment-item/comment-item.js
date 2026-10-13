// components/comment-item/comment-item.js
// 评论项组件
// 帖子详情页评论列表的单条评论展示
// 通过属性接收评论对象与点赞状态，向父组件派发 reply / liketap / delete 事件

const { formatTime } = require('../../utils/format')
const { formatNumber } = require('../../utils/format')
const { sanitizeImageUrl } = require('../../utils/format')

// 默认头像（评论作者头像为空 / 临时路径时占位）
const DEFAULT_AVATAR = '/images/icons/user.png'

Component({
  /**
   * 组件属性
   */
  properties: {
    // 评论对象
    comment: {
      type: Object,
      value: {}
    },
    // 是否已点赞
    liked: {
      type: Boolean,
      value: false
    },
    // 是否为当前用户评论（用于显示删除按钮）
    isOwner: {
      type: Boolean,
      value: false
    }
  },

  /**
   * 组件初始数据
   */
  data: {
    timeText: '',
    likeText: '0'
  },

  observers: {
    /**
     * 评论对象变化时预格式化展示字段
     */
    'comment'(comment) {
      if (!comment) return
      // 净化评论作者头像：防止 wxfile:// 临时路径导致加载失败
      if (comment.author && comment.author.avatar) {
        comment.author.avatar = sanitizeImageUrl(comment.author.avatar, DEFAULT_AVATAR)
      }
      this.setData({
        timeText: formatTime(comment.createdAt || comment.createTime),
        likeText: formatNumber(comment.likeCount || 0)
      })
    }
  },

  methods: {
    /**
     * 点击回复
     */
    onTapReply() {
      this.triggerEvent('reply', { comment: this.data.comment })
    },

    /**
     * 点击点赞
     */
    onTapLike() {
      this.triggerEvent('liketap', { commentId: this.data.comment._id })
    },

    /**
     * 点击删除
     */
    onTapDelete() {
      this.triggerEvent('delete', { commentId: this.data.comment._id })
    }
  }
})
