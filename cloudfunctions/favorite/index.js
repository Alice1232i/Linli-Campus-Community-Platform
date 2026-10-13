/**
 * 临里校园 - 收藏模块云函数
 * ------------------------------------------------------------
 * 提供收藏/取消收藏、检查是否已收藏、收藏列表等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - toggle : 收藏 / 取消收藏（事务更新 posts.stats.favorites）
 *   - check  : 检查是否已收藏
 *   - list   : 我的收藏列表（分页）
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
  resolveCloudImages,
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

/**
 * action: toggle
 * 收藏 / 取消收藏（TOCTOU 竞态修复版）：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：postId
 * 3. 使用确定性 _id（fav_${openid}_${postId}）作为天然唯一约束
 * 4. 已存在：事务删除记录 + stats.favorites - 1
 * 5. 不存在：事务创建记录（确定性 _id） + stats.favorites + 1
 * 6. 并发插入冲突时安全降级，不产生脏数据
 * 7. 返回 { favorited: true/false }
 */
async function handleToggle(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['favorite.toggle'])

  const { postId } = event

  // ---- 用户状态检查：封禁用户不可收藏 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法收藏')
  }

  // ---- 确定性 _id：作为天然唯一约束，防止并发重复插入 ----
  // 格式：fav_${openid}_${postId}
  // 数据库 _id 唯一性保证：并发请求中只有一个 add 成功
  const favDocId = `fav_${openid}_${postId}`

  // ---- 查询是否已收藏 ----
  // 优先用 doc().get() 查确定性 _id（O(1)），失败时降级 where 兼容历史数据
  let existingId = ''
  try {
    const { data } = await db.collection('favorites').doc(favDocId).get()
    if (data) existingId = favDocId
  } catch (e) {
    // 确定性 _id 不存在，降级 where 查询兼容历史记录
    const { data: legacy } = await db
      .collection('favorites')
      .where({ _openid: openid, postId })
      .limit(1)
      .get()
    if (legacy.length > 0) existingId = legacy[0]._id
  }

  if (existingId) {
    // ---- 已收藏：取消收藏 ----
    await db.runTransaction(async transaction => {
      // 删除收藏记录
      await transaction.collection('favorites').doc(existingId).remove()
      // 帖子收藏数 - 1（读取当前值，大于 0 才减，防止变负）
      const postRes = await transaction.collection('posts').doc(postId).get()
      const currentFavs = (postRes.data.stats && postRes.data.stats.favorites) || 0
      if (currentFavs > 0) {
        await transaction
          .collection('posts')
          .doc(postId)
          .update({ data: { 'stats.favorites': _.inc(-1) } })
      }
    })
    return ok({ favorited: false })
  }

  // ---- 未收藏：创建收藏记录 ----
  // 查询帖子信息，构造 postSnapshot 快照
  let post = null
  try {
    const res = await db.collection('posts').doc(postId).get()
    post = res.data
  } catch (e) {
    post = null
  }
  if (!post || post.status === 'deleted' || post.status === 'hidden') {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  // 构造帖子快照：标题、封面（第一张图）、作者信息
  const postSnapshot = {
    title: post.title || '',
    cover: (post.images && post.images.length > 0) ? post.images[0] : '',
    author: {
      nickname: (post.author && post.author.nickname) || '',
      avatar: (post.author && post.author.avatar) || ''
    }
  }

  // 使用确定性 _id 插入，事务保证「插入记录 + 计数+1」原子性
  const now = Date.now()
  let favSucceeded = false
  try {
    await db.runTransaction(async transaction => {
      await transaction.collection('favorites').add({
        data: {
          _id: favDocId,
          _openid: openid,
          postId,
          postSnapshot,
          createdAt: now
        }
      })
      // 帖子收藏数 + 1
      await transaction
        .collection('posts')
        .doc(postId)
        .update({ data: { 'stats.favorites': _.inc(1) } })
    })
    favSucceeded = true
  } catch (err) {
    // 并发插入冲突：另一请求已创建相同 _id 的记录
    // 此时不做任何计数变更，直接返回"已收藏"状态
    console.warn('[favorite.toggle] 并发插入冲突，跳过计数:', err.message)
    return ok({ favorited: true })
  }

  // ---- 创建通知给帖子作者（不给自己发通知）----
  // 仅在收藏成功时创建
  if (favSucceeded) {
    try {
      const authorId = post._openid || post.authorId || ''
      if (authorId && authorId !== openid) {
        const user = await getUser(openid)
        const nickname = (user && user.nickname) || '有人'
        const avatar = (user && user.avatar) || ''
        // 通知正文：优先用帖子标题，其次用内容摘要
        const bodyText = post.title || (post.content ? post.content.slice(0, 50) : '')

        // ---- 原子去重：确定性 _id + doc().set() 创建/替换通知 ----
        // 同一用户对同一帖子的收藏通知只保留一条（未读），消除 query-then-add 竞态
        const notifyId = `notify_fav_${authorId}_${openid}_${postId}`
        await db.collection('notifications').doc(notifyId).set({
          data: {
            _openid: authorId,
            type: 'favorite',
            title: nickname + ' 收藏了你的帖子',
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
    } catch (e) {
      // 通知创建失败不影响收藏主流程
      console.warn('[favorite.toggle] 创建通知失败:', e.message)
    }
  }

  return ok({ favorited: true })
}

/**
 * action: check
 * 检查是否已收藏：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：postId
 * 3. 查询 favorites 集合
 * 4. 返回 { favorited: true/false }
 */
async function handleCheck(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['favorite.check'])

  const { postId } = event

  const { data } = await db
    .collection('favorites')
    .where({ _openid: openid, postId })
    .limit(1)
    .get()

  return ok({ favorited: data.length > 0 })
}

/**
 * 批量填充帖子列表的 liked 状态（当前用户是否已点赞）
 * 对齐 post.batchFillLikedStatus：一次查询 likes 集合，服务端直接返回 liked 字段，
 * 前端无需再额外调用 like.batchCheck。
 * @param {Array} list 帖子列表
 * @param {string} openid 当前用户 openid
 * @returns {Promise<void>}
 */
async function fillLikedStatus(list, openid) {
  if (!list || !list.length || !openid) return
  const postIds = list.map((p) => p._id).filter(Boolean)
  if (!postIds.length) return
  try {
    const { data: likedRecords } = await db
      .collection('likes')
      .where({
        _openid: openid,
        targetId: _.in(postIds),
        targetType: 'post'
      })
      .field({ targetId: true })
      .get()
    const likedSet = {}
    likedRecords.forEach((r) => { likedSet[r.targetId] = true })
    list.forEach((p) => { p.liked = !!likedSet[p._id] })
  } catch (e) {
    console.warn('[favorite.fillLikedStatus] 查询点赞状态失败:', e.message)
    // 查询失败时默认未点赞，不影响列表展示
    list.forEach((p) => { p.liked = false })
  }
}

/**
 * action: list
 * 我的收藏列表：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：page
 * 3. 查询 _openid === 当前openid 的 favorites，按 createdAt 降序分页
 * 4. 用 postId 关联查询 posts 集合，获取完整帖子数据（实时，非快照）
 * 5. 过滤已删除的帖子，返回 { list, total, page, pageSize, hasMore }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['favorite.list'])

  const page = event.page || 1
  const pageSize = 20

  const where = { _openid: openid }

  // 分页查询：按收藏时间降序（最新收藏在前）
  const { data: favList } = await db
    .collection('favorites')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 用 postId 批量查询关联的 posts，获取完整帖子数据
  const postIds = favList.map(f => f.postId).filter(Boolean)
  let postMap = {}
  if (postIds.length > 0) {
    const { data: posts } = await db
      .collection('posts')
      .where({ _id: _.in(postIds) })
      .get()
    posts.forEach(p => { postMap[p._id] = p })
  }

  // ---- 获取被封禁用户的 openid 列表，收藏列表中也隐藏其帖子 ----
  let bannedOpenids = []
  try {
    const { data: bannedUsers } = await db
      .collection('users')
      .where({ status: 'banned' })
      .field({ openid: true })
      .limit(100)
      .get()
    bannedOpenids = bannedUsers.map((u) => u.openid)
  } catch (e) {
    console.warn('[favorite.list] 获取封禁用户列表失败，降级为空:', e.message)
  }

  // ---- 获取当前用户拉黑列表（拉黑者的收藏帖子也不显示）----
  let blockList = []
  try {
    const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
    blockList = (users[0] && users[0].blockList) || []
  } catch (e) {
    console.warn('[favorite.list] 获取拉黑列表失败，降级为空:', e.message)
  }

  // 组装结果：favorites 记录 + 关联的完整帖子数据
  // 过滤掉已删除、查不到、或属于封禁用户的帖子，避免列表出现无效项
  const list = favList
    .map(fav => {
      const post = postMap[fav.postId]
      if (!post || post.status === 'deleted') return null
      // 隐藏封禁用户/当前用户拉黑用户发布的帖子
      if (post._openid) {
        if (bannedOpenids.indexOf(post._openid) !== -1) return null
        if (blockList.indexOf(post._openid) !== -1) return null
      }
      // 返回完整帖子对象，附带收藏时间
      return Object.assign({}, post, {
        _favoritedAt: fav.createdAt
      })
    })
    .filter(item => item !== null)

  // ---- 对齐 post 列表三件套：作者注入 + 图片 URL 转换 + 点赞状态 ----
  // 此前 handleList 直接返回 posts 原始文档，导致：作者信息缺失（前端无昵称/头像）、
  // images 仍是 cloud:// fileID（前端不显示）、且原样透出 _openid/authorId。
  // enrichAuthors 内部会统一删除 _openid/authorId，一并消除越权标识泄露。
  await Promise.all([
    enrichAuthors(list),
    resolveCloudImages(list)
  ])
  await fillLikedStatus(list, openid)

  // ---- 收藏总数 ----
  // 此前误用 list.length（当前页「过滤后」的条数）→ 收藏超过一页（20 条）后 total 恒为 20，
  // 「我的」页的收藏统计随之失真；且与 total 语义（总数）不符。
  // 现改为对 favorites 记录做 count（与列表同源、O(1) 走索引）。
  // 说明：因帖子被删除/作者被拉黑而未出现在列表中的收藏仍会计入总数——
  //      如需与列表逐条严格一致，需遍历全部收藏并校验帖子存活，成本较高，此处不做。
  const { total } = await db
    .collection('favorites')
    .where({ _openid: openid })
    .count()

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: favList.length === pageSize
  })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'toggle':
      return handleToggle(event, context)
    case 'check':
      return handleCheck(event, context)
    case 'list':
      return handleList(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
