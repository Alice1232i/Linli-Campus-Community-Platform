/**
 * 临里校园 - 拉黑模块云函数
 * ------------------------------------------------------------
 * 提供拉黑用户、取消拉黑、拉黑列表等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - block   : 拉黑用户（不能拉黑自己，同时更新 users.blockList）
 *   - unblock : 取消拉黑（同时更新 users.blockList）
 *   - list    : 拉黑列表（分页）
 *
 * 数据模型说明：
 *   blocks 集合：{ _openid, blockedOpenid, createdAt }
 *   users.blockList：数组字段，存储被拉黑用户的 openid 列表（冗余，用于信息流过滤）
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

const {
  initCloud,
  run,
  getOpenid,
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
 * action: block
 * 拉黑用户：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：targetOpenid
 * 3. 不能拉黑自己
 * 4. 查询 blocks 是否已存在，不存在则创建
 * 5. 同时更新 users.blockList 数组（push targetOpenid）
 * 6. 返回 ok
 */
async function handleBlock(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['block.block'])

  const { targetOpenid, targetUserId } = event

  // ---- 解析被拉黑用户 openid：兼容 targetUserId（users._id）或 targetOpenid ----
  let targetOpenidResolved = targetOpenid || ''
  if (!targetOpenidResolved && targetUserId) {
    try {
      const targetRes = await db.collection('users').doc(targetUserId).get()
      if (targetRes.data) targetOpenidResolved = targetRes.data.openid || ''
    } catch (e) {
      // 用户不存在，保持为空
    }
  }
  if (!targetOpenidResolved) {
    return fail(ERRORS.PARAM_INVALID, '拉黑目标不存在')
  }
  targetOpenid = targetOpenidResolved

  // ---- 不能拉黑自己 ----
  if (targetOpenid === openid) {
    return fail(ERRORS.PARAM_INVALID, '不能拉黑自己')
  }

  // ---- 查询是否已拉黑 ----
  const { data: existing } = await db
    .collection('blocks')
    .where({ _openid: openid, blockedOpenid: targetOpenid })
    .limit(1)
    .get()

  // 已存在拉黑记录，直接返回成功（幂等操作）
  if (existing.length > 0) {
    return ok({ blocked: true })
  }

  // ---- 创建拉黑记录 ----
  const now = Date.now()
  await db.collection('blocks').add({
    data: {
      _openid: openid,
      blockedOpenid: targetOpenid,
      createdAt: now
    }
  })

  // ---- 同步更新 users.blockList 数组（push） ----
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  if (users.length > 0) {
    await db
      .collection('users')
      .doc(users[0]._id)
      .update({
        data: {
          blockList: _.push(targetOpenid),
          updatedAt: now
        }
      })
  }

  return ok({ blocked: true })
}

/**
 * action: unblock
 * 取消拉黑：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：targetOpenid
 * 3. 删除 blocks 文档
 * 4. 同时更新 users.blockList（pull targetOpenid）
 * 5. 返回 ok
 */
async function handleUnblock(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['block.unblock'])

  const { targetOpenid, targetUserId } = event

  // ---- 解析被拉黑用户 openid：兼容 targetUserId（users._id）或 targetOpenid ----
  let targetOpenidResolved = targetOpenid || ''
  if (!targetOpenidResolved && targetUserId) {
    try {
      const targetRes = await db.collection('users').doc(targetUserId).get()
      if (targetRes.data) targetOpenidResolved = targetRes.data.openid || ''
    } catch (e) {
      // 用户不存在，保持为空
    }
  }
  if (!targetOpenidResolved) {
    return fail(ERRORS.PARAM_INVALID, '拉黑目标不存在')
  }
  targetOpenid = targetOpenidResolved

  // ---- 查询并删除拉黑记录 ----
  const { data: existing } = await db
    .collection('blocks')
    .where({ _openid: openid, blockedOpenid: targetOpenid })
    .limit(1)
    .get()

  // 不存在拉黑记录，直接返回成功（幂等操作）
  if (existing.length === 0) {
    return ok({ blocked: false })
  }

  await db.collection('blocks').doc(existing[0]._id).remove()

  // ---- 同步更新 users.blockList 数组（pull） ----
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  if (users.length > 0) {
    await db
      .collection('users')
      .doc(users[0]._id)
      .update({
        data: {
          blockList: _.pull(targetOpenid),
          updatedAt: Date.now()
        }
      })
  }

  return ok({ blocked: false })
}

/**
 * action: list
 * 拉黑列表：
 * 1. 鉴权：requireLogin
 * 2. 参数校验：page
 * 3. 查询 _openid === 当前openid 的 blocks，按 createdAt 降序分页
 * 4. 返回 { list, total, page, pageSize, hasMore }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['block.list'])

  const page = event.page || 1
  const pageSize = 20

  const where = { _openid: openid }

  // 查询总数
  const { total } = await db.collection('blocks').where(where).count()

  // 分页查询：按拉黑时间降序（最新拉黑在前）
  const { data: list } = await db
    .collection('blocks')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 批量查询被拉黑用户信息（昵称/头像/内部 ID），不返回 openid ----
  const blockedOpenids = list.map((b) => b.blockedOpenid || '').filter(Boolean)
  const userMap = {}
  if (blockedOpenids.length > 0) {
    try {
      const { data: users } = await db
        .collection('users')
        .where({ openid: _.in(blockedOpenids) })
        .get()
      users.forEach((u) => { userMap[u.openid] = u })
    } catch (e) {
      console.warn('[block.list] 查询被拉黑用户信息失败:', e.message)
    }
  }
  const safeList = list.map((b) => {
    const u = userMap[b.blockedOpenid] || null
    return {
      _id: b._id,
      userId: (u && u._id) || '',
      nickname: (u && u.nickname) || '未知用户',
      avatar: (u && u.avatar) || '',
      createdAt: b.createdAt || 0
    }
  })

  return ok({
    list: safeList,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'block':
      return handleBlock(event, context)
    case 'unblock':
      return handleUnblock(event, context)
    case 'list':
      return handleList(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
