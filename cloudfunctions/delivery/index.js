/**
 * 临里校园 - 跑腿代拿模块云函数
 * ------------------------------------------------------------
 * 提供发布跑腿任务、任务大厅、任务详情、接单、完成、取消等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - create          : 发布跑腿任务（事务同步 posts）
 *   - list            : 任务大厅（按 type 过滤分页）
 *   - detail          : 任务详情
 *   - accept          : 接单（需学生认证，不能接自己的任务）
 *   - startDelivering : 开始配送（接单人将状态从 accepted → delivering）
 *   - complete        : 完成任务（接单人发起→待确认，发布人确认→已完成）
 *   - cancel          : 取消任务（仅发布人，事务级联标记 posts 已删除）
 *
 * 涉及集合：delivery_tasks（明细）、posts（信息流主表）
 *
 * 设计原则：
 *   - posts 是信息流唯一主表，delivery_tasks 为从表
 *   - 发布时在同一事务内先写明细得 refId，再写 posts（refType='delivery'）
 *   - 单向引用 + 事务级联，避免双向脏数据
 *   - UGC 内容调用 contentCheck 审核
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
  requireVerified,
  validate,
  ok,
  fail,
  contentCheck,
  resolveCloudImages,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

/**
 * 读取学生认证功能是否开启
 * 从 config 集合读取 verifyEnabled 配置项
 * - 未配置记录时默认返回 true（安全默认值）
 * - 显式设为 false 时返回 false（关闭认证）
 * @returns {Promise<boolean>}
 */
async function isVerifyEnabled() {
  try {
    const { data } = await db
      .collection('config')
      .where({ key: 'verifyEnabled' })
      .limit(1)
      .get()
    if (data.length === 0) return false
    return data[0].value !== false
  } catch (e) {
    console.error('[delivery.isVerifyEnabled] 读取配置失败:', e)
    return false
  }
}

// 可取消的任务状态：待接单 / 已接单 / 配送中可由发布人取消
const CANCELABLE_STATUS = ['open', 'accepted', 'delivering']

/**
 * action: create
 * 发布跑腿任务（事务同步 posts）：
 * 1. 鉴权：requireLogin
 * 2. 参数：type / title / desc / pickup / drop / reward / deadline
 * 3. 内容安全审核：contentCheck(title + ' ' + desc)
 * 4. 查询用户档案获取 publisher 信息 { nickname, avatar, verifyBadge }
 * 5. 事务：
 *    a. 先写 delivery_tasks（postId 暂为空）
 *    b. 得到 taskId 后写 posts（refType='delivery', refId=taskId）
 *    c. 回写 delivery_tasks.postId = posts._id
 * 6. 返回 { taskId, postId }
 */
async function handleCreate(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.create'])

  const { type, title, desc, pickup, drop, reward, deadline } = event

  // ---- 内容安全审核：标题 + 描述 ----
  const textResult = await contentCheck(`${title} ${desc}`)
  if (!textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '任务内容包含违规信息，请修改后重试')
  }

  // ---- 查询用户档案，构造 publisher 冗余信息 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  // 封禁/禁言用户不可发布跑腿任务（此前仅拦截了发帖/评论，此处补齐）
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁')
  }
  if (user.status === 'muted') {
    return fail(ERRORS.OPERATION_FAILED, '账号已被禁言，暂时无法发布跑腿任务')
  }
  const publisher = {
    openid,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    verifyBadge: !!user.verifyBadge
  }

  const now = Date.now()

  // ---- 构造明细文档（postId 待事务内回写） ----
  const taskData = {
    _openid: openid,
    publisher,
    type,
    title,
    desc,
    pickup,
    drop,
    reward,
    deadline,
    status: 'open',
    acceptorId: '',
    postId: '',
    // 状态变更时间线，记录每次状态流转
    timeline: [{ status: 'open', time: now, operator: openid }],
    createdAt: now,
    updatedAt: now
  }

  // ---- 构造 posts 主表文档 ----
  const author = {
    nickname: publisher.nickname,
    avatar: publisher.avatar,
    verifyBadge: publisher.verifyBadge
  }
  const postData = {
    _openid: openid,
    authorId: openid,
    author,
    module: 'delivery',
    section: 'help',
    type: 'image',
    title,
    content: desc,
    contentNodes: [],
    images: [],
    tags: [],
    location: '',
    stats: { likes: 0, comments: 0, views: 0, shares: 0, favorites: 0 },
    isTop: false,
    topExpire: 0,
    isEssence: false,
    status: 'normal',
    secStatus: 'pass',
    sortTime: now,
    refType: 'delivery',
    refId: '',
    createdAt: now,
    updatedAt: now
  }

  // ---- 事务：先写明细得 taskId，再写 posts，最后回写 postId ----
  const { taskId, postId } = await db.runTransaction(async transaction => {
    // a. 写 delivery_tasks
    const taskRes = await transaction.collection('delivery_tasks').add({ data: taskData })
    const newTaskId = taskRes._id

    // b. 写 posts（refId 指向明细）
    postData.refId = newTaskId
    const postRes = await transaction.collection('posts').add({ data: postData })
    const newPostId = postRes._id

    // c. 回写 delivery_tasks.postId
    await transaction
      .collection('delivery_tasks')
      .doc(newTaskId)
      .update({ data: { postId: newPostId, updatedAt: now } })

    return { taskId: newTaskId, postId: newPostId }
  })

  return ok({ taskId, postId })
}

/**
 * action: list
 * 任务大厅：
 * 1. 鉴权：requireLogin
 * 2. 参数：type(可选), page(默认1), pageSize(默认20)
 * 3. 查询 delivery_tasks where status='open'，type 过滤（可选），createdAt 降序分页
 * 4. 返回 { list, total, page, hasMore }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.list'])

  const page = event.page || 1
  const pageSize = event.pageSize || 20

  // 查询条件：待接单任务
  const where = { status: 'open' }
  if (event.type) {
    where.type = event.type
  }

  // 查询总数
  const { total } = await db.collection('delivery_tasks').where(where).count()

  // 分页查询：按创建时间降序
  const { data: list } = await db
    .collection('delivery_tasks')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 批量转换所有 cloud:// 图片（发布人头像 + 任务图片）为 HTTPS 临时链接 ----
  await resolveCloudImages(list)

  // ---- 列表脱敏：不返回 openid（发布者身份标识）----
  list.forEach((item) => {
    delete item._openid
    if (item.publisher && typeof item.publisher === 'object') {
      delete item.publisher.openid
      delete item.publisher._openid
    }
  })

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total
  })
}

/**
 * action: detail
 * 任务详情：
 * 1. 鉴权：requireLogin
 * 2. 参数：taskId(required)
 * 3. 查询 delivery_tasks doc(taskId)
 * 4. 返回详情
 */
async function handleDetail(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.detail'])
  const { taskId } = event

  // ---- 查询任务 ----
  let task = null
  try {
    const res = await db.collection('delivery_tasks').doc(taskId).get()
    task = res.data
  } catch (e) {
    task = null
  }
  if (!task) {
    return fail(ERRORS.NOT_FOUND, '任务不存在')
  }

  // ---- 批量转换所有 cloud:// 图片（发布人头像 + 任务图片）为 HTTPS 临时链接 ----
  await resolveCloudImages(task)

  // ---- 安全脱敏：不返回 openid，由服务端返回权威身份字段 ----
  const safeTask = { ...task }
  delete safeTask._openid
  delete safeTask.acceptorId
  if (safeTask.publisher && typeof safeTask.publisher === 'object') {
    delete safeTask.publisher.openid
    delete safeTask.publisher._openid
    // 补充发布者内部用户 ID（users._id），供前端跳转主页/标识使用
    try {
      const { data: pubUsers } = await db
        .collection('users')
        .where({ openid: task._openid })
        .limit(1)
        .get()
      if (pubUsers[0]) safeTask.publisher.userId = pubUsers[0]._id
    } catch (e) {
      console.warn('[delivery.detail] 查询发布者 userId 失败:', e.message)
    }
  }
  // 是否发布人 / 是否接单人（服务端基于 openid 判断，前端不再依赖他人 openid）
  safeTask.isPublisher = task._openid === openid
  safeTask.isAcceptor = !!task.acceptorId && task.acceptorId === openid

  return ok(safeTask)
}

/**
 * action: accept
 * 接单：
 * 1. 鉴权：requireLogin
 * 2. 参数：taskId(required)
 * 3. 验证学生认证
 * 4. 验证任务 status='open'
 * 5. 不能接自己的任务
 * 6. 更新 status='accepted', acceptorId=当前openid
 * 7. 返回 ok
 */
async function handleAccept(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.accept'])
  const { taskId } = event

  // ---- 验证学生认证（认证功能关闭时跳过）----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  const verifyEnabled = await isVerifyEnabled()
  if (verifyEnabled) {
    requireVerified(user)
  }

  // ---- 查询任务 ----
  let task = null
  try {
    const res = await db.collection('delivery_tasks').doc(taskId).get()
    task = res.data
  } catch (e) {
    task = null
  }
  if (!task) {
    return fail(ERRORS.NOT_FOUND, '任务不存在')
  }

  // ---- 状态校验：仅待接单可接 ----
  if (task.status !== 'open') {
    return fail(ERRORS.OPERATION_FAILED, '任务已被接取或已结束')
  }

  // ---- 不能接自己发布的任务 ----
  if (task._openid === openid) {
    return fail(ERRORS.OPERATION_FAILED, '不能接自己发布的任务')
  }

  const now = Date.now()
  // ---- 更新任务状态与接单人 ----
  await db
    .collection('delivery_tasks')
    .doc(taskId)
    .update({
      data: {
        status: 'accepted',
        acceptorId: openid,
        timeline: _.push({ status: 'accepted', time: now, operator: openid }),
        updatedAt: now
      }
    })

  // ---- 创建通知给发布人（不给自己发通知）----
  try {
    const publisherId = task._openid
    if (publisherId && publisherId !== openid) {
      const nickname = (user && user.nickname) || '有人'
      const avatar = (user && user.avatar) || ''
      await db.collection('notifications').add({
        data: {
          _openid: publisherId,
          type: 'order',
          title: `${nickname} 接取了你的跑腿任务`,
          body: (task.title || '').slice(0, 50),
          refType: 'delivery',
          refId: taskId,
          senderId: openid,
          senderName: nickname,
          senderAvatar: avatar,
          read: false,
          createdAt: Date.now()
        }
      })
    }
  } catch (e) {
    console.warn('[delivery.accept] 创建通知失败:', e.message)
  }

  return ok({ accepted: true })
}

/**
 * action: startDelivering
 * 开始配送（接单人操作）：
 * 1. 鉴权：requireLogin
 * 2. 参数：taskId(required)
 * 3. 权限校验：仅接单人（acceptorId === openid）可操作
 * 4. 状态校验：仅 accepted 可转为 delivering
 * 5. 更新 status='delivering'，追加 timeline
 * 6. 通知发布人"接单人已开始配送"
 */
async function handleStartDelivering(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.startDelivering'])
  const { taskId } = event

  // ---- 查询任务 ----
  let task = null
  try {
    const res = await db.collection('delivery_tasks').doc(taskId).get()
    task = res.data
  } catch (e) {
    task = null
  }
  if (!task) {
    return fail(ERRORS.NOT_FOUND, '任务不存在')
  }

  // ---- 权限校验：仅接单人可操作 ----
  if (task.acceptorId !== openid) {
    return fail(ERRORS.FORBIDDEN, '无权操作此任务')
  }

  // ---- 状态校验：仅已接单可转为配送中 ----
  if (task.status !== 'accepted') {
    return fail(ERRORS.OPERATION_FAILED, '当前任务状态不可开始配送')
  }

  const now = Date.now()
  // ---- 更新任务状态为配送中 ----
  await db
    .collection('delivery_tasks')
    .doc(taskId)
    .update({
      data: {
        status: 'delivering',
        timeline: _.push({ status: 'delivering', time: now, operator: openid }),
        updatedAt: now
      }
    })

  // ---- 通知发布人：接单人已开始配送 ----
  try {
    const publisherId = task._openid
    if (publisherId && publisherId !== openid) {
      const user = await getUser(openid)
      const nickname = (user && user.nickname) || '接单人'
      const avatar = (user && user.avatar) || ''
      await db.collection('notifications').add({
        data: {
          _openid: publisherId,
          type: 'order',
          title: `${nickname} 已开始配送你的跑腿任务`,
          body: (task.title || '').slice(0, 50),
          refType: 'delivery',
          refId: taskId,
          senderId: openid,
          senderName: nickname,
          senderAvatar: avatar,
          read: false,
          createdAt: Date.now()
        }
      })
    }
  } catch (e) {
    console.warn('[delivery.startDelivering] 创建通知失败:', e.message)
  }

  return ok({ started: true })
}

/**
 * action: complete
 * 完成任务（两步确认机制）：
 * 1. 鉴权：requireLogin
 * 2. 参数：taskId(required)
 * 3. 接单人调用：仅 delivering 状态可操作 → 更新 status='pending_confirm'，通知发布人确认
 * 4. 发布人调用：仅 pending_confirm 状态可操作 → 更新 status='done'，通知接单人，同步 posts
 * 5. 返回 ok
 */
async function handleComplete(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.complete'])
  const { taskId } = event

  // ---- 查询任务 ----
  let task = null
  try {
    const res = await db.collection('delivery_tasks').doc(taskId).get()
    task = res.data
  } catch (e) {
    task = null
  }
  if (!task) {
    return fail(ERRORS.NOT_FOUND, '任务不存在')
  }

  // ---- 判断调用者身份 ----
  const isAcceptor = task.acceptorId === openid
  const isPublisher = task._openid === openid
  if (!isAcceptor && !isPublisher) {
    return fail(ERRORS.FORBIDDEN, '无权完成该任务')
  }

  const now = Date.now()

  // ---- 接单人发起完成请求：delivering → pending_confirm ----
  if (isAcceptor) {
    if (task.status !== 'delivering') {
      return fail(ERRORS.OPERATION_FAILED, '仅配送中的任务可发起完成请求')
    }
    await db
      .collection('delivery_tasks')
      .doc(taskId)
      .update({
        data: {
          status: 'pending_confirm',
          timeline: _.push({ status: 'pending_confirm', time: now, operator: openid }),
          updatedAt: now
        }
      })

    // 通知发布人确认
    try {
      const publisherId = task._openid
      if (publisherId && publisherId !== openid) {
        const user = await getUser(openid)
        const nickname = (user && user.nickname) || '接单人'
        const avatar = (user && user.avatar) || ''
        await db.collection('notifications').add({
          data: {
            _openid: publisherId,
            type: 'order',
            title: '接单人已完成配送，请确认',
            body: (task.title || '').slice(0, 50),
            refType: 'delivery',
            refId: taskId,
            senderId: openid,
            senderName: nickname,
            senderAvatar: avatar,
            read: false,
            createdAt: Date.now()
          }
        })
      }
    } catch (e) {
      console.warn('[delivery.complete] 通知发布人失败:', e.message)
    }

    return ok({ pendingConfirm: true })
  }

  // ---- 发布人确认完成：pending_confirm → done ----
  // isPublisher 分支
  if (task.status !== 'pending_confirm') {
    return fail(ERRORS.OPERATION_FAILED, '当前任务状态不可确认完成')
  }

  await db
    .collection('delivery_tasks')
    .doc(taskId)
    .update({
      data: {
        status: 'done',
        timeline: _.push({ status: 'done', time: now, operator: openid }),
        updatedAt: now
      }
    })

  // ---- 同步标记 posts 为已删除（已完成任务不再展示在信息流） ----
  if (task.postId) {
    try {
      await db
        .collection('posts')
        .doc(task.postId)
        .update({
          data: {
            status: 'deleted',
            updatedAt: now
          }
        })
    } catch (e) {
      // posts 同步失败不阻断主流程
      console.warn('[delivery.complete] 同步 posts 状态失败:', task.postId, e)
    }
  }

  // 通知接单人：发布人已确认完成
  try {
    const acceptorId = task.acceptorId
    if (acceptorId && acceptorId !== openid) {
      const user = await getUser(openid)
      const nickname = (user && user.nickname) || '发布人'
      const avatar = (user && user.avatar) || ''
      await db.collection('notifications').add({
        data: {
          _openid: acceptorId,
          type: 'order',
          title: '发布人已确认完成，任务结束',
          body: (task.title || '').slice(0, 50),
          refType: 'delivery',
          refId: taskId,
          senderId: openid,
          senderName: nickname,
          senderAvatar: avatar,
          read: false,
          createdAt: Date.now()
        }
      })
    }
  } catch (e) {
    console.warn('[delivery.complete] 通知接单人失败:', e.message)
  }

  return ok({ completed: true })
}

/**
 * action: cancel
 * 取消任务：
 * 1. 鉴权：requireLogin
 * 2. 参数：taskId(required)
 * 3. 验证 _openid === 当前openid（发布人）
 * 4. 只有 open/accepted 状态可取消
 * 5. 事务：更新 delivery_tasks.status='cancelled'，同步标记 posts.status='deleted'
 * 6. 返回 ok
 */
async function handleCancel(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['delivery.cancel'])
  const { taskId } = event

  // ---- 查询任务 ----
  let task = null
  try {
    const res = await db.collection('delivery_tasks').doc(taskId).get()
    task = res.data
  } catch (e) {
    task = null
  }
  if (!task) {
    return fail(ERRORS.NOT_FOUND, '任务不存在')
  }

  // ---- 权限校验：仅发布人可取消 ----
  if (task._openid !== openid) {
    return fail(ERRORS.FORBIDDEN, '无权取消他人任务')
  }

  // ---- 状态校验：仅待接单/已接单可取消 ----
  if (!CANCELABLE_STATUS.includes(task.status)) {
    return fail(ERRORS.OPERATION_FAILED, '当前任务状态不可取消')
  }

  const now = Date.now()
  // ---- 事务：明细置为 cancelled，关联 posts 置为 deleted ----
  await db.runTransaction(async transaction => {
    await transaction
      .collection('delivery_tasks')
      .doc(taskId)
      .update({
        data: {
          status: 'cancelled',
          timeline: _.push({ status: 'cancelled', time: now, operator: openid }),
          updatedAt: now
        }
      })

    // 关联帖子存在则同步标记删除
    if (task.postId) {
      await transaction
        .collection('posts')
        .doc(task.postId)
        .update({
          data: {
            status: 'deleted',
            updatedAt: now
          }
        })
    }
  })

  return ok({ cancelled: true })
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
    case 'detail':
      return handleDetail(event, context)
    case 'accept':
      return handleAccept(event, context)
    case 'startDelivering':
      return handleStartDelivering(event, context)
    case 'complete':
      return handleComplete(event, context)
    case 'cancel':
      return handleCancel(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
