/**
 * 临里校园 - 帖子模块云函数
 * ------------------------------------------------------------
 * 提供发帖、信息流分页、帖子详情、删除帖子、我的帖子、他人帖子等能力。
 * 通过 event.action 做子路由，统一使用 shared/guard.js 的 run 包装器
 * 处理鉴权、参数校验、异常捕获与统一响应格式。
 *
 * 支持的 action：
 *   - create    : 发帖（需登录 + 学生认证 + 内容安全审核）
 *   - feed      : 信息流分页（排除被拉黑用户的帖子）
 *   - detail    : 帖子详情（自动增加浏览数）
 *   - delete    : 删除帖子（仅作者或管理员）
 *   - myPosts   : 我的帖子列表
 *   - userPosts : 他人帖子列表
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
  resolveCloudFileIds,
  requireLogin,
  validate,
  ok,
  fail,
  contentCheck,
  imageCheck,
  getBannedOpenids,
  checkSearchRateLimit,
  SCHEMAS,
  ERRORS
} = require('./shared/guard')

// 引入板块枚举常量，用于 section 合法性校验；MODULES 用于「我的帖子」内容类型筛选
const { SECTIONS, MODULES } = require('./shared/constants')

// 初始化云环境并获取数据库引用
// 注意：initCloud() 返回 wx-server-sdk 实例，不可直接使用未定义的 cloud 变量
const cloud = initCloud()
const db = cloud.database()
const _ = db.command

// ============ 浏览数防刷缓存（容器级内存缓存）============
// 同一用户 + 同一帖子 5 分钟内只计一次浏览，防止刷新刷量
const _viewDedupCache = new Map()
const VIEW_DEDUP_TTL = 5 * 60 * 1000

/**
 * 判断是否应计入浏览数
 * 同一用户对同一帖子在 TTL 内只允许计一次
 * @param {string} openid 用户 openid
 * @param {string} postId 帖子 ID
 * @returns {boolean} true=应计数，false=已被去重
 */
function shouldCountView(openid, postId) {
  const key = openid + '_' + postId
  if (_viewDedupCache.has(key)) {
    return false
  }
  _viewDedupCache.set(key, Date.now())
  // 缓存超过 10000 条时清理过期项，防止内存泄漏
  if (_viewDedupCache.size > 10000) {
    const now = Date.now()
    for (const [k, t] of _viewDedupCache) {
      if (now - t > VIEW_DEDUP_TTL) {
        _viewDedupCache.delete(k)
      }
    }
  }
  return true
}

/**
 * 批量将帖子列表中的 cloud:// 图片 fileID 转换为 HTTP 临时 URL
 * 确保其他用户不受云存储安全规则限制，均能正常加载帖子图片。
 * 原地修改帖子对象的 images 数组。
 * @param {Array} list 帖子列表
 * @returns {Promise<void>}
 */
async function resolvePostImages(list) {
  if (!list || !list.length) return
  // 收集所有 cloud:// 图片 fileID
  const fileIds = []
  list.forEach((post) => {
    if (post.images && Array.isArray(post.images)) {
      post.images.forEach((url) => {
        if (url && url.indexOf('cloud://') === 0) {
          fileIds.push(url)
        }
      })
    }
  })
  if (!fileIds.length) return
  // 批量转换为 HTTP 临时 URL
  const urlMap = await resolveCloudFileIds(fileIds)
  // 替换帖子中的 cloud:// fileID 为 HTTP URL
  list.forEach((post) => {
    if (post.images && Array.isArray(post.images)) {
      post.images = post.images.map((url) => {
        return urlMap[url] || url
      })
    }
  })
}

/**
 * 批量填充帖子列表的 liked 状态（当前用户是否已点赞）
 * 一次性查询 likes 集合，避免前端逐条或额外 API 调用
 * @param {Array} list 帖子列表
 * @param {string} openid 当前用户 openid
 * @returns {Promise<Array>} 填充 liked 字段后的列表（原地修改并返回）
 */
async function batchFillLikedStatus(list, openid) {
  if (!list || !list.length || !openid) return list
  // 收集所有帖子 ID
  const postIds = []
  list.forEach((post) => {
    if (post._id) postIds.push(post._id)
  })
  if (!postIds.length) return list

  try {
    // 批量查询当前用户已点赞的帖子
    const { data: likedRecords } = await db
      .collection('likes')
      .where({
        _openid: openid,
        targetId: _.in(postIds),
        targetType: 'post'
      })
      .field({ targetId: true })
      .get()

    // 构造已点赞 ID 集合
    const likedSet = {}
    likedRecords.forEach((r) => {
      likedSet[r.targetId] = true
    })

    // 为每个帖子添加 liked 字段
    list.forEach((post) => {
      post.liked = !!likedSet[post._id]
    })
  } catch (e) {
    console.warn('[post.batchFillLikedStatus] 查询点赞状态失败:', e.message)
    // 查询失败时默认未点赞，不影响列表展示
    list.forEach((post) => {
      if (!post.liked) post.liked = false
    })
  }

  return list
}

/**
 * 读取学生认证功能是否开启
 * 从 config 集合读取 verifyEnabled 配置项
 * - 未配置记录时默认返回 false（关闭认证）
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
    console.error('[post.isVerifyEnabled] 读取配置失败:', e)
    return false
  }
}

/**
 * 生成随机匿名昵称
 * 格式："匿名同学" + 4 位随机字母/数字，同一帖子固定不变（存入 anonymousName 字段）
 * @returns {string} 匿名昵称，如 "匿名同学a3x9"
 */
function genAnonymousName() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  var suffix = ''
  for (var i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return '匿名同学' + suffix
}

/**
 * 图片安全审核（先审后发，同步执行）
 * 供 create / update 复用，防止「先发合规图、再编辑换成违规图」绕过审核。
 * 并行下载 + imageCheck：单张下载失败时保守放行（避免存储/openapi 故障误杀正常图），
 * 但只要 imgSecCheck 判定违规（pass=false）即视为不通过。
 * @param {Array<string>} images cloud:// 文件 ID 列表
 * @param {string} tag 日志标签，用于区分调用来源（post.create / post.update）
 * @returns {Promise<boolean>} true=全部通过
 */
async function auditImages(images, tag) {
  if (!images || !Array.isArray(images) || images.length === 0) return true
  const imgResults = await Promise.all(images.map(async (fileID) => {
    try {
      const { fileContent } = await cloud.downloadFile({ fileID })
      const imgResult = await imageCheck(fileContent)
      return imgResult.pass
    } catch (e) {
      console.warn('[' + tag + '] 单张图片审核失败，保守放行:', fileID, e.message)
      return true
    }
  }))
  return imgResults.indexOf(false) === -1
}

/**
 * action: create
 * 发帖流程（并行优化版）：
 * 1. 鉴权 + 同步参数校验（section/tags/tradeInfo/images 归属）
 * 2. 并行执行：文本审核(msgSecCheck) + clientId 去重 + 频率限制 + 用户档案 + 认证配置
 * 3. 依次检查并行结果：幂等命中 → 频率限制 → 文本审核 → 用户状态 → 认证
 * 4. 创建 posts 文档
 * 5. 图片安全审核（先审后发，同步执行确保审核完成）
 * 6. 返回 { postId }
 *
 * 性能：原串行 4 次 DB + 1 次 API ≈ 2-4 秒，并行后 ≈ 1-2 秒
 * 确保即使云函数使用默认 3 秒超时也能在窗口内完成
 */
async function handleCreate(event, context) {
  const openid = requireLogin(getOpenid(context))
  // 基础参数校验
  validate(event, SCHEMAS['post.create'])

  const {
    section,
    title,
    content,
    images,
    tags,
    location,
    tradeInfo,
    isAnonymous,
    clientId
  } = event

  // ---- 同步参数校验（快速失败，不涉及 IO）----

  // section 枚举校验：拒绝非法板块标识，防止数据污染
  const validSectionKeys = SECTIONS.map(s => s.key)
  if (validSectionKeys.indexOf(section) === -1) {
    return fail(ERRORS.PARAM_INVALID, '板块标识不合法')
  }

  // tags 元素校验：每个标签必须是字符串且长度不超过 20
  if (tags && Array.isArray(tags)) {
    for (var i = 0; i < tags.length; i++) {
      if (typeof tags[i] !== 'string' || tags[i].length > 20) {
        return fail(ERRORS.PARAM_INVALID, '标签格式不合法')
      }
    }
  }

  // tradeInfo 结构校验：仅 secondhand 板块允许携带
  if (tradeInfo) {
    if (section !== 'secondhand') {
      return fail(ERRORS.PARAM_INVALID, '非二手板块不允许携带交易信息')
    }
    if (typeof tradeInfo.price !== 'number' || isNaN(tradeInfo.price) || tradeInfo.price < 0) {
      return fail(ERRORS.PARAM_INVALID, '价格格式不合法')
    }
    if (tradeInfo.condition && typeof tradeInfo.condition !== 'string') {
      return fail(ERRORS.PARAM_INVALID, '成色格式不合法')
    }
    if (tradeInfo.tradeType && ['sell', 'buy'].indexOf(tradeInfo.tradeType) === -1) {
      return fail(ERRORS.PARAM_INVALID, '交易类型不合法')
    }
  }

  // 图片格式校验（归属校验依赖用户档案里的 uploadKey，见下方 Promise.all 之后）
  if (images && Array.isArray(images) && images.length > 0) {
    for (const fileID of images) {
      if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) {
        return fail(ERRORS.PARAM_INVALID, '图片地址格式不合法')
      }
    }
  }

  // ---- 并行执行：文本审核 + 4 次 DB 查询 ----
  // 原串行执行耗时 ~2-4 秒（4 次 DB 查询 + 1 次 msgSecCheck API 调用）
  // 并行后总耗时降为 max(文本审核~1-2s, DB 查询~200-500ms) ≈ 1-2 秒
  // 确保即使云函数使用默认 3 秒超时也能在窗口内完成发帖
  const oneMinAgo = Date.now() - 60 * 1000

  const [textResult, recentRes, user, verifyEnabled] = await Promise.all([
    // 文本审核（msgSecCheck v2，scene=3 论坛）：标题/正文/标签一起审核，防止违规内容经标题或标签绕过
    // catch 包装防止审核异常导致 Promise.all 整体 reject
    contentCheck([title, content].concat(tags || []).filter(Boolean).join(' '), openid, 3).catch(function(e) {
      console.error('[post.create] 文本安全检测调用失败:', e.message)
      return { error: e.message }
    }),
    // 发帖频率限制：60 秒内仅允许发一帖，防止刷屏
    db.collection('posts').where({ authorId: openid, createdAt: _.gt(oneMinAgo) }).limit(1).field({ _id: true }).get(),
    // 用户档案（用于状态检查和认证检查）
    getUser(openid),
    // 学生认证功能是否开启
    isVerifyEnabled()
  ])

  // ---- 图片归属校验 ----
  // 上传路径规则（见 miniprogram/utils/upload.js genCloudPath）：
  //   新格式 upload/{uploadKey}/... —— uploadKey 为用户随机的上传归属键，
  //                                    不再把 openid 写进存储路径
  //   旧格式 upload/{openid}/...    —— 历史图片，继续接受以兼容编辑老帖
  // 两者取并集：既让 openid 不再出现在新路径与客户端，又不影响存量数据
  if (images && Array.isArray(images) && images.length > 0) {
    const ownerKeys = [openid]
    if (user && user.uploadKey) ownerKeys.push(user.uploadKey)
    for (const fileID of images) {
      const owned = ownerKeys.some((key) => key && fileID.indexOf(key) !== -1)
      if (!owned) {
        console.warn('[post.create] 图片归属校验失败:', fileID)
        return fail(ERRORS.FORBIDDEN, '图片归属校验失败，请重新上传图片')
      }
    }
  }

  // ---- 幂等检查：使用确定性 _id 原子查询（O(1) 索引命中，替代 where 查询）----
  // 格式：post_${openid}_${clientId}，数据库 _id 唯一性保证幂等
  // 弱网超时重试时，服务端用确定性 _id 原子查重，避免创建重复帖子
  if (clientId) {
    const deterministicId = 'post_' + openid + '_' + clientId
    try {
      const existingDoc = await db.collection('posts').doc(deterministicId).get()
      if (existingDoc && existingDoc.data) {
        console.log('[post.create] 幂等命中（确定性 _id），返回已有帖子:', deterministicId)
        return ok({ postId: deterministicId })
      }
    } catch (e) {
      // 文档不存在，正常继续创建流程
    }
  }

  // ---- 频率限制 ----
  if (recentRes.data.length > 0) {
    return fail(ERRORS.OPERATION_FAILED, '发帖过于频繁，请稍后再试')
  }

  // ---- 文本审核结果检查 ----
  // 上线策略：审核服务异常一律拒绝，避免违规内容因 openapi 故障而放行
  if (textResult.error) {
    return fail(ERRORS.CONTENT_RISK, '内容审核服务异常，请稍后重试')
  }
  if (!textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '正文包含违规内容，请修改后重试')
  }

  // ---- 用户状态检查 ----
  if (!user) {
    return fail(ERRORS.NOT_FOUND, '用户档案不存在')
  }
  if (user.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁')
  }
  if (user.status === 'muted') {
    return fail(ERRORS.OPERATION_FAILED, '账号已被禁言，暂时无法发帖')
  }

  // ---- 学生认证检查（认证功能关闭时跳过）----
  if (verifyEnabled && !user.studentVerified) {
    return fail(ERRORS.NOT_VERIFIED, '请先完成学生认证')
  }

  // ---- 图片安全审核（先审后发，同步执行确保一定完成）----
  // 此前为 fire-and-forget 异步审核，云函数返回后容器可能被冻结导致审核不执行，
  // 违规图片长期挂站。现改为发帖时同步审核：图片违规直接拒绝发帖；
  // 单张审核接口故障时保守放行（避免 openapi 故障误杀正常图）。
  // 云函数超时 30s、9 张图并行下载+检测，耗时约 2-4 秒，可接受。
  // 审核逻辑抽为 auditImages()，与 handleUpdate 共用（修复「编辑绕过图审」）。
  if (!(await auditImages(images, 'post.create'))) {
    return fail(ERRORS.CONTENT_RISK, '图片包含违规内容，请更换后重试')
  }

  // ---- 确定帖子类型：有图片为 image，否则为 text ----
  const postType = event.type || (images && images.length > 0 ? 'image' : 'text')
  // 业务模块，默认 community
  const module = event.module || 'community'

  const now = Date.now()

  // ---- 创建 posts 文档 ----
  // 匿名发帖：存储 isAnonymous 标记和随机匿名昵称
  // 后台管理仍可通过 authorId / _openid 追溯真实作者
  const anonymousFlag = !!isAnonymous
  const anonymousName = anonymousFlag ? genAnonymousName() : ''

  const postData = {
    _openid: openid,
    authorId: openid,
    module,
    section,
    type: postType,
    title: title || '',
    content,
    contentNodes: [], // 正文富文本节点，暂以空数组占位
    images: images || [],
    tags: tags || [],
    location: location || '',
    // 匿名发帖：标记 + 随机昵称，enrichAuthors 据此展示匿名身份
    isAnonymous: anonymousFlag,
    anonymousName: anonymousName,
    // 二手交易信息：仅 secondhand 板块携带，含 price/condition/tradeType/isSold
    tradeInfo: (section === 'secondhand' && tradeInfo) ? {
      price: Number(tradeInfo.price) || 0,
      condition: tradeInfo.condition || '全新',
      tradeType: tradeInfo.tradeType || 'sell',
      isSold: false
    } : null,
    stats: {
      likes: 0,
      comments: 0,
      views: 0,
      shares: 0,
      favorites: 0
    },
    isTop: false,
    topExpire: 0,
    isEssence: false,
    status: 'normal',
    secStatus: 'pass',
    sortTime: now,
    refType: '',
    refId: '',
    clientId: clientId || '', // 幂等键：客户端生成的唯一ID，用于防重复提交
    createdAt: now,
    updatedAt: now
  }

  // ---- 创建 posts 文档 ----
  // 有 clientId 时使用确定性 _id（post_${openid}_${clientId}），保证幂等
  // 无 clientId 时使用系统自动生成的 _id
  const deterministicPostId = clientId ? 'post_' + openid + '_' + clientId : ''
  let createdPostId = ''

  if (deterministicPostId) {
    // 确定性 _id 创建：add() 携带 _id，冲突时抛错（并发场景安全降级）
    try {
      const addRes = await db.collection('posts').add({
        data: Object.assign({ _id: deterministicPostId }, postData)
      })
      createdPostId = addRes._id || deterministicPostId
    } catch (e) {
      // 并发创建冲突：另一请求已创建相同 _id 的帖子
      // 直接返回已有帖子 ID，不重复创建
      console.warn('[post.create] 确定性 _id 创建冲突，返回已有:', e.message)
      return ok({ postId: deterministicPostId })
    }
  } else {
    const addRes = await db.collection('posts').add({ data: postData })
    createdPostId = addRes._id
  }

  // ---- 通知板块关注者（fire-and-forget 语义：内部全量兜错，不阻断发帖）----
  await notifySectionFollowers(
    Object.assign({ _id: createdPostId }, postData),
    openid
  )

  return ok({ postId: createdPostId })
}

/**
 * action: feed
 * 信息流分页查询（游标分页 + 服务端排序）：
 * 1. 鉴权：requireLogin
 * 2. 构建 where 条件：status='normal', secStatus='pass'
 * 3. 支持 module / section 筛选
 * 4. 排除当前用户拉黑的用户
 * 5. 游标分页：cursor > 0 时用 sortTime < cursor 替代 skip，避免大偏移量性能问题
 * 6. 服务端排序：recommend(isTop+sortTime) / latest(sortTime) / hot(likes+comments)
 * 7. 返回 { list, total, page, pageSize, hasMore, nextCursor }
 */
async function handleFeed(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.feed'])

  const pageSize = event.pageSize || 20
  const cursor = event.cursor || 0
  const sort = event.sort || 'recommend'

  // ---- 构建 where 条件（不含游标过滤，用于 total 统计）----
  const where = {
    status: 'normal',
    secStatus: 'pass'
  }
  if (event.module) where.module = event.module
  if (event.section) where.section = event.section
  // ---- 精华筛选：sort=essence 时只返回精华帖（total 同步过滤）----
  if (sort === 'essence') {
    where.isEssence = true
  }

  // ---- 获取当前用户档案（blockList + 封禁状态）----
  let blockList = []
  let currentUserStatus = 'active'
  try {
    const { data: users } = await db
      .collection('users')
      .where({ openid })
      .limit(1)
      .get()
    blockList = (users[0] && users[0].blockList) || []
    currentUserStatus = (users[0] && users[0].status) || 'active'
  } catch (e) {
    console.warn('[post.feed] 获取用户档案失败，降级为空:', e.message)
  }

  // ---- 封禁用户不可浏览信息流 ----
  if (currentUserStatus === 'banned') {
    return ok({ list: [], total: 0, page: 1, pageSize, hasMore: false, nextCursor: 0 })
  }

  // ---- 获取被封禁用户的 openid 列表（内存缓存，TTL 5 分钟）----
  // 替代每次请求直接查询 users 表，降低数据库压力
  const bannedOpenids = await getBannedOpenids()

  // ---- 合并排除列表：拉黑用户 + 封禁用户 ----
  const excludeOpenids = blockList.concat(bannedOpenids)
  if (excludeOpenids.length > 0) {
    where._openid = _.nin(excludeOpenids)
  }

  // ---- 游标分页：cursor > 0 时追加 sortTime < cursor 条件，替代 skip ----
  const queryWhere = Object.assign({}, where)
  if (cursor > 0) {
    queryWhere.sortTime = _.lt(cursor)
  }

  // ---- 仅首页计算 total（游标分页后续页不需要 total，省一次 count 查询）----
  let total = 0
  if (cursor === 0) {
    const countRes = await db.collection('posts').where(where).count()
    total = countRes.total
  }

  // ---- 分页查询：先按 isTop 降序，再按 sortTime 降序 ----
  const { data: list } = await db
    .collection('posts')
    .where(queryWhere)
    .orderBy('isTop', 'desc')
    .orderBy('sortTime', 'desc')
    .limit(pageSize)
    .get()

  // ---- 置顶过期过滤：应用层清理过期置顶标记 ----
  const now = Date.now()
  list.forEach((post) => {
    if (post.isTop && post.topExpire > 0 && post.topExpire < now) {
      post.isTop = false
    }
  })

  // ---- 服务端排序：根据 sort 参数重排当前页数据 ----
  // recommend: isTop 优先 + sortTime 降序（默认，已由 DB 排序保证）
  // latest:    按 createdAt 降序，忽略置顶优先级
  // hot:       按 (likes + comments) 降序
  // essence:   isEssence 已在 where 过滤，按 sortTime 降序即可
  if (sort === 'latest') {
    list.sort((a, b) => {
      return (b.createdAt || b.sortTime || 0) - (a.createdAt || a.sortTime || 0)
    })
  } else if (sort === 'hot') {
    list.sort((a, b) => {
      const sa = ((a.stats && a.stats.likes) || 0) + ((a.stats && a.stats.comments) || 0)
      const sb = ((b.stats && b.stats.likes) || 0) + ((b.stats && b.stats.comments) || 0)
      return sb - sa
    })
  } else {
    // recommend: 重新排序确保置顶帖在前，普通帖按 sortTime 降序
    list.sort((a, b) => {
      const aTop = a.isTop ? 1 : 0
      const bTop = b.isTop ? 1 : 0
      if (aTop !== bTop) return bTop - aTop
      return (b.sortTime || 0) - (a.sortTime || 0)
    })
  }

  // ---- 并行优化：enrichAuthors（用户信息）+ resolvePostImages（图片 URL 转换）+ liked 状态填充 + 热评前置 ----
  // cloud:// fileID 需转为 HTTP 临时 URL，确保其他用户不受云存储安全规则限制
  // liked 状态由服务端批量查询 likes 集合直接返回，前端无需额外调用 batchCheck
  await Promise.all([
    enrichAuthors(list),
    resolvePostImages(list),
    batchFillLikedStatus(list, openid),
    attachHotComments(list)
  ])

  // ---- 游标与 hasMore 计算 ----
  // hasMore 用 list.length === pageSize 判断，比 page*pageSize < total 更可靠
  // nextCursor 取本页最后一条的 sortTime，客户端下次请求带上即可续页
  const hasMore = list.length === pageSize
  const nextCursor = (hasMore && list.length > 0)
    ? (list[list.length - 1].sortTime || 0)
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
 * 热评前置：为信息流帖子附加一条最热一级评论（即刻式，提升内容密度）
 * 策略：一次查询本页帖子的全部一级评论，按 likeCount 降序，为每个 postId 取第一条
 * 失败降级为无热评（不影响主流程）
 * @param {Array} list 帖子列表（原地附加 hotComment 字段）
 */
async function attachHotComments(list) {
  const ids = list.map(p => p._id).filter(Boolean)
  if (!ids.length) return
  try {
    const { data: comments } = await db
      .collection('comments')
      .where({ postId: _.in(ids), status: 'normal', parentId: '' })
      .orderBy('likeCount', 'desc')
      .limit(Math.min(100, ids.length * 5))
      .get()
    if (!comments.length) return

    // likeCount 降序遍历，每个 postId 首次出现即最热评论
    const hotMap = {}
    comments.forEach((c) => {
      if (!hotMap[c.postId] && c.content) {
        hotMap[c.postId] = c
      }
    })
    const hotList = Object.values(hotMap)
    if (!hotList.length) return

    // 批量取评论作者昵称（openid 去重）
    const openids = []
    hotList.forEach((c) => {
      if (c._openid && openids.indexOf(c._openid) === -1) openids.push(c._openid)
    })
    const nickMap = {}
    if (openids.length) {
      const { data: users } = await db
        .collection('users')
        .where({ openid: _.in(openids) })
        .field({ openid: true, nickname: true })
        .get()
      users.forEach((u) => { nickMap[u.openid] = u.nickname })
    }

    list.forEach((p) => {
      const c = hotMap[p._id]
      if (c) {
        const text = String(c.content || '').replace(/\s+/g, ' ').trim()
        p.hotComment = {
          authorName: nickMap[c._openid] || '匿名同学',
          content: text.length > 50 ? text.slice(0, 50) + '…' : text
        }
      }
    })
  } catch (e) {
    console.warn('[post.feed] 热评前置失败，降级为无热评:', e.message)
  }
}

/**
 * action: followSection
 * 关注板块（幂等：确定性 _id sf_${openid}_${section}，重复关注直接覆盖同文档）
 */
async function handleFollowSection(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.followSection'])

  const followId = 'sf_' + openid + '_' + event.section
  await db.collection('section_follows').doc(followId).set({
    data: {
      _openid: openid,
      section: event.section,
      createdAt: Date.now()
    }
  })
  return ok({ followed: true })
}

/**
 * action: unfollowSection
 * 取消关注板块（幂等：不存在时 remove 无副作用）
 */
async function handleUnfollowSection(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.unfollowSection'])

  const followId = 'sf_' + openid + '_' + event.section
  try {
    await db.collection('section_follows').doc(followId).remove()
  } catch (e) {
    console.warn('[post.unfollowSection] 移除失败（可能不存在）:', e.message)
  }
  return ok({ followed: false })
}

/**
 * action: myFollowSections
 * 当前用户关注的板块 key 列表
 */
async function handleMyFollowSections(event, context) {
  const openid = requireLogin(getOpenid(context))

  const { data } = await db
    .collection('section_follows')
    .where({ _openid: openid })
    .limit(50)
    .get()
  return ok({ sections: data.map((d) => d.section) })
}

/**
 * 板块新帖通知：发帖成功后通知该板块的关注者
 * - 仅 community 模块且有 section 的帖子
 * - 通知 _id 确定性生成（nf_${postId}_${openid}），天然幂等防重
 * - 自己不通知自己；通知失败不影响发帖主流程
 * @param {Object} post 新帖文档
 * @param {string} authorOpenid 作者 openid
 */
async function notifySectionFollowers(post, authorOpenid) {
  if (!post || post.module !== 'community' || !post.section) return
  try {
    // 板块名映射（shared/constants 的 SECTIONS）
    let sectionName = post.section
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].key === post.section) {
        sectionName = SECTIONS[i].name || post.section
        break
      }
    }

    const { data: follows } = await db
      .collection('section_follows')
      .where({ section: post.section })
      .limit(100)
      .get()
    const targets = follows
      .map((f) => f._openid)
      .filter((o) => o && o !== authorOpenid)
    if (!targets.length) return

    // 作者昵称（匿名帖用匿名昵称）
    let authorName = post.anonymousName || '同学'
    if (!post.anonymousName) {
      try {
        const { data: users } = await db
          .collection('users')
          .where({ openid: authorOpenid })
          .field({ nickname: true })
          .limit(1)
          .get()
        if (users[0] && users[0].nickname) authorName = users[0].nickname
      } catch (e) { /* 降级为默认称呼 */ }
    }

    const summary = String(post.title || post.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)

    for (var j = 0; j < targets.length; j++) {
      await db.collection('notifications')
        .doc('nf_' + post._id + '_' + targets[j])
        .set({
          data: {
            _openid: targets[j],
            type: 'section',
            title: '你关注的「' + sectionName + '」有新帖',
            body: authorName + '：' + (summary || '查看详情'),
            refType: 'post',
            refId: post._id,
            senderId: authorOpenid,
            senderName: authorName,
            senderAvatar: '',
            read: false,
            createdAt: Date.now()
          }
        })
    }
  } catch (e) {
    console.warn('[post.create] 板块关注者通知失败（不影响发帖）:', e.message)
  }
}

/**
 * action: detail
 * 帖子详情：
 * 1. 鉴权：requireLogin
 * 2. 查询 posts 文档
 * 3. 不存在或 status='deleted' 返回 NOT_FOUND
 * 4. 浏览数 +1
 * 5. 如果有 refType / refId，查询关联明细集合
 * 6. 返回帖子详情
 */
async function handleDetail(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.detail'])
  const { postId } = event

  // ---- 并行：查询当前用户 + 帖子（减少一次串行 DB 往返，加速详情打开）----
  const [userRes, postRes] = await Promise.all([
    db.collection('users').where({ openid }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('posts').doc(postId).get().catch(() => null)
  ])
  const currentUser = (userRes.data && userRes.data[0]) || null

  // 封禁用户不可查看帖子详情
  if (currentUser && currentUser.status === 'banned') {
    return fail(ERRORS.BLOCKED, '账号已被封禁，无法查看内容')
  }

  // 帖子不存在或已删除
  const post = postRes ? postRes.data : null
  if (!post || post.status === 'deleted') {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  const postAuthorId = post._openid || post.authorId || ''

  // ---- 隐藏帖访问控制 ----
  // 运营隐藏的帖子仅作者本人可见（作者可查看/管理），其他用户通过 postId 也无法访问
  if (post.status === 'hidden' && postAuthorId !== openid) {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  // ---- secStatus 访问控制 ----
  // 审核中（pending）或违规（reject）的帖子，仅作者本人可访问
  // 其他用户通过 postId 直接访问时返回 NOT_FOUND，避免审核中内容泄露
  if (post.secStatus && post.secStatus !== 'pass' && postAuthorId !== openid) {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  // ---- 编辑回显用：在图片 URL 转换前快照原始 cloud:// fileID ----
  // resolvePostImages 会「就地」把 images 里的 cloud:// 替换成 HTTP 临时链接，之后无法还原；
  // 而 post.update 要求传 cloud:// fileID 并校验归属 → 编辑页若拿不到原始 fileID，
  // 保存时会以空数组覆盖，导致原帖图片被整体清空（数据丢失）。
  // 仅对作者本人下发，避免把他人帖子的存储路径暴露出去。
  const rawImageFileIds = (postAuthorId === openid && Array.isArray(post.images))
    ? post.images.slice()
    : null

  // ---- 浏览数 + 作者信息 + 图片 URL 转换 + liked 状态：全部并行 ----
  // 浏览数更新（5 分钟/人去重）不再串行阻塞响应，与其余查询并行执行
  const shouldIncrement = shouldCountView(openid, postId)
  await Promise.all([
    shouldIncrement
      ? db.collection('posts').doc(postId).update({ data: { 'stats.views': _.inc(1) } })
      : Promise.resolve(),
    enrichAuthors([post]),
    resolvePostImages([post]),
    batchFillLikedStatus([post], openid)
  ])

  // ---- 匿名帖子的作者本人可见真实身份（复用并行查询的用户数据，不再二次查询）----
  // 带上 userId（users._id），否则作者本人点击自己头像会提示「无法获取作者信息」
  if (post.isAnonymous && postAuthorId === openid && currentUser) {
    post.author = {
      nickname: currentUser.nickname || '匿名同学',
      avatar: currentUser.avatar || '',
      verifyBadge: !!currentUser.verifyBadge,
      isAnonymous: true,
      isOwner: true,
      userId: currentUser._id || ''
    }
  }

  // 构造返回数据（同步更新本地 views 计数，仅在本次计入浏览时 +1）
  const result = {
    ...post,
    // 是否本人帖子（服务端基于 openid 判断，供前端展示编辑/删除入口）
    isOwner: postAuthorId === openid,
    stats: {
      ...(post.stats || {}),
      views: (post.stats && post.stats.views || 0) + (shouldIncrement ? 1 : 0)
    }
  }

  // 仅作者本人可取到原始图片 fileID 列表，供编辑页原样回传（避免保存时清空图片）
  if (rawImageFileIds) {
    result.imageFileIds = rawImageFileIds
  }

  // ---- 如果帖子关联了其他明细集合，一并查询返回 ----
  if (post.refType && post.refId) {
    try {
      const refRes = await db.collection(post.refType).doc(post.refId).get()
      const refDetail = refRes.data
      // ---- 安全脱敏：关联明细（lost_found / delivery_tasks）不返回联系方式与 openid ----
      // 与 lostfound.detail / delivery.detail 的脱敏策略保持一致，避免绕过详情页脱敏直接泄露
      if (refDetail) {
        delete refDetail.contact
        if (refDetail.publisher && typeof refDetail.publisher === "object") {
          delete refDetail.publisher.openid
          delete refDetail.publisher._openid
        }
        delete refDetail._openid
        delete refDetail.openid
      }
      result.refDetail = refDetail
    } catch (e) {
      // 关联明细查询失败不影响帖子详情返回
      console.warn('[post.detail] 关联明细查询失败:', post.refType, post.refId, e)
    }
  }

  return ok(result)
}

/**
 * action: update
 * 编辑帖子：
 * 1. 鉴权：requireLogin
 * 2. 校验 postId，仅作者本人可编辑
 * 3. 隐藏帖不可编辑（运营处置中）
 * 4. 文本安全审核（与 create 一致）
 * 5. 图片归属校验（复用 create 的 cloud:// + ownerKey 路径规则）
 * 6. 图片内容审核（复用 auditImages，仅审核新增/变更图片，防止编辑换违规图）
 * 7. 更新 title/content/images/tags/location/type/updatedAt
 */
async function handleUpdate(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.update'])
  const { postId, title, content, images, tags, location } = event

  // ---- 查询帖子 ----
  let post = null
  try {
    const res = await db.collection('posts').doc(postId).get()
    post = res.data
  } catch (e) {
    post = null
  }
  if (!post || post.status === 'deleted') {
    return fail(ERRORS.NOT_FOUND, '帖子不存在或已被删除')
  }

  // ---- 仅作者可编辑 ----
  const postAuthorId = post._openid || post.authorId || ''
  if (postAuthorId !== openid) {
    return fail(ERRORS.FORBIDDEN, '无权编辑该帖子')
  }
  // 隐藏帖不可编辑
  if (post.status === 'hidden') {
    return fail(ERRORS.OPERATION_FAILED, '帖子已被隐藏，无法编辑')
  }

  // ---- 图片归属校验（与 create 一致，规则见 handleCreate 中的说明）----
  if (images && Array.isArray(images) && images.length > 0) {
    for (const fileID of images) {
      if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) {
        return fail(ERRORS.PARAM_INVALID, '图片地址格式不合法')
      }
    }
    // edit 不走 create 的并行查询，需单独取用户档案拿 uploadKey
    const currentUser = await getUser(openid)
    const ownerKeys = [openid]
    if (currentUser && currentUser.uploadKey) ownerKeys.push(currentUser.uploadKey)
    for (const fileID of images) {
      const owned = ownerKeys.some((key) => key && fileID.indexOf(key) !== -1)
      if (!owned) {
        console.warn('[post.update] 图片归属校验失败:', fileID)
        return fail(ERRORS.FORBIDDEN, '图片归属校验失败，请重新上传图片')
      }
    }
  }

  // ---- 图片内容安全审核（仅审核新增/变更的图片）----
  // 修复「编辑绕过图审」：create 已先审后发，但编辑可替换图片，
  // 若此处不审核，用户可先发合规图、再编辑换成违规图。
  // 已存在于帖子中的图片在 create 时已审过，无需重复下载审核（省时且避免误杀）。
  const prevImages = Array.isArray(post.images) ? post.images : []
  const newImages = (images || []).filter((id) => prevImages.indexOf(id) === -1)
  if (newImages.length > 0) {
    if (!(await auditImages(newImages, 'post.update'))) {
      return fail(ERRORS.CONTENT_RISK, '图片包含违规内容，请更换后重试')
    }
  }

  // ---- 文本安全审核（编辑后的内容同样需要审核）----
  const textResult = await contentCheck([title, content].concat(tags || []).filter(Boolean).join(' '), openid, 3).catch(function(e) {
    console.error('[post.update] 文本安全检测调用失败:', e.message)
    return { error: e.message }
  })
  if (textResult.error) {
    return fail(ERRORS.CONTENT_RISK, '内容审核服务异常，请稍后重试')
  }
  if (!textResult.pass) {
    return fail(ERRORS.CONTENT_RISK, '内容包含违规信息，请修改后重试')
  }

  // ---- 更新帖子 ----
  const updateData = {
    title: title || '',
    content,
    images: images || [],
    tags: tags || [],
    location: location || '',
    type: (images && images.length > 0) ? 'image' : 'text',
    updatedAt: Date.now()
  }
  await db.collection('posts').doc(postId).update({ data: updateData })

  return ok({ postId })
}

/**
 * action: delete
 * 删除帖子（软删除）：
 * 1. 鉴权：requireLogin
 * 2. 验证帖子 _openid === 当前 openid（或 admin 角色）
 * 3. 更新 status='deleted'
 * 4. 如果有 refType / refId，同步标记明细集合 status='deleted'
 * 5. 返回 ok
 */
async function handleDelete(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.delete'])
  const { postId } = event

  // ---- 查询帖子 ----
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

  // ---- 权限校验：仅作者或管理员可删除 ----
  const user = await getUser(openid)
  if (post._openid !== openid && (!user || user.role !== 'admin')) {
    return fail(ERRORS.FORBIDDEN, '无权删除他人帖子')
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

  // ---- 级联清理收藏记录：批量删除指向该帖子的所有 favorites ----
  // 使用 where().remove() 批量删除（每次最多 20 条），比逐条删除高效
  try {
    let favDeleted = false
    while (!favDeleted) {
      const removeRes = await db
        .collection('favorites')
        .where({ postId })
        .remove()
      // 云数据库单次 remove 最多删 20 条，removed < 20 说明已删完
      if (!removeRes.stats || removeRes.stats.removed < 20) {
        favDeleted = true
      }
    }
  } catch (e) {
    // 收藏清理失败不阻断删帖主流程
    console.warn('[post.delete] 级联清理收藏失败:', postId, e.message)
  }

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
      console.warn('[post.delete] 关联明细删除失败:', post.refType, post.refId, e)
    }
  }

  return ok({ deleted: true })
}

/**
 * action: myPosts
 * 我的帖子列表：
 * 1. 鉴权：requireLogin
 * 2. 查询 _openid === 当前openid 且 status != 'deleted' 的帖子
 * 3. 可选按内容类型筛选（event.module：community / lostfound / delivery，非法值忽略）
 * 4. 按 sortTime 降序分页
 * 5. 返回 { list, total, page, hasMore }
 */
async function handleMyPosts(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.myPosts'])

  // ---- 封禁用户不可查看帖子列表 ----
  try {
    const { data: currentUser } = await db
      .collection('users')
      .where({ openid })
      .limit(1)
      .get()
    if (currentUser[0] && currentUser[0].status === 'banned') {
      return ok({ list: [], total: 0, page: 1, pageSize: 20, hasMore: false })
    }
  } catch (e) {
    console.warn('[post.myPosts] 获取用户状态失败，降级为允许:', e.message)
  }

  const page = event.page || 1
  const pageSize = 20

  // 查询条件：当前用户 + 未删除
  const where = {
    _openid: openid,
    status: _.neq('deleted')
  }

  // ---- 内容类型筛选（我的帖子：全部 / 社区 / 失物招领 / 跑腿）----
  // 说明：失物招领、跑腿同样写入 posts 集合（module=lostfound / delivery），
  //      不加筛选时三类内容会混排。
  //      community 用 nin 而非 eq：兼容早期没有 module 字段的历史帖子（它们都是社区帖）。
  if (event.module === MODULES.COMMUNITY) {
    where.module = _.nin([MODULES.LOSTFOUND, MODULES.DELIVERY])
  } else if (event.module === MODULES.LOSTFOUND || event.module === MODULES.DELIVERY) {
    where.module = event.module
  }

  const { total } = await db.collection('posts').where(where).count()

  const { data: list } = await db
    .collection('posts')
    .where(where)
    .orderBy('sortTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 实时填充 author 信息 + 图片 URL 转换 + liked 状态 ----
  await Promise.all([
    enrichAuthors(list),
    resolvePostImages(list),
    batchFillLikedStatus(list, openid)
  ])

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: list.length === pageSize
  })
}

/**
 * action: userPosts
 * 他人帖子列表：
 * 1. 鉴权：requireLogin
 * 2. 查询指定用户的帖子，status='normal'
 * 3. 按 sortTime 降序分页
 * 4. 返回 { list, total, page, hasMore }
 */
async function handleUserPosts(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.userPosts'])

  const { userId } = event
  const page = event.page || 1
  const pageSize = 20

  // ---- 解析目标用户 openid：兼容 userId（users._id）或 openid 两种传值 ----
  // 对外接口已用 users._id 作为用户标识，openid 仅作兼容兜底
  let targetOpenid = userId || ''
  if (targetOpenid) {
    try {
      const byId = await db.collection('users').doc(targetOpenid).get()
      if (byId.data && byId.data.openid) {
        targetOpenid = byId.data.openid
      }
    } catch (e) {
      // 按 _id 查询失败，说明传入的是 openid，保持原值
    }
  }
  if (!targetOpenid) {
    return ok({ list: [], total: 0, page, pageSize, hasMore: false })
  }

  // ---- 查询目标用户状态：封禁用户的帖子对他人隐藏 ----
  try {
    const { data: targetUsers } = await db
      .collection('users')
      .where({ openid: targetOpenid })
      .limit(1)
      .get()
    if (targetUsers[0] && targetUsers[0].status === 'banned') {
      return ok({ list: [], total: 0, page, pageSize, hasMore: false })
    }
  } catch (e) {
    console.warn('[post.userPosts] 查询目标用户状态失败:', e.message)
  }

  // 查询条件：指定用户 + 正常状态
  const where = {
    _openid: targetOpenid,
    status: 'normal'
  }

  const { total } = await db.collection('posts').where(where).count()

  const { data: list } = await db
    .collection('posts')
    .where(where)
    .orderBy('sortTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 实时填充 author 信息 + 图片 URL 转换 + liked 状态 ----
  await Promise.all([
    enrichAuthors(list),
    resolvePostImages(list),
    batchFillLikedStatus(list, openid)
  ])

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: list.length === pageSize
  })
}

/**
 * action: search
 * 全局搜索帖子：
 * 1. 鉴权：requireLogin（搜索需要登录）
 * 2. 参数校验：keyword
 * 3. 使用正则匹配 title 和 content 字段
 * 4. 排除已删除和隐藏的帖子
 * 5. 返回 { list, total, page, pageSize, hasMore }
 */
async function handleSearch(event, context) {
  const openid = requireLogin(getOpenid(context))
  validate(event, SCHEMAS['post.search'])

  // ---- 搜索频率限制（内存级，同一容器内 5 秒仅允许 1 次搜索）----
  // 正则搜索开销大，防止恶意高频调用拖垮数据库
  if (!checkSearchRateLimit(openid)) {
    return fail(ERRORS.OPERATION_FAILED, '搜索过于频繁，请稍后再试')
  }

  const keyword = event.keyword || ''
  const page = event.page || 1
  const pageSize = 20

  // 构造正则匹配（转义特殊字符）
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reg = db.RegExp({ regexp: escapedKeyword, options: 'i' })

  // ---- 获取被封禁用户的 openid 列表（内存缓存，TTL 5 分钟）----
  const bannedOpenids = await getBannedOpenids()

  // 查询条件：标题或正文匹配关键词 + 正常状态 + 排除封禁用户帖子
  const whereConditions = [
    { status: 'normal' },
    _.or([{ title: reg }, { content: reg }])
  ]
  // ---- 合并排除列表：当前用户拉黑 + 封禁用户（拉黑者在搜索中不可见）----
  let blockList = []
  try {
    const { data: users } = await db.collection('users').where({ openid }).limit(1).get()
    blockList = (users[0] && users[0].blockList) || []
  } catch (e) {
    console.warn('[post.search] 获取拉黑列表失败，降级为空:', e.message)
  }
  const excludeOpenids = blockList.concat(bannedOpenids)
  if (excludeOpenids.length > 0) {
    whereConditions.push({ _openid: _.nin(excludeOpenids) })
  }
  const where = _.and(whereConditions)

  // 查询总数
  const { total } = await db.collection('posts').where(where).count()

  // 分页查询：按创建时间降序
  const { data: list } = await db
    .collection('posts')
    .where(where)
    .orderBy('sortTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 实时填充 author 信息 + 图片 URL 转换 + liked 状态 ----
  await Promise.all([
    enrichAuthors(list),
    resolvePostImages(list),
    batchFillLikedStatus(list, openid)
  ])

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: list.length === pageSize
  })
}

/**
 * action: checkImages
 * 图片审核辅助 action（已由 handleCreate 改为同步先审后发；本 action 保留供管理员/内部触发）
 * 下载每张图片并调用 imgSecCheck，任一违规则标记 secStatus='reject'
 * 审核通过则确保 secStatus='pass'（已是默认值，仅做日志记录）
 * 
 * 鉴权：仅帖子作者本人或管理员可触发
 */
async function handleCheckImages(event, context) {
  // ---- 鉴权：必须登录，且仅帖子作者本人（或管理员）可触发 ----
  // 修复：此前无鉴权，任意登录用户可对任意帖子标记 secStatus='reject'（批量隐藏他人内容），
  // 或传入任意 cloud:// fileID 触发 downloadFile（扩大云存储访问面、刷 imgSecCheck 配额）
  const openid = requireLogin(getOpenid(context))
  const { postId, images } = event

  // ---- 参数校验：数量上限（与发帖 9 张一致）+ cloud:// 前缀 ----
  if (!postId || !images || !Array.isArray(images) || images.length === 0 || images.length > 9) {
    return ok({ checked: false, reason: 'no images' })
  }
  for (let i = 0; i < images.length; i++) {
    if (typeof images[i] !== 'string' || images[i].indexOf('cloud://') !== 0) {
      return ok({ checked: false, reason: 'invalid images' })
    }
  }

  // ---- 帖子归属校验：非作者/非管理员一律拒绝 ----
  let post = null
  try {
    const res = await db.collection('posts').doc(postId).get()
    post = res.data
  } catch (e) {
    post = null
  }
  if (!post) {
    return ok({ checked: false, reason: 'post not found' })
  }
  const postAuthorId = post._openid || post.authorId || ''
  const user = await getUser(openid)
  const isAdmin = !!(user && user.role === 'admin')
  if (postAuthorId !== openid && !isAdmin) {
    return fail(ERRORS.FORBIDDEN, '无权审核该帖子的图片')
  }

  console.log('[post.checkImages] 开始审核图片, postId:', postId, '数量:', images.length)

  try {
    const checkResults = await Promise.all(images.map(async (fileID) => {
      try {
        const { fileContent } = await cloud.downloadFile({ fileID })
        const imgResult = await imageCheck(fileContent)
        return imgResult.pass
      } catch (e) {
        console.warn('[post.checkImages] 单张图片审核失败:', fileID, e.message)
        // 审核失败时保守处理：视为通过，避免 openapi 故障导致正常图片被拒
        return true
      }
    }))

    const allPass = checkResults.indexOf(false) === -1
    if (!allPass) {
      // 有违规图片：标记帖子为审核拒绝
      await db
        .collection('posts')
        .doc(postId)
        .update({
          data: {
            secStatus: 'reject',
            updatedAt: Date.now()
          }
        })
      console.log('[post.checkImages] 图片审核不通过, 已标记 reject, postId:', postId)
    } else {
      console.log('[post.checkImages] 图片审核全部通过, postId:', postId)
    }

    return ok({ checked: true, pass: allPass })
  } catch (e) {
    console.error('[post.checkImages] 图片审核整体失败:', e.message)
    return ok({ checked: false, reason: e.message })
  }
}

/**
 * action: searchByTag
 * 搜索话题：按标签关键词模糊匹配帖子的 tags 字段
 * 1. 鉴权：requireLogin
 * 2. 使用正则匹配 tags 数组中的元素
 * 3. 排除已删除/隐藏帖子和封禁用户帖子
 * 4. 返回 { list, total, page, pageSize, hasMore }
 */
async function handleSearchByTag(event, context) {
  const openid = requireLogin(getOpenid(context))

  // ---- 搜索频率限制（内存级，同一容器内 5 秒仅允许 1 次搜索）----
  // 正则搜索开销大，防止恶意高频调用拖垮数据库
  if (!checkSearchRateLimit(openid)) {
    return fail(ERRORS.OPERATION_FAILED, '搜索过于频繁，请稍后再试')
  }

  const keyword = (event.keyword || '').trim()
  if (!keyword || keyword.length < 1) {
    return ok({ list: [], total: 0, page: 1, pageSize: 20, hasMore: false })
  }

  const page = event.page || 1
  const pageSize = 20

  // 构造正则匹配（转义特殊字符）
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reg = db.RegExp({ regexp: escapedKeyword, options: 'i' })

  // ---- 获取被封禁用户的 openid 列表（内存缓存，TTL 5 分钟）----
  const bannedOpenids = await getBannedOpenids()

  // 查询条件：tags 匹配 + 正常状态 + 排除封禁用户帖子
  const whereConditions = [
    { status: 'normal' },
    { tags: reg }
  ]
  if (bannedOpenids.length > 0) {
    whereConditions.push({ _openid: _.nin(bannedOpenids) })
  }
  const where = _.and(whereConditions)

  // 查询总数
  const { total } = await db.collection('posts').where(where).count()

  // 分页查询：按创建时间降序
  const { data: list } = await db
    .collection('posts')
    .where(where)
    .orderBy('sortTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  // ---- 实时填充 author 信息 + 图片 URL 转换 + liked 状态 ----
  await Promise.all([
    enrichAuthors(list),
    resolvePostImages(list),
    batchFillLikedStatus(list, openid)
  ])

  return ok({
    list,
    total,
    page,
    pageSize,
    hasMore: list.length === pageSize
  })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'create':
      return handleCreate(event, context)
    case 'feed':
      return handleFeed(event, context)
    case 'followSection':
      return handleFollowSection(event, context)
    case 'unfollowSection':
      return handleUnfollowSection(event, context)
    case 'myFollowSections':
      return handleMyFollowSections(event, context)
    case 'detail':
      return handleDetail(event, context)
    case 'delete':
      return handleDelete(event, context)
    case 'update':
      return handleUpdate(event, context)
    case 'myPosts':
      return handleMyPosts(event, context)
    case 'userPosts':
      return handleUserPosts(event, context)
    case 'search':
      return handleSearch(event, context)
    case 'searchByTag':
      return handleSearchByTag(event, context)
    case 'checkImages':
      return handleCheckImages(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
