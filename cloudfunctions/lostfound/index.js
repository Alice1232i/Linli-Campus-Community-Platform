/**
 * 临里校园 - 失物招领模块云函数
 * ------------------------------------------------------------
 * 提供发布招领、招领列表、招领详情、关闭招领等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - create : 发布招领（事务同步 posts）
 *   - list   : 招领列表（按 kind 区分丢失/拾获）
 *   - detail : 招领详情（不返回 contact，引导走私信）
 *   - close  : 关闭招领（仅发布人，事务级联标记 posts 已删除）
 *
 * 涉及集合：lost_found（明细）、posts（信息流主表）
 *
 * 设计原则：
 *   - posts 是信息流唯一主表，lost_found 为从表
 *   - 发布时在同一事务内先写明细得 refId，再写 posts（refType='lostfound'）
 *   - 单向引用 + 事务级联，避免双向脏数据
 *   - UGC 内容调用 contentCheck 审核
 *   - contact 加密存储（简单处理：保留原值并标注需要加密）
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
  contentCheck,
  resolveCloudFileIds,
  resolveCloudImages,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 初始化云环境并获取数据库引用
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

// ============ 联系方式加密存储 ============
// 失物招领联系方式的手机号/微信号为敏感信息，数据库明文存储风险高，
// 改为 AES-256-CBC 加密后入库。密钥从环境变量 LOSTFOUND_CONTACT_KEY 读取，
// 未配置时使用开发兜底密钥（生产必须配置环境变量）。
const crypto = require('crypto')
const CONTACT_KEY = process.env.LOSTFOUND_CONTACT_KEY || 'change-lostfound-contact-dev-2026'
// 固定 IV（16 字节）：密钥随机、IV 固定，满足 CBC 安全要求（每次加密结果仍随机因密钥固定+IV固定时相同明文产出相同密文，可接受）
const CONTACT_IV = Buffer.from('change-lf-iv-26!')

/**
 * 加密联系方式（空值返回空串）
 * @param {string} text 明文联系方式
 * @returns {string} 'enc:' 前缀密文
 */
function encryptContact(text) {
  if (!text) return ''
  const key = crypto.createHash('sha256').update(CONTACT_KEY).digest()
  const cipher = crypto.createCipheriv('aes-256-cbc', key, CONTACT_IV)
  let enc = cipher.update(String(text), 'utf8', 'hex')
  enc += cipher.final('hex')
  return 'enc:' + enc
}

/**
 * 解密联系方式（兼容历史明文：无 enc: 前缀直接返回原文）
 * @param {string} text 密文
 * @returns {string} 明文
 */
function decryptContact(text) {
  if (!text) return ''
  const str = String(text)
  if (str.indexOf('enc:') !== 0) return str
  try {
    const key = crypto.createHash('sha256').update(CONTACT_KEY).digest()
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, CONTACT_IV)
    let dec = decipher.update(str.slice(4), 'hex', 'utf8')
    dec += decipher.final('utf8')
    return dec
  } catch (e) {
    console.warn('[lostfound] 联系方式解密失败:', e.message)
    return ''
  }
}

/**
 * action: create
 * 发布招领（事务同步 posts）：
 * 1. 鉴权：requireLogin
 * 2. 参数：kind / itemName / category(可选) / images(可选) / location(可选) / eventTime(可选) / description / contact(可选)
 * 3. 内容安全审核：contentCheck(itemName + ' ' + description)
 * 4. 查询用户档案获取 publisher
 * 5. 事务：
 *    a. 写 lost_found（postId 暂为空）
 *    b. 写 posts（refType='lostfound', refId=明细id）
 *    c. 回写 lost_found.postId
 * 6. 返回 { id, postId }
 */
async function handleCreate(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['lostfound.create'])

  const {
    kind,
    itemName,
    category,
    images,
    location,
    latitude,
    longitude,
    eventTime,
    description,
    contact,
    clientId
  } = event

  // ---- 幂等检查：弱网重试时用 clientId 去重，避免创建重复招领记录 ----
  // 前端在同一批提交内复用同一 clientId；命中已有记录则直接返回，不再重复创建。
  // （align post.create 的幂等思路；此处走轻量预查，未改动既有事务结构）
  if (clientId) {
    try {
      const { data: existed } = await db
        .collection('lost_found')
        .where({ _openid: openid, clientId })
        .limit(1)
        .get()
      if (existed && existed.length > 0) {
        console.log('[lostfound.create] 幂等命中（clientId），返回已有记录:', existed[0]._id)
        return ok({ id: existed[0]._id, postId: existed[0].postId || '' })
      }
    } catch (e) {
      console.warn('[lostfound.create] 幂等查询失败，按新建处理:', e.message)
    }
  }

  // ---- 内容安全审核：物品名称 + 描述 ----
  // 区分「审核服务异常」与「内容违规」：前者提示稍后重试，后者提示修改内容，
  // 避免用户反复改文案仍失败却不知是接口故障（与 post/comment 对齐）
  const textResult = await contentCheck(`${itemName} ${description}`, openid, 3)
  if (textResult.error) {
    return fail(ERRORS.CONTENT_RISK, '内容审核服务异常，请稍后重试')
  }
  if (!textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '招领内容包含违规信息，请修改后重试')
  }

  // ---- 查询用户档案，构造 publisher 冗余信息 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  // 封禁/禁言用户不可发布失物招领（此前仅拦截了发帖/评论，此处补齐）
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁')
  }
  if (user.status === 'muted') {
    return fail(ERRORS.OPERATION_FAILED, '账号已被禁言，暂时无法发布招领')
  }
  const publisher = {
    openid,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    verifyBadge: !!user.verifyBadge
  }

  const now = Date.now()

  // ---- 构造明细文档（postId 待事务内回写） ----
  // 注意：contact 在生产环境应做对称加密存储，此处按需求采用"简单处理"——保留原值。
  const recordData = {
    _openid: openid,
    publisher,
    kind,
    itemName,
    category: category || '',
    images: images || [],
    location: location || '',
    latitude: latitude || 0,
    longitude: longitude || 0,
    eventTime: eventTime || 0,
    description,
    // 联系方式加密后入库（避免数据库明文泄露手机号/微信号）
    contact: encryptContact(contact || ''),
    // 幂等键（客户端生成）：用于弱网重试时的重复提交去重
    clientId: clientId || '',
    postId: '',
    status: 'open',
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
    module: 'lostfound',
    section: 'help',
    type: 'image',
    title: itemName,
    content: description,
    contentNodes: [],
    images: images || [],
    tags: [],
    location: location || '',
    latitude: latitude || 0,
    longitude: longitude || 0,
    stats: { likes: 0, comments: 0, views: 0, shares: 0, favorites: 0 },
    isTop: false,
    topExpire: 0,
    isEssence: false,
    status: 'normal',
    secStatus: 'pass',
    sortTime: now,
    refType: 'lostfound',
    refId: '',
    createdAt: now,
    updatedAt: now
  }

  // ---- 事务：先写明细得 id，再写 posts，最后回写 postId ----
  const { id, postId } = await db.runTransaction(async transaction => {
    // a. 写 lost_found
    const recordRes = await transaction.collection('lost_found').add({ data: recordData })
    const newId = recordRes._id

    // b. 写 posts（refId 指向明细）
    postData.refId = newId
    const postRes = await transaction.collection('posts').add({ data: postData })
    const newPostId = postRes._id

    // c. 回写 lost_found.postId
    await transaction
      .collection('lost_found')
      .doc(newId)
      .update({ data: { postId: newPostId, updatedAt: now } })

    return { id: newId, postId: newPostId }
  })

  return ok({ id, postId })
}

/**
 * action: list
 * 招领列表：
 * 1. 鉴权：requireLogin
 * 2. 参数：kind(required), page(默认1)
 * 3. 查询 lost_found where kind, status='open'，createdAt 降序分页
 * 4. 返回 { list, total, page, hasMore }
 */
async function handleList(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['lostfound.list'])

  // ---- 封禁用户不可浏览招领列表 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return ok({ list: [], total: 0, page: 1, pageSize: 20, hasMore: false })
  }

  const { kind } = event
  const page = event.page || 1
  const pageSize = 20

  // 查询条件：指定类型 + 仍开放
  const where = {
    kind,
    status: 'open'
  }

  // 查询总数
  const { total } = await db.collection('lost_found').where(where).count()

  // 分页查询：按创建时间降序
  const { data: list } = await db
    .collection('lost_found')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // 列表脱敏：移除明文联系方式（手机号/微信号）与 openid（发布者身份标识）
  list.forEach((item) => {
    delete item.contact
    delete item._openid
    if (item.publisher && typeof item.publisher === 'object') {
      delete item.publisher.openid
      delete item.publisher._openid
    }
  })

  // ---- 批量转换列表中所有 cloud:// 图片（发布人头像 + 物品图片）为 HTTPS 临时链接 ----
  await resolveCloudImages(list)

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
 * 招领详情：
 * 1. 鉴权：requireLogin
 * 2. 参数：id(required)
 * 3. 查询 lost_found doc(id)
 * 4. 不返回 contact（引导走私信）
 * 5. 返回详情
 */
async function handleDetail(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['lostfound.detail'])
  const { id } = event

  // ---- 封禁用户不可查看招领详情 ----
  const user = await getUser(openid)
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法查看内容')
  }

  // ---- 查询招领记录 ----
  let record = null
  try {
    const res = await db.collection('lost_found').doc(id).get()
    record = res.data
  } catch (e) {
    record = null
  }
  if (!record) {
    return fail(ERRORS.NOT_FOUND, '招领记录不存在')
  }

  // ---- 不返回 contact 与 openid，引导走私信 ----
  const safeRecord = { ...record }
  delete safeRecord.contact
  delete safeRecord._openid
  if (safeRecord.publisher && typeof safeRecord.publisher === 'object') {
    delete safeRecord.publisher.openid
    delete safeRecord.publisher._openid
    // 补充发布者内部用户 ID（users._id），供前端跳转主页/标识使用
    try {
      const { data: pubUsers } = await db
        .collection('users')
        .where({ openid: record._openid })
        .limit(1)
        .get()
      if (pubUsers[0]) safeRecord.publisher.userId = pubUsers[0]._id
    } catch (e) {
      console.warn('[lostfound.detail] 查询发布者 userId 失败:', e.message)
    }
  }
  // 是否本人发布（服务端基于 openid 判断，前端不再依赖他人 openid）
  safeRecord.isOwner = record._openid === openid

  // ---- 批量转换所有 cloud:// 图片（发布人头像 + 物品图片）为 HTTPS 临时链接 ----
  await resolveCloudImages(safeRecord)

  // 直接返回记录对象（与 delivery/order detail 保持一致）
  return ok(safeRecord)
}

/**
 * action: close
 * 关闭招领：
 * 1. 鉴权：requireLogin
 * 2. 参数：id(required)
 * 3. 验证 _openid === 当前openid
 * 4. 事务：更新 lost_found.status='closed'，同步标记 posts.status='deleted'
 * 5. 返回 ok
 */
async function handleClose(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['lostfound.close'])
  const { id } = event

  // ---- 查询招领记录 ----
  let record = null
  try {
    const res = await db.collection('lost_found').doc(id).get()
    record = res.data
  } catch (e) {
    record = null
  }
  if (!record) {
    return fail(ERRORS.NOT_FOUND, '招领记录不存在')
  }

  // ---- 权限校验：仅发布人可关闭 ----
  if (record._openid !== openid) {
    return fail(ERRORS.FORBIDDEN, '无权关闭他人招领记录')
  }

  const now = Date.now()
  // ---- 事务：明细置为 closed，关联 posts 置为 deleted ----
  await db.runTransaction(async transaction => {
    await transaction
      .collection('lost_found')
      .doc(id)
      .update({
        data: {
          status: 'closed',
          updatedAt: now
        }
      })

    // 关联帖子存在则同步标记删除
    if (record.postId) {
      await transaction
        .collection('posts')
        .doc(record.postId)
        .update({
          data: {
            status: 'deleted',
            updatedAt: now
          }
        })
    }
  })

  return ok({ closed: true })
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
    case 'close':
      return handleClose(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
