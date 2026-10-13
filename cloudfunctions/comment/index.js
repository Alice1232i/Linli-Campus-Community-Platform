/**
 * 临里校园 - 评论模块云函数
 * ------------------------------------------------------------
 * 提供发评论、评论列表、删除评论等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - create : 发评论（需登录 + 内容安全审核，事务更新帖子评论数）
 *   - list   : 评论列表（按创建时间升序分页）
 *   - delete : 删除评论（仅作者可删，事务更新帖子评论数 -1，不低于 0）
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

const {
  initCloud,
  run,
  getOpenid,
  getUser,
  enrichAuthors,
  requireLogin,
  validate,
  ok,
  fail,
  contentCheck,
  getBannedOpenids,
  checkCommentRateLimit,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

/**
 * 批量刷新评论列表中 replyTo 的昵称
 * 评论存储的 replyTo.nickname 可能已过时（用户改了昵称）
 * 此函数用 replyTo.userId 批量查询 users 集合，用最新昵称替换
 * @param {Array} list 评论列表
 * @returns {Promise<void>}
 */
async function enrichReplyToNicknames(list) {
  if (!list || !list.length) return
  // 收集所有 replyTo.userId
  var userIds = []
  list.forEach(function(comment) {
    if (comment.replyTo && comment.replyTo.userId) {
      userIds.push(comment.replyTo.userId)
    }
  })
  if (userIds.length === 0) return
  // 批量查询用户昵称
  var uniqueIds = []
  var seen = {}
  userIds.forEach(function(id) {
    if (!seen[id]) {
      seen[id] = true
      uniqueIds.push(id)
    }
  })
  var userMap = {}
  try {
    var res = await db
      .collection('users')
      .where({ openid: _.in(uniqueIds) })
      .field({ openid: true, nickname: true })
      .get()
    res.data.forEach(function(u) {
      userMap[u.openid] = u.nickname
    })
  } catch (e) {
    console.warn('[comment.enrichReplyTo] 查询用户昵称失败:', e.message)
    return
  }
  // ---- 兼容 replyTo.userId 为 users._id 的新数据：未命中时按 _id 补充查询 ----
  var missIds = uniqueIds.filter(function(id) {
    return !userMap[id]
  })
  if (missIds.length > 0) {
    try {
      var res2 = await db
        .collection('users')
        .where({ _id: _.in(missIds) })
        .field({ _id: true, nickname: true })
        .get()
      res2.data.forEach(function(u) {
        userMap[u._id] = u.nickname
      })
    } catch (e) {
      console.warn('[comment.enrichReplyTo] 按 _id 查询昵称失败:', e.message)
    }
  }
  // 用最新昵称替换 replyTo.nickname
  list.forEach(function(comment) {
    if (comment.replyTo && comment.replyTo.userId) {
      var latestNickname = userMap[comment.replyTo.userId]
      if (latestNickname) {
        comment.replyTo.nickname = latestNickname
      }
    }
  })
}

/**
 * action: create
 * 发评论流程：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：postId / content / parentId / replyTo
 * 3. 内容安全审核：contentCheck(content)
 * 4. 查询用户档案获取 author 信息
 * 5. 事务：创建 comments 文档 + 更新 posts.stats.comments + 1
 * 6. 返回 { commentId }
 */
async function handleCreate(event, context) {
  const openid = requireLogin(getOpenid(context))
  // 基础参数校验
  validate(event, SCHEMAS['comment.create'])

  const { postId, content, parentId, replyTo, clientId } = event

  // ---- 幂等检查：使用确定性 _id 原子查询（O(1) 索引命中）----
  // 格式：comment_${openid}_${postId}_${clientId}，数据库 _id 唯一性保证幂等
  // 弱网超时重试时，服务端用确定性 _id 原子查重，避免创建重复评论
  if (clientId) {
    const deterministicId = 'comment_' + openid + '_' + postId + '_' + clientId
    try {
      const existingDoc = await db.collection('comments').doc(deterministicId).get()
      if (existingDoc && existingDoc.data) {
        console.log('[comment.create] 幂等命中（确定性 _id），返回已有评论:', deterministicId)
        return ok({ commentId: deterministicId })
      }
    } catch (e) {
      // 文档不存在，正常继续创建流程
    }
  }

  // ---- 校验帖子存在且未删除 ----
  let post = null
  try {
    const res = await db.collection('posts').doc(postId).get()
    post = res.data
  } catch (e) {
    post = null
  }
  // 隐藏帖禁止评论（包括作者本人），与详情页访问控制一致
  if (!post || post.status === 'deleted' || post.status === 'hidden') {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  // ---- replyTo 服务端反查：不信任客户端传入的被回复者信息 ----
  // 当 parentId 非空时，反查父评论获取真实作者，防止伪造 replyTo.userId
  let verifiedReplyToUserId = ''
  let verifiedReplyToNickname = ''
  if (parentId) {
    try {
      const parentRes = await db.collection('comments').doc(parentId).get()
      const parentComment = parentRes.data
      if (!parentComment || parentComment.status === 'deleted') {
        return fail(ERRORS.NOT_FOUND, '回复的评论不存在或已被删除')
      }
      // 以父评论作者的 openid 作为通知目标，而非客户端传入的 replyTo.userId
      verifiedReplyToUserId = parentComment._openid || ''
      // 昵称稍后通过 getUser 获取，此处先留空
    } catch (e) {
      return fail(ERRORS.PARAM_INVALID, '回复的评论不存在')
    }
  }

  // ---- 内容安全审核 ----
  // 审核服务异常时拒绝（与发帖策略一致），避免 openapi 故障导致全量评论被误杀或违规放行
  let textResult
  try {
    textResult = await contentCheck(content, openid, 2)
  } catch (e) {
    console.error('[comment.create] 文本安全检测调用失败:', e.message)
    return fail(ERRORS.CONTENT_RISK, '内容审核服务异常，请稍后重试')
  }
  // 审核服务异常：拒绝（UGC 风险高，避免违规内容因审核故障放行）
  if (textResult.error) {
    return fail(ERRORS.CONTENT_RISK, '内容审核服务异常，请稍后重试')
  }
  if (!textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '评论包含违规内容，请修改后重试')
  }

  // ---- 查询用户档案（用于通知发送，不冗余存储到评论）----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }

  // ---- 用户状态检查：封禁/禁言用户不可评论 ----
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法评论')
  }
  if (user.status === 'muted') {
    return fail(ERRORS.OPERATION_FAILED, '账号已被禁言，无法评论')
  }

  // ---- 评论频率限制：同一用户 10 秒内仅允许发 1 条评论 ----
  // 防止恶意刷评论，数据库查询最近 10 秒内的评论记录
  if (!await checkCommentRateLimit(openid)) {
    return fail(ERRORS.OPERATION_FAILED, '评论过于频繁，请稍后再试')
  }

  const now = Date.now()

  // ---- 构造评论文档（仅存储 _openid，author 信息在读取时实时填充）----
  const commentData = {
    _openid: openid,
    postId,
    parentId: parentId || '',
    replyTo: replyTo || null,
    content,
    images: [],
    likeCount: 0,
    secStatus: 'pass',
    status: 'normal',
    clientId: clientId || '', // 幂等键：客户端生成的唯一ID，用于防重复提交
    createdAt: now
  }

  // ---- 事务：创建评论 + 帖子评论数 +1 ----
  // 有 clientId 时使用确定性 _id（comment_${openid}_${postId}_${clientId}），保证幂等
  // 无 clientId 时使用系统自动生成的 _id
  const deterministicCommentId = clientId ? 'comment_' + openid + '_' + postId + '_' + clientId : ''
  let commentId = ''

  if (deterministicCommentId) {
    // 确定性 _id 创建：add() 携带 _id，冲突时抛错（并发场景安全降级）
    try {
      commentId = await db.runTransaction(async transaction => {
        const addRes = await transaction.collection('comments').add({
          data: Object.assign({ _id: deterministicCommentId }, commentData)
        })
        await transaction
          .collection('posts')
          .doc(postId)
          .update({ data: { 'stats.comments': _.inc(1) } })
        return addRes._id
      })
    } catch (e) {
      // 并发创建冲突：另一请求已创建相同 _id 的评论
      console.warn('[comment.create] 确定性 _id 创建冲突，返回已有:', e.message)
      return ok({ commentId: deterministicCommentId })
    }
  } else {
    commentId = await db.runTransaction(async transaction => {
      const addRes = await transaction.collection('comments').add({ data: commentData })
      await transaction
        .collection('posts')
        .doc(postId)
        .update({ data: { 'stats.comments': _.inc(1) } })
      return addRes._id
    })
  }

  // ---- 创建通知给帖子作者（不给自己发通知）+ 评论通知原子去重 ----
  // 使用确定性 _id + doc().set() 原子创建/替换通知，消除 query-then-add 竞态
  try {
    const authorId = post._openid || post.authorId || ''
    const nickname = (user && user.nickname) || '有人'
    const avatar = (user && user.avatar) || ''
    const bodyText = content.slice(0, 50)

    if (authorId && authorId !== openid) {
      // 确定性 ID：同一用户对同一帖子的评论通知只保留一条（原子 set 替换）
      const notifyId = `notify_comment_${authorId}_${openid}_${postId}`
      await db.collection('notifications').doc(notifyId).set({
        data: {
          _openid: authorId,
          type: 'comment',
          title: nickname + ' 评论了你的帖子',
          body: bodyText,
          refType: 'post',
          refId: postId,
          senderId: openid,
          senderName: nickname,
          senderAvatar: avatar,
          read: false,
          createdAt: Date.now()
        }
      })
    }

    // ---- 如果是回复其他评论，也给被回复者发通知（使用服务端反查的 userId）----
    if (parentId && verifiedReplyToUserId) {
      // 被回复者不是帖子作者（避免重复通知）且不是自己
      if (verifiedReplyToUserId !== authorId && verifiedReplyToUserId !== openid) {
        const replyNotifyId = `notify_reply_${verifiedReplyToUserId}_${openid}_${postId}`
        await db.collection('notifications').doc(replyNotifyId).set({
          data: {
            _openid: verifiedReplyToUserId,
            type: 'comment',
            title: nickname + ' 回复了你的评论',
            body: bodyText,
            refType: 'post',
            refId: postId,
            senderId: openid,
            senderName: nickname,
            senderAvatar: avatar,
            read: false,
            createdAt: Date.now()
          }
        })
      }
    }
  } catch (e) {
    // 通知创建失败不影响评论主流程
    console.warn('[comment.create] 创建通知失败:', e.message)
  }

  return ok({ commentId })
}

/**
 * action: list
 * 评论列表（游标分页 + replyTo 昵称实时刷新）：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：postId / cursor / pageSize
 * 3. 游标分页：cursor > 0 时用 createdAt > cursor 替代 skip
 * 4. 并行填充 author 信息和 replyTo 昵称
 * 5. 返回 { list, total, page, pageSize, hasMore, nextCursor }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['comment.list'])

  const { postId } = event
  const pageSize = event.pageSize || 20
  const cursor = event.cursor || 0

  // ---- 获取被封禁用户的 openid 列表（内存缓存，TTL 5 分钟）----
  // 排除封禁用户的评论，隐藏其回复内容
  const bannedOpenids = await getBannedOpenids()

  // ---- 获取当前用户拉黑列表（拉黑者的评论也不可见）----
  let blockList = []
  try {
    const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
    blockList = (users[0] && users[0].blockList) || []
  } catch (e) {
    console.warn('[comment.list] 获取拉黑列表失败，降级为空:', e.message)
  }

  const where = {
    postId,
    status: 'normal'
  }
  const excludeOpenids = blockList.concat(bannedOpenids)
  if (excludeOpenids.length > 0) {
    where._openid = _.nin(excludeOpenids)
  }

  // ---- 游标分页：cursor > 0 时追加 createdAt > cursor 条件 ----
  // 评论按 createdAt 升序，续页取上一页最后一条的 createdAt
  const queryWhere = Object.assign({}, where)
  if (cursor > 0) {
    queryWhere.createdAt = _.gt(cursor)
  }

  // ---- 仅首页计算 total（后续页不需要，省一次 count 查询）----
  let total = 0
  if (cursor === 0) {
    const countRes = await db.collection('comments').where(where).count()
    total = countRes.total
  }

  // 分页查询：按创建时间升序（旧评论在前）
  const { data: list } = await db
    .collection('comments')
    .where(queryWhere)
    .orderBy('createdAt', 'asc')
    .limit(pageSize)
    .get()

  // ---- 标记每条评论是否本人（isMine），供前端展示删除入口 ----
  // 在 enrichAuthors 移除 _openid 之前记录，避免他人 openid 下发
  list.forEach((comment) => {
    comment.isMine = comment._openid === openid
  })

  // ---- 映射点赞数（修复「评论点赞数永远显示 0」）----
  // 点赞记录的统一计数落在 stats.likes（like 云函数对帖子/评论一致地递增 stats.likes），
  // 但评论项组件读取的是 likeCount —— 该字段仅在 comment.create 时写死为 0、此后无人递增，
  // 导致点赞成功后刷新页面计数又归零。此处以 stats.likes 为准回填 likeCount，
  // 并兼容历史数据里可能存在的 likeCount 值。
  list.forEach((comment) => {
    const likes = comment.stats && comment.stats.likes
    comment.likeCount = typeof likes === 'number' ? likes : (comment.likeCount || 0)
  })

  // ---- 并行优化：填充 author 信息 + 刷新 replyTo 昵称 ----
  await Promise.all([
    enrichAuthors(list, '_openid'),
    enrichReplyToNicknames(list)
  ])

  // ---- 移除回复目标中的 userId（openid 或内部 ID），避免被回复者标识下发 ----
  // 昵称以快照展示，服务端仍可基于库内 replyTo.userId 刷新
  list.forEach(function(comment) {
    if (comment.replyTo) {
      delete comment.replyTo.userId
    }
  })

  // ---- 游标与 hasMore 计算 ----
  const hasMore = list.length === pageSize
  const nextCursor = (hasMore && list.length > 0)
    ? (list[list.length - 1].createdAt || 0)
    : 0

  return ok({
    list,
    total,
    page: 1,
    pageSize,
    hasMore,
    nextCursor
  })
}

/**
 * action: delete
 * 删除评论（软删除）：
 * 1. 鉴权：requireLogin
 * 2. 验证评论 _openid === 当前 openid
 * 3. 事务：更新 comments.status='deleted' + posts.stats.comments - 1（不低于 0）
 * 4. 返回 ok
 */
async function handleDelete(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['comment.delete'])
  const { commentId } = event

  // ---- 查询评论 ----
  let comment = null
  try {
    const res = await db.collection('comments').doc(commentId).get()
    comment = res.data
  } catch (e) {
    comment = null
  }
  if (!comment) {
    return fail(ERRORS.NOT_FOUND, '评论不存在')
  }

  // ---- 权限校验：仅评论作者可删除 ----
  if (comment._openid !== openid) {
    return fail(ERRORS.FORBIDDEN, '无权删除他人评论')
  }

  // 已删除的评论不重复操作
  if (comment.status === 'deleted') {
    return ok({ deleted: true })
  }

  // ---- 事务：更新评论状态 + 帖子评论数 - 1（不低于 0） ----
  await db.runTransaction(async transaction => {
    // 更新评论状态为已删除
    await transaction
      .collection('comments')
      .doc(commentId)
      .update({ data: { status: 'deleted' } })

    // 读取帖子当前评论数，确保不低于 0
    const postRes = await transaction.collection('posts').doc(comment.postId).get()
    const currentComments = (postRes.data.stats && postRes.data.stats.comments) || 0
    if (currentComments > 0) {
      await transaction
        .collection('posts')
        .doc(comment.postId)
        .update({ data: { 'stats.comments': _.inc(-1) } })
    }
  })

  // ---- 关联数据清理（事务外执行，失败不阻断删除主流程）----
  // ① 删除该评论的 likes 记录，避免 batchCheck 仍返回"已赞"
  // ② 子评论标记 parentDeleted=true，前端展示"该评论已删除"
  // ③ 删除相关通知，避免点击跳转后定位不到
  try {
    // ① 批量删除该评论的点赞记录（where().remove() 单次最多删 20 条，循环处理）
    let likesDeleted = false
    while (!likesDeleted) {
      const removeRes = await db
        .collection('likes')
        .where({ targetId: commentId, targetType: 'comment' })
        .remove()
      likesDeleted = !removeRes.stats || removeRes.stats.removed < 20
    }

    // ② 子评论批量标记 parentDeleted（where().update() 一次更新全部）
    await db
      .collection('comments')
      .where({ parentId: commentId, status: 'normal' })
      .update({ data: { parentDeleted: true } })

    // ③ 批量删除引用该评论的通知（where().remove() 循环处理）
    let notifyDeleted = false
    while (!notifyDeleted) {
      const removeRes = await db
        .collection('notifications')
        .where({ refType: 'comment', refId: commentId })
        .remove()
      notifyDeleted = !removeRes.stats || removeRes.stats.removed < 20
    }
  } catch (e) {
    // 关联清理失败不阻断删除主流程，记录日志便于排查
    console.warn('[comment.delete] 关联数据清理失败:', e.message)
  }

  return ok({ deleted: true })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'create':
      return handleCreate(event, context)
    case 'list':
      return handleList(event, context)
    case 'delete':
      return handleDelete(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
