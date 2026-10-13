/**
 * 临里校园 - 通知模块云函数
 * ------------------------------------------------------------
 * 提供站内通知的列表查询、未读计数、标记已读等能力。
 * 通知由其他云函数（like/comment/favorite/chat/order 等）在业务操作时
 * 调用内部 createNotification 方法写入 notifications 集合。
 *
 * 支持的 action：
 *   - list       : 通知列表（分页，支持按类型筛选）
 *   - unread     : 未读通知计数（按类型分组）
 *   - markRead   : 标记单条通知为已读
 *   - markAllRead: 标记全部通知为已读
 *
 * 通知文档结构（notifications 集合）：
 *   { _openid, type, title, body, refType, refId, read, createdAt }
 *
 * 统一响应格式：{ code, data, message }
 */

const {
  initCloud,
  run,
  getOpenid,
  requireLogin,
  validate,
  ok,
  fail,
  batchGetUserMap,
  resolveCloudFileIds,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate // 聚合操作符

/**
 * action: list
 * 通知列表：
 * 1. 鉴权：requireLogin
 * 2. 支持按 type 筛选（可选）
 * 3. 按 createdAt 降序分页
 * 4. 返回 { list, total, page, pageSize, hasMore, unreadCount }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['notify.list'])

  const page = event.page || 1
  const pageSize = 20
  const type = event.type || ''

  // 构造查询条件
  const where = { _openid: openid }
  if (type) {
    where.type = type
  }

  // 查询总数
  const { total } = await db.collection('notifications').where(where).count()

  // 分页查询：按创建时间降序
  const { data: list } = await db
    .collection('notifications')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 实时填充发送者信息（昵称/头像）----
  // 通知创建时写入的 senderName/senderAvatar 是快照，用户后续修改昵称/头像后
  // 旧通知仍显示过期信息。此处用 senderId 实时查询 users 集合，覆盖快照。
  const senderIds = []
  const idSet = {}
  list.forEach((item) => {
    const sid = item.senderId || ''
    if (sid && !idSet[sid]) {
      idSet[sid] = true
      senderIds.push(sid)
    }
  })
  if (senderIds.length > 0) {
    const userMap = await batchGetUserMap(senderIds)
    // 收集需要转换的 cloud:// 头像 fileID
    const avatarFileIds = []
    list.forEach((item) => {
      const sid = item.senderId || ''
      const u = userMap[sid]
      if (u) {
        // 用最新用户资料覆盖快照
        item.senderName = u.nickname || item.senderName || ''
        item.senderAvatar = u.avatar || item.senderAvatar || ''
      }
      // 收集 cloud:// 头像用于批量转换临时 URL
      if (item.senderAvatar && item.senderAvatar.indexOf('cloud://') === 0) {
        avatarFileIds.push(item.senderAvatar)
      }
    })
    // 批量转换 cloud:// fileID 为 HTTP 临时 URL
    if (avatarFileIds.length > 0) {
      const urlMap = await resolveCloudFileIds(avatarFileIds)
      list.forEach((item) => {
        if (item.senderAvatar && urlMap[item.senderAvatar]) {
          item.senderAvatar = urlMap[item.senderAvatar]
        }
      })
    }
  }

  // 查询未读总数（不受 type 筛选影响，返回全局未读数）
  const { total: unreadCount } = await db
    .collection('notifications')
    .where({ _openid: openid, read: false })
    .count()

  // ---- 移除通知中的 senderId（openid），发送者昵称/头像以快照字段展示 ----
  list.forEach((item) => {
    delete item.senderId
  })

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    unreadCount
  })
}

/**
 * action: unread
 * 未读通知计数：
 * 1. 鉴权：requireLogin
 * 2. 查询 read=false 的通知数量
 * 3. 按类型分组返回各类型未读数
 * 4. 返回 { total, byType: { like: 0, comment: 0, ... } }
 */
async function handleUnread(event, context) {
  const openid = requireLogin(getOpenid(context))

  // 查询全部未读
  const { total } = await db
    .collection('notifications')
    .where({ _openid: openid, read: false })
    .count()

  // 按类型聚合未读数（使用聚合管道）
  const { list: typeStats } = await db
    .collection('notifications')
    .aggregate()
    .match({ _openid: openid, read: false })
    .group({
      _id: '$type',
      count: $.sum(1)
    })
    .end()

  // 转为 { like: 2, comment: 1, ... } 格式
  const byType = {}
  if (typeStats && typeStats.length > 0) {
    typeStats.forEach((item) => {
      if (item._id) {
        byType[item._id] = item.count
      }
    })
  }

  return ok({ total, byType })
}

/**
 * action: markRead
 * 标记单条通知为已读：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：notificationId
 * 3. 校验通知归属权（_openid 必须为当前用户）
 * 4. 更新 read=true
 */
async function handleMarkRead(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['notify.markRead'])

  const { notificationId } = event

  // 校验通知归属权
  const { data } = await db
    .collection('notifications')
    .where({ _id: notificationId, _openid: openid })
    .limit(1)
    .get()

  if (data.length === 0) {
    return fail(ERRORS.NOT_FOUND, '通知不存在或无权操作')
  }

  await db.collection('notifications').doc(notificationId).update({
    data: { read: true }
  })

  return ok({ read: true })
}

/**
 * action: markAllRead
 * 标记全部通知为已读：
 * 1. 鉴权：requireLogin
 * 2. 批量更新当前用户所有 read=false 的通知
 */
async function handleMarkAllRead(event, context) {
  const openid = requireLogin(getOpenid(context))

  // 批量更新：将当前用户所有未读通知标记为已读
  const result = await db
    .collection('notifications')
    .where({ _openid: openid, read: false })
    .update({
      data: { read: true }
    })

  return ok({ updated: result.stats ? result.stats.updated : 0 })
}

/**
 * action: delete
 * 删除单条通知：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：notificationId
 * 3. 校验通知归属权（_openid 必须为当前用户）
 * 4. 物理删除通知文档
 */
async function handleDelete(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['notify.delete'])

  const { notificationId } = event

  // 校验通知归属权
  const { data } = await db
    .collection('notifications')
    .where({ _id: notificationId, _openid: openid })
    .limit(1)
    .get()

  if (data.length === 0) {
    return fail(ERRORS.NOT_FOUND, '通知不存在或无权操作')
  }

  await db.collection('notifications').doc(notificationId).remove()

  return ok({ deleted: true })
}

/**
 * action: clearAll
 * 清空当前用户全部通知：
 * 1. 鉴权：requireLogin
 * 2. 批量删除当前用户的所有通知文档
 * 3. 支持可选 type 参数，按类型清空
 */
async function handleClearAll(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['notify.clearAll'])

  const type = event.type || ''
  const where = { _openid: openid }
  if (type) where.type = type

  // 批量删除：云数据库 where().remove() 单次最多删 20 条，循环直到删完
  // 相比逐条 doc().remove()，每次 RPC 批量删 20 条，RPC 次数降低 20 倍
  let deleted = 0
  let keepDeleting = true
  while (keepDeleting) {
    const removeRes = await db
      .collection('notifications')
      .where(where)
      .remove()
    const removed = (removeRes.stats && removeRes.stats.removed) || 0
    deleted += removed
    // 单次删除不足 20 条，说明已删完
    keepDeleting = removed >= 20
  }

  return ok({ deleted })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'list':
      return handleList(event, context)
    case 'unread':
      return handleUnread(event, context)
    case 'markRead':
      return handleMarkRead(event, context)
    case 'markAllRead':
      return handleMarkAllRead(event, context)
    case 'delete':
      return handleDelete(event, context)
    case 'clearAll':
      return handleClearAll(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
