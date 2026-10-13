/**
 * 临里校园 - 字段校验规则与校验函数（前端与云函数共用）
 * ------------------------------------------------------------
 * 为每个云函数 action 定义参数校验 schema，配合 shared/guard.js 使用。
 *
 * schema 规则对象格式：
 *   {
 *     字段名: {
 *       type: 'string' | 'number' | 'array' | 'object' | 'boolean',
 *       required: true | false,        // 是否必填
 *       max: number,                   // number 类型最大值
 *       min: number,                   // number 类型最小值 / string、array 最小长度
 *       maxLength: number              // string、array 最大长度
 *     }
 *   }
 *
 * 使用方式：
 *   const { SCHEMAS, validate } = require('./shared/schema')
 *   const result = validate(event, SCHEMAS['post.create'])
 *   if (!result.valid) return fail(ERRORS.PARAM_INVALID, result.message)
 */

/**
 * 各云函数 action 的参数校验 schema 集合
 * key 格式为 "<云函数名>.<action名>"
 */
const SCHEMAS = {
  // 注意：承载「确定性长 ID」的字段（commentId / parentId / targetId / notificationId / reportId）
  // 上限取 256，而非 64。本项目这些 ID 很长：评论 _id 约 115、通知 _id 约 125、reportId 约 151 字符，
  // 上限 64 会把「评论点赞 / 回复评论 / 删除评论 / 举报（评论）/ 标记通知已读」拦在参数校验层。
  // postId(≈53) / userId(≈33) / openid(28) / clientId 等仍保持 64 —— 它们不是长 ID。
  // ---------------- 社区帖子 ----------------
  'post.create': {
    module: { type: 'string', required: false, maxLength: 20 }, // 业务模块，默认 community
    section: { type: 'string', required: true, maxLength: 20 }, // 板块标识
    title: { type: 'string', required: false, maxLength: 100 }, // 帖子标题（可选）
    content: { type: 'string', required: true, min: 1, maxLength: 2000 }, // 帖子正文
    images: { type: 'array', required: false, maxLength: 9 }, // 图片列表（最多9张）
    tags: { type: 'array', required: false, maxLength: 10 }, // 标签列表（可选）
    type: { type: 'string', required: false, maxLength: 10 }, // 帖子类型：image / text
    location: { type: 'string', required: false, maxLength: 50 }, // 位置信息（可选）
    clientId: { type: 'string', required: false, maxLength: 64 } // 幂等键：客户端生成的唯一ID，防止重复提交
  },
  'post.feed': {
    module: { type: 'string', required: false, maxLength: 20 }, // 业务模块筛选（可选）
    section: { type: 'string', required: false, maxLength: 20 }, // 板块筛选（可选）
    page: { type: 'number', required: false, min: 1 }, // 页码，默认1（兼容旧客户端）
    pageSize: { type: 'number', required: false, min: 1, max: 50 }, // 每页数量，上限50
    cursor: { type: 'number', required: false, min: 0 }, // 游标：上一页最后一条帖子的 sortTime，首次请求不传
    sort: { type: 'string', required: false, maxLength: 20 } // 排序模式：recommend / latest / hot
  },
  'post.detail': {
    postId: { type: 'string', required: true, maxLength: 64 } // 帖子ID
  },
  'post.delete': {
    postId: { type: 'string', required: true, maxLength: 64 } // 帖子ID
  },
  'post.update': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 帖子ID
    title: { type: 'string', required: false, maxLength: 100 }, // 标题（可选）
    content: { type: 'string', required: true, min: 1, maxLength: 2000 }, // 正文
    images: { type: 'array', required: false, maxLength: 9 }, // 图片列表（最多9张）
    tags: { type: 'array', required: false, maxLength: 10 }, // 标签列表（可选）
    location: { type: 'string', required: false, maxLength: 50 } // 位置信息（可选）
  },
  'post.myPosts': {
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },
  'post.userPosts': {
    userId: { type: 'string', required: true, maxLength: 64 }, // 目标用户ID
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },
  'post.search': {
    keyword: { type: 'string', required: true, min: 1, maxLength: 50 }, // 搜索关键词
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },

  // ---------------- 评论 ----------------
  'comment.create': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 所属帖子ID
    content: { type: 'string', required: true, min: 1, maxLength: 500 }, // 评论内容
    parentId: { type: 'string', required: false, maxLength: 256 }, // 父评论ID（可选，用于楼中楼）
    replyTo: { type: 'object', required: false } // 被回复用户信息 { userId, nickname }（可选）
  },
  'comment.list': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 帖子ID
    page: { type: 'number', required: false, min: 1 }, // 页码，默认1（兼容旧客户端）
    pageSize: { type: 'number', required: false, min: 1, max: 50 }, // 每页数量，上限50
    cursor: { type: 'number', required: false, min: 0 } // 游标：上一页最后一条评论的 createdAt，首次请求不传
  },
  'comment.delete': {
    commentId: { type: 'string', required: true, maxLength: 256 } // 评论ID
  },

  // ---------------- 点赞 ----------------
  'like.toggle': {
    targetType: { type: 'string', required: true, maxLength: 20 }, // 目标类型：post / comment
    targetId: { type: 'string', required: true, maxLength: 256 } // 目标ID
  },
  'like.batchCheck': {
    targetIds: { type: 'array', required: true, maxLength: 50 }, // 目标ID列表
    targetType: { type: 'string', required: true, maxLength: 20 } // 目标类型
  },

  // ---------------- 收藏 ----------------
  'favorite.toggle': {
    postId: { type: 'string', required: true, maxLength: 64 } // 帖子ID
  },
  'favorite.check': {
    postId: { type: 'string', required: true, maxLength: 64 } // 帖子ID
  },
  'favorite.list': {
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },

  // ---------------- 拉黑 ----------------
  'block.block': {
    targetOpenid: { type: 'string', required: true, maxLength: 64 } // 被拉黑用户openid
  },
  'block.unblock': {
    targetOpenid: { type: 'string', required: true, maxLength: 64 } // 被取消拉黑用户openid
  },
  'block.list': {
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },

  // ---------------- 举报 ----------------
  'report.submit': {
    targetType: { type: 'string', required: true, maxLength: 20 }, // 举报目标类型：post/comment/user/message/lostfound/delivery
    targetId: { type: 'string', required: true, maxLength: 256 }, // 举报目标ID
    reason: { type: 'string', required: true, maxLength: 20 }, // 举报原因：spam/abuse/porn/fraud/privacy/other
    detail: { type: 'string', required: false, maxLength: 500 }, // 补充说明（可选）
    evidence: { type: 'array', required: false, maxLength: 9 } // 证据文件 fileID 列表（可选，最多9个）
  },

  // ---------------- 意见箱 ----------------
  'feedback.submit': {
    type: { type: 'string', required: false, maxLength: 20 }, // 反馈类型：suggestion 建议 / bug 问题 / other 其他
    content: { type: 'string', required: true, min: 5, maxLength: 500 }, // 反馈内容
    contact: { type: 'string', required: false, maxLength: 50 }, // 联系方式（选填，手机号/微信号）
    appVersion: { type: 'string', required: false, maxLength: 20 } // 小程序版本号（便于定位测试版本）
  },
  'feedback.listMine': {
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },

  // ---------------- 聊天 ----------------
  'chat.createConversation': {
    targetOpenid: { type: 'string', required: true, maxLength: 64 } // 目标用户openid
  },
  'chat.sendMessage': {
    conversationId: { type: 'string', required: true, maxLength: 64 }, // 会话ID
    type: { type: 'string', required: true, maxLength: 10 }, // 消息类型：text / image
    content: { type: 'string', required: true, min: 1, maxLength: 1000 } // 消息内容（text 为文本，image 为图片 fileID）
  },
  'chat.listConversations': {
    page: { type: 'number', required: false, min: 1 }, // 页码，默认1
    pageSize: { type: 'number', required: false, min: 1, max: 50 } // 每页数量，默认20
  },
  'chat.listMessages': {
    conversationId: { type: 'string', required: true, maxLength: 64 }, // 会话ID
    page: { type: 'number', required: false, min: 1 }, // 页码，默认1
    pageSize: { type: 'number', required: false, min: 1, max: 100 } // 每页数量，默认50
  },
  'chat.markRead': {
    conversationId: { type: 'string', required: true, maxLength: 64 } // 会话ID
  },
  'chat.deleteConversation': {
    conversationId: { type: 'string', required: true, maxLength: 64 } // 会话ID
  },

  // ---------------- 运营管理 ----------------
  'moderation.setTop': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 帖子ID
    expire: { type: 'number', required: false, min: 0 } // 置顶过期时间戳（可选，默认7天后）
  },
  'moderation.setEssence': {
    postId: { type: 'string', required: true, maxLength: 64 } // 帖子ID
  },
  'moderation.hidePost': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 帖子ID
    reason: { type: 'string', required: false, maxLength: 200 } // 隐藏原因（可选）
  },
  'moderation.deletePost': {
    postId: { type: 'string', required: true, maxLength: 64 }, // 帖子ID
    reason: { type: 'string', required: false, maxLength: 200 } // 删除原因（可选）
  },
  'moderation.banUser': {
    openid: { type: 'string', required: true, maxLength: 64 }, // 目标用户openid
    reason: { type: 'string', required: false, maxLength: 200 } // 封禁原因（可选）
  },
  'moderation.muteUser': {
    openid: { type: 'string', required: true, maxLength: 64 }, // 目标用户openid
    reason: { type: 'string', required: false, maxLength: 200 } // 禁言原因（可选）
  },
  'moderation.listReports': {
    status: { type: 'string', required: false, maxLength: 20 }, // 举报状态筛选（可选，默认pending）
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },
  'moderation.resolveReport': {
    reportId: { type: 'string', required: true, maxLength: 256 }, // 举报记录ID
    result: { type: 'string', required: true, min: 1, maxLength: 500 } // 处理结果说明
  },

  // ---------------- 跑腿代拿 ----------------
  'delivery.create': {
    type: { type: 'string', required: true, maxLength: 20 }, // 任务类型：errand / food_delivery / parcel
    title: { type: 'string', required: true, min: 1, maxLength: 50 }, // 任务标题
    desc: { type: 'string', required: true, min: 1, maxLength: 500 }, // 任务描述
    pickup: { type: 'object', required: true }, // 取件地点 { location, lat, lng }
    drop: { type: 'object', required: true }, // 送达地点 { location, lat, lng }
    reward: { type: 'number', required: true, min: 0 }, // 跑腿报酬（元）
    deadline: { type: 'number', required: true, min: 0 } // 截止时间戳
  },
  'delivery.list': {
    type: { type: 'string', required: false, maxLength: 20 }, // 任务类型筛选（可选）
    page: { type: 'number', required: false, min: 1 }, // 页码，默认1
    pageSize: { type: 'number', required: false, min: 1, max: 50 } // 每页数量，默认20
  },
  'delivery.detail': {
    taskId: { type: 'string', required: true, maxLength: 64 } // 任务ID
  },
  'delivery.accept': {
    taskId: { type: 'string', required: true, maxLength: 64 } // 任务ID
  },
  'delivery.startDelivering': {
    taskId: { type: 'string', required: true, maxLength: 64 } // 任务ID
  },
  'delivery.complete': {
    taskId: { type: 'string', required: true, maxLength: 64 } // 任务ID
  },
  'delivery.cancel': {
    taskId: { type: 'string', required: true, maxLength: 64 } // 任务ID
  },

  // ---------------- 失物招领 ----------------
  'lostfound.create': {
    kind: { type: 'string', required: true, maxLength: 10 }, // 类型：lost / found
    itemName: { type: 'string', required: true, min: 1, maxLength: 50 }, // 物品名称
    category: { type: 'string', required: false, maxLength: 20 }, // 物品分类（可选）
    images: { type: 'array', required: false, maxLength: 9 }, // 图片列表（可选，最多9张）
    location: { type: 'string', required: false, maxLength: 100 }, // 地点名称（可选）
    latitude: { type: 'number', required: false, min: -90, max: 90 }, // 纬度（可选，地图定位）
    longitude: { type: 'number', required: false, min: -180, max: 180 }, // 经度（可选，地图定位）
    eventTime: { type: 'number', required: false, min: 0 }, // 事件发生时间戳（可选）
    description: { type: 'string', required: true, min: 1, maxLength: 500 }, // 详细描述
    contact: { type: 'string', required: false, maxLength: 50 } // 联系方式（可选，加密存储）
  },
  'lostfound.list': {
    kind: { type: 'string', required: true, maxLength: 10 }, // 类型：lost / found
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },
  'lostfound.detail': {
    id: { type: 'string', required: true, maxLength: 64 } // 招领记录ID
  },
  'lostfound.close': {
    id: { type: 'string', required: true, maxLength: 64 } // 招领记录ID
  },

  // ---------------- 学生认证 ----------------
  'verify.sendCode': {
    email: { type: 'string', required: true, maxLength: 50 } // 校园邮箱
  },
  'verify.submit': {
    email: { type: 'string', required: true, maxLength: 50 }, // 校园邮箱
    code: { type: 'string', required: true, min: 6, maxLength: 6 } // 验证码（服务端固定发 6 位）
  },

  // ---------------- 通知 ----------------
  'notify.list': {
    type: { type: 'string', required: false, maxLength: 20 }, // 通知类型筛选（可选）
    page: { type: 'number', required: false, min: 1 } // 页码，默认1
  },
  'notify.unread': {}, // 无参数，查询当前用户未读数
  'notify.markRead': {
    notificationId: { type: 'string', required: true, maxLength: 256 } // 通知ID
  },
  'notify.markAllRead': {}, // 无参数，标记全部已读
  'notify.delete': {
    notificationId: { type: 'string', required: true, maxLength: 256 } // 通知ID
  },
  'notify.clearAll': {
    type: { type: 'string', required: false, maxLength: 20 } // 通知类型筛选（可选，不传则清空全部）
  },

  // ---------------- 全局配置 ----------------
  'common.getConfig': {
    key: { type: 'string', required: false, maxLength: 50 } // 配置键（可选，默认返回全部）
  },
  'common.sections': {}, // 无参数，获取板块列表

  // ---------------- 用户资料 ----------------
  'user.updateProfile': {
    nickname: { type: 'string', required: false, min: 1, maxLength: 20 }, // 昵称（可选）
    avatar: { type: 'string', required: false, maxLength: 500 }, // 头像URL（可选）
    bio: { type: 'string', required: false, maxLength: 100 } // 个人简介（可选）
  }
}

/**
 * 判断值的类型是否符合规则
 * @param {*} value 待校验值
 * @param {string} type 期望类型
 * @returns {boolean}
 */
function checkType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !isNaN(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      // 未指定类型时不做类型校验
      return true
  }
}

/**
 * 依据 schema 校验数据
 * @param {object} data 待校验数据对象
 * @param {object} schema 校验规则对象
 * @returns {{ valid: boolean, field?: string, message?: string }}
 *          校验通过返回 { valid: true }
 *          校验失败返回 { valid: false, field, message }
 */
function validate(data, schema) {
  // data 必须为非空对象
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, field: '', message: '参数不能为空' }
  }

  for (const field in schema) {
    const rule = schema[field]
    const value = data[field]

    // 空值判定：undefined / null / 空字符串 视为缺失
    const isEmpty = value === undefined || value === null || value === ''

    // 必填校验
    if (rule.required && isEmpty) {
      return { valid: false, field, message: `参数 ${field} 不能为空` }
    }

    // 非必填且为空时跳过后续校验
    if (isEmpty) continue

    // 类型校验
    if (!checkType(value, rule.type)) {
      return { valid: false, field, message: `参数 ${field} 类型应为 ${rule.type}` }
    }

    // 数值范围校验（number 类型）
    if (rule.type === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        return { valid: false, field, message: `参数 ${field} 不能小于 ${rule.min}` }
      }
      if (rule.max !== undefined && value > rule.max) {
        return { valid: false, field, message: `参数 ${field} 不能大于 ${rule.max}` }
      }
    }

    // 长度校验（string / array 类型）
    if (rule.type === 'string' || rule.type === 'array') {
      const len = value.length
      if (rule.maxLength !== undefined && len > rule.maxLength) {
        return { valid: false, field, message: `参数 ${field} 长度不能超过 ${rule.maxLength}` }
      }
      if (rule.min !== undefined && len < rule.min) {
        return { valid: false, field, message: `参数 ${field} 长度不能小于 ${rule.min}` }
      }
    }
  }

  return { valid: true }
}

module.exports = {
  SCHEMAS,
  validate
}
