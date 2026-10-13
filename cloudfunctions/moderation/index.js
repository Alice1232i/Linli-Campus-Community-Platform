/**
 * 临里校园 - 运营管理云函数
 * ------------------------------------------------------------
 * 提供帖子置顶/精华/隐藏/删除、用户封禁/禁言、举报列表与处理等运营能力。
 * 所有操作均要求管理员角色（requireRole(['admin'])），并记录 moderation_logs。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - setTop         : 置顶帖子（可设置过期时间，默认7天后）
 *   - setEssence     : 设置精华
 *   - hidePost       : 隐藏帖子
 *   - deletePost     : 删除帖子（同步标记关联明细 status='deleted'）
 *   - banUser        : 封禁用户
 *   - muteUser       : 禁言用户
 *   - listReports    : 举报列表（按 status 过滤分页）
 *   - resolveReport  : 处理举报
 *
 * 数据模型说明：
 *   moderation_logs 集合：
 *     { action, targetType, targetId, operatorOpenid, reason, detail, createdAt }
 *
 * 统一响应格式：{ code, data, message }
 *   code 为 0 表示成功，非 0 表示业务/系统错误（见 shared/errors.js）
 */

const {
  initCloud,
  run,
  getOpenid,
  getUser,
  requireRole,
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

// 默认置顶时长：7天（毫秒）
const DEFAULT_TOP_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 写入一条运营日志
 * @param {object} param 日志参数
 * @param {string} param.action 操作动作
 * @param {string} param.targetType 目标类型
 * @param {string} param.targetId 目标ID
 * @param {string} param.operatorOpenid 操作人openid
 * @param {string} [param.reason] 原因（可选）
 * @param {*} [param.detail] 附加详情（可选）
 * @returns {Promise<void>}
 */
async function writeLog({ action, targetType, targetId, operatorOpenid, reason, detail }) {
  try {
    await db.collection('moderation_logs').add({
      data: {
        action,
        targetType,
        targetId,
        operatorOpenid,
        reason: reason || '',
        detail: detail || '',
        createdAt: Date.now()
      }
    })
  } catch (e) {
    // 日志写入失败不阻断主流程，仅记录错误
    console.error('[moderation.writeLog] 写入运营日志失败:', e)
  }
}

/**
 * 统一获取管理员上下文：鉴权 + 角色校验
 * requireRole 校验通过后会返回用户对象，避免重复查询 users 集合
 * @param {object} context 云函数上下文
 * @returns {{ openid: string, user: object }}
 */
async function getAdminContext(context) {
  const user = requireRole(await getUser(getOpenid(context)), ['admin'])
  return { openid: user.openid, user }
}

/**
 * action: setTop
 * 置顶帖子：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：postId / expire(可选)
 * 3. 更新 posts：isTop=true, topExpire=expire（默认7天后）
 * 4. 记录 moderation_logs：action='top', targetType='post'
 * 5. 返回 ok
 */
async function handleSetTop(event, context) {
  const { openid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.setTop'])

  const { postId } = event
  // 默认7天后过期
  const expire = event.expire || (Date.now() + DEFAULT_TOP_EXPIRE_MS)

  await db
    .collection('posts')
    .doc(postId)
    .update({
      data: {
        isTop: true,
        topExpire: expire,
        updatedAt: Date.now()
      }
    })

  await writeLog({
    action: 'top',
    targetType: 'post',
    targetId: postId,
    operatorOpenid: openid,
    detail: { expire }
  })

  return ok({ setTop: true })
}

/**
 * action: setEssence
 * 设置精华：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：postId
 * 3. 更新 posts：isEssence=true
 * 4. 记录 moderation_logs
 * 5. 返回 ok
 */
async function handleSetEssence(event, context) {
  const { openid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.setEssence'])

  const { postId } = event

  await db
    .collection('posts')
    .doc(postId)
    .update({
      data: {
        isEssence: true,
        updatedAt: Date.now()
      }
    })

  await writeLog({
    action: 'essence',
    targetType: 'post',
    targetId: postId,
    operatorOpenid: openid
  })

  return ok({ setEssence: true })
}

/**
 * action: hidePost
 * 隐藏帖子：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：postId / reason(可选)
 * 3. 更新 posts：status='hidden'
 * 4. 记录 moderation_logs：action='hide'
 * 5. 返回 ok
 */
async function handleHidePost(event, context) {
  const { openid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.hidePost'])

  const { postId, reason } = event

  await db
    .collection('posts')
    .doc(postId)
    .update({
      data: {
        status: 'hidden',
        updatedAt: Date.now()
      }
    })

  await writeLog({
    action: 'hide',
    targetType: 'post',
    targetId: postId,
    operatorOpenid: openid,
    reason
  })

  return ok({ hidden: true })
}

/**
 * action: deletePost
 * 删除帖子（软删除）：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：postId / reason(可选)
 * 3. 更新 posts：status='deleted'
 * 4. 同步标记关联明细 status='deleted'（如果有 refType/refId）
 * 5. 记录 moderation_logs：action='delete'
 * 6. 返回 ok
 */
async function handleDeletePost(event, context) {
  const { openid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.deletePost'])

  const { postId, reason } = event

  // ---- 查询帖子，获取 refType / refId ----
  let post = null
  try {
    const res = await db.collection('posts').doc(postId).get()
    post = res.data
  } catch (e) {
    post = null
  }
  if (!post) {
    return fail(ERRORS.NOT_FOUND, '帖子不存在')
  }

  // ---- 软删除帖子 ----
  await db
    .collection('posts')
    .doc(postId)
    .update({
      data: {
        status: 'deleted',
        updatedAt: Date.now()
      }
    })

  // ---- 如果关联了明细集合，同步标记删除 ----
  if (post.refType && post.refId) {
    try {
      await db
        .collection(post.refType)
        .doc(post.refId)
        .update({
          data: {
            status: 'deleted',
            updatedAt: Date.now()
          }
        })
    } catch (e) {
      // 明细同步删除失败不阻断主流程
      console.warn('[moderation.deletePost] 关联明细删除失败:', post.refType, post.refId, e)
    }
  }

  await writeLog({
    action: 'delete',
    targetType: 'post',
    targetId: postId,
    operatorOpenid: openid,
    reason
  })

  return ok({ deleted: true })
}

/**
 * action: banUser
 * 封禁用户：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：openid / reason(可选)
 * 3. 更新 users：status='banned'
 * 4. 记录 moderation_logs：action='ban', targetType='user'
 * 5. 返回 ok
 */
async function handleBanUser(event, context) {
  const { openid: operatorOpenid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.banUser'])

  const { openid, reason } = event

  // 不允许封禁自己
  if (openid === operatorOpenid) {
    return fail(ERRORS.PARAM_INVALID, '不能封禁自己')
  }

  // ---- 查询用户档案，按 _id 更新 ----
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  if (users.length === 0) {
    return fail(ERRORS.NOT_FOUND, '用户不存在')
  }

  await db
    .collection('users')
    .doc(users[0]._id)
    .update({
      data: {
        status: 'banned',
        updatedAt: Date.now()
      }
    })

  await writeLog({
    action: 'ban',
    targetType: 'user',
    targetId: openid,
    operatorOpenid: operatorOpenid,
    reason
  })

  return ok({ banned: true })
}

/**
 * action: muteUser
 * 禁言用户：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：openid / reason(可选)
 * 3. 更新 users：status='muted'
 * 4. 记录 moderation_logs
 * 5. 返回 ok
 */
async function handleMuteUser(event, context) {
  const { openid: operatorOpenid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.muteUser'])

  const { openid, reason } = event

  // 不允许禁言自己
  if (openid === operatorOpenid) {
    return fail(ERRORS.PARAM_INVALID, '不能禁言自己')
  }

  // ---- 查询用户档案，按 _id 更新 ----
  const { data: users } = await db
    .collection('users')
    .where({ openid })
    .limit(1)
    .get()
  if (users.length === 0) {
    return fail(ERRORS.NOT_FOUND, '用户不存在')
  }

  await db
    .collection('users')
    .doc(users[0]._id)
    .update({
      data: {
        status: 'muted',
        updatedAt: Date.now()
      }
    })

  await writeLog({
    action: 'mute',
    targetType: 'user',
    targetId: openid,
    operatorOpenid: operatorOpenid,
    reason
  })

  return ok({ muted: true })
}

/**
 * action: listReports
 * 举报列表：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：status(可选, 默认'pending') / page(默认1)
 * 3. 查询 reports 按 status 过滤，createdAt 降序分页
 * 4. 返回 { list, total, page, pageSize, hasMore }
 */
async function handleListReports(event, context) {
  await getAdminContext(context)
  validate(event, SCHEMAS['moderation.listReports'])

  const status = event.status || 'pending'
  const page = event.page || 1
  const pageSize = 20

  // 查询条件：按状态过滤
  const where = { status }

  const { total } = await db.collection('reports').where(where).count()

  const { data: list } = await db
    .collection('reports')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  })
}

/**
 * action: resolveReport
 * 处理举报：
 * 1. 鉴权：requireRole(['admin'])
 * 2. 参数校验：reportId / result
 * 3. 更新 reports：status='resolved', handler=当前openid, result, resolvedAt
 * 4. 记录 moderation_logs：action='resolveReport', targetType='report'
 * 5. 返回 ok
 */
async function handleResolveReport(event, context) {
  const { openid } = await getAdminContext(context)
  validate(event, SCHEMAS['moderation.resolveReport'])

  const { reportId, result } = event

  const now = Date.now()

  await db
    .collection('reports')
    .doc(reportId)
    .update({
      data: {
        status: 'resolved',
        handler: openid,
        result,
        resolvedAt: now
      }
    })

  await writeLog({
    action: 'resolveReport',
    targetType: 'report',
    targetId: reportId,
    operatorOpenid: openid,
    detail: { result }
  })

  return ok({ resolved: true })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'setTop':
      return handleSetTop(event, context)
    case 'setEssence':
      return handleSetEssence(event, context)
    case 'hidePost':
      return handleHidePost(event, context)
    case 'deletePost':
      return handleDeletePost(event, context)
    case 'banUser':
      return handleBanUser(event, context)
    case 'muteUser':
      return handleMuteUser(event, context)
    case 'listReports':
      return handleListReports(event, context)
    case 'resolveReport':
      return handleResolveReport(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
