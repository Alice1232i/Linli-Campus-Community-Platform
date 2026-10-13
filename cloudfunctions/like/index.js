/**
 * 临里校园 - 点赞模块云函数
 * ------------------------------------------------------------
 * 提供点赞/取消点赞、批量检查是否已赞等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - toggle     : 点赞 / 取消点赞（事务更新目标集合 stats.likes）
 *   - batchCheck : 批量检查当前用户是否已赞多个目标
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

const {
  initCloud,
  run,
  getOpenid,
  getUser,
  requireLogin,
  validate,
  ok,
  fail,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

// 点赞目标类型 -> 集合名 映射
const TARGET_COLLECTIONS = {
  post: 'posts',
  comment: 'comments'
}

/**
 * action: toggle
 * 点赞 / 取消点赞（TOCTOU 竞态修复版）：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：targetId / targetType（post | comment）
 * 3. 使用确定性 _id（like_${openid}_${targetId}_${targetType}）作为天然唯一约束
 * 4. 已存在：事务删除记录 + stats.likes - 1
 * 5. 不存在：事务创建记录（确定性 _id） + stats.likes + 1
 * 6. 并发插入冲突时安全降级，不产生脏数据
 * 7. 返回 { liked: true/false }
 */
async function handleToggle(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['like.toggle'])

  const { targetId, targetType } = event

  // 校验 targetType 合法性
  if (!TARGET_COLLECTIONS[targetType]) {
    return fail(ERRORS.PARAM_INVALID, 'targetType 不合法，仅支持 post / comment')
  }
  const targetCollection = TARGET_COLLECTIONS[targetType]

  // ---- 用户状态检查：封禁用户不可点赞 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法点赞')
  }

  // ---- 确定性 _id：作为天然唯一约束，防止并发重复插入 ----
  // 格式：like_${openid}_${targetId}_${targetType}
  // 数据库 _id 唯一性保证：并发请求中只有一个 add 成功，其余抛 duplicate key 错误
  const likeDocId = `like_${openid}_${targetId}_${targetType}`

  // ---- 查询是否已点赞 ----
  // 优先用 doc().get() 查确定性 _id（O(1) 索引命中）
  // 失败时降级 where 查询，兼容历史数据（历史记录使用随机 _id）
  let existingId = ''
  try {
    const { data } = await db.collection('likes').doc(likeDocId).get()
    if (data) existingId = likeDocId
  } catch (e) {
    // 确定性 _id 不存在，降级 where 查询兼容历史记录
    const { data: legacy } = await db
      .collection('likes')
      .where({ _openid: openid, targetId, targetType })
      .limit(1)
      .get()
    if (legacy.length > 0) existingId = legacy[0]._id
  }

  if (existingId) {
    // ---- 已点赞：取消点赞 ----
    await db.runTransaction(async transaction => {
      // 删除点赞记录
      await transaction.collection('likes').doc(existingId).remove()
      // 读取当前点赞数，大于 0 才 - 1，防止计数变负
      const targetRes = await transaction.collection(targetCollection).doc(targetId).get()
      const currentLikes = (targetRes.data.stats && targetRes.data.stats.likes) || 0
      if (currentLikes > 0) {
        await transaction
          .collection(targetCollection)
          .doc(targetId)
          .update({ data: { 'stats.likes': _.inc(-1) } })
      }
    })
    return ok({ liked: false })
  }

  // ---- 未点赞：新增点赞 ----
  // 隐藏帖禁止点赞（与详情页访问控制一致）
  if (targetType === 'post') {
    let targetPost = null
    try {
      const res = await db.collection('posts').doc(targetId).get()
      targetPost = res.data
    } catch (e) {
      targetPost = null
    }
    if (!targetPost || targetPost.status === 'deleted' || targetPost.status === 'hidden') {
      return fail(ERRORS.NOT_FOUND, '内容不存在或已被删除')
    }
  }

  // 使用确定性 _id 插入，事务保证「插入记录 + 计数+1」原子性
  // 并发场景：两个请求同时到达此分支，只有一个事务能提交成功
  //   失败方的 add 因 _id 冲突而失败，事务回滚，不会产生重复记录或计数翻倍
  const now = Date.now()
  let likeSucceeded = false
  try {
    await db.runTransaction(async transaction => {
      await transaction.collection('likes').add({
        data: {
          _id: likeDocId,
          _openid: openid,
          targetId,
          targetType,
          createdAt: now
        }
      })
      // 目标集合点赞数 + 1
      await transaction
        .collection(targetCollection)
        .doc(targetId)
        .update({ data: { 'stats.likes': _.inc(1) } })
    })
    likeSucceeded = true
  } catch (err) {
    // 并发插入冲突：另一请求已创建相同 _id 的记录
    // 此时不做任何计数变更，直接返回"已点赞"状态
    // 用户下次点击会正常走"取消点赞"流程
    console.warn('[like.toggle] 并发插入冲突，跳过计数:', err.message)
    return ok({ liked: true })
  }

  // ---- 创建通知给目标作者（不给自己发通知）----
  // 仅在点赞成功时创建，取消点赞不发通知
  if (likeSucceeded) {
    try {
      // 查询目标文档，获取作者 ID 和内容摘要
      const targetRes = await db.collection(targetCollection).doc(targetId).get()
      const targetData = targetRes.data || {}
      const authorId = targetData._openid || targetData.authorId || ''

      // 仅当目标作者不是当前用户时，才发通知
      if (authorId && authorId !== openid) {
        // 查询当前用户昵称和头像，用于通知展示
        const user = await getUser(openid)
        const nickname = (user && user.nickname) || '有人'
        const avatar = (user && user.avatar) || ''

        // 构造通知标题和正文
        const typeText = targetType === 'post' ? '帖子' : '评论'

        // 确定通知的跳转目标：
        // - 点赞帖子：refType=post, refId=帖子ID
        // - 点赞评论：refType=post, refId=评论所属帖子ID（前端跳转到帖子详情页）
        //   同时记录 commentId 字段，前端可用于高亮定位
        let notifyRefType = targetType
        let notifyRefId = targetId
        let extraData = {}
        if (targetType === 'comment') {
          // 点赞评论时，查询评论所属帖子 ID，确保点击通知能跳转到正确的帖子
          notifyRefType = 'post'
          notifyRefId = targetData.postId || ''
          extraData.commentId = targetId
          // 如果评论没有 postId 字段（异常数据），降级用评论 ID
          if (!notifyRefId) {
            notifyRefType = 'comment'
            notifyRefId = targetId
          }
        }

        // 通知正文：优先用帖子标题，其次用内容摘要
        let bodyText = ''
        if (targetType === 'post') {
          bodyText = targetData.title || (targetData.content ? targetData.content.slice(0, 50) : '')
        } else {
          bodyText = targetData.content ? targetData.content.slice(0, 50) : ''
        }

        // 只有能确定跳转目标时才创建通知
        if (notifyRefId) {
          // ---- 原子去重：确定性 _id + doc().set() 创建/替换通知 ----
          // 同一用户对同一目标的点赞通知只保留一条（未读），消除 query-then-add 竞态
          const notifyId = `notify_like_${authorId}_${openid}_${notifyRefId}`
          await db.collection('notifications').doc(notifyId).set({
            data: Object.assign({
              _openid: authorId,
              type: 'like',
              title: nickname + ' 赞了你的' + typeText,
              body: bodyText,
              refType: notifyRefType,
              refId: notifyRefId,
              senderId: openid,
              senderName: nickname,
              senderAvatar: avatar,
              read: false,
              createdAt: Date.now()
            }, extraData)
          })
        }
      }
    } catch (e) {
      // 通知创建失败不影响点赞主流程
      console.warn('[like.toggle] 创建通知失败:', e.message)
    }
  }

  return ok({ liked: true })
}

/**
 * action: batchCheck
 * 批量检查是否已赞：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：targetIds（array）/ targetType
 * 3. 查询 likes 集合 where(_openid === 当前openid, targetId in targetIds)
 * 4. 返回 { likedIds: [已赞的 targetId 数组] }
 */
async function handleBatchCheck(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['like.batchCheck'])

  const { targetIds, targetType } = event

  // 空数组直接返回空结果
  if (!targetIds || targetIds.length === 0) {
    return ok({ likedIds: [] })
  }

  // 查询当前用户在这些目标中已点赞的记录
  const { data } = await db
    .collection('likes')
    .where({
      _openid: openid,
      targetId: _.in(targetIds),
      targetType
    })
    .get()

  // 提取已赞的 targetId 列表
  const likedIds = data.map((item) => item.targetId)

  return ok({ likedIds })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'toggle':
      return handleToggle(event, context)
    case 'batchCheck':
      return handleBatchCheck(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
