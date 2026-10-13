/**
 * 临里校园 - 数据库初始化云函数
 * ------------------------------------------------------------
 * 一键创建项目所需的全部数据库集合，并初始化基础配置数据。
 * 部署后在小程序中调用 wx.cloud.callFunction({ name: 'initDB' }) 即可。
 *
 * 功能：
 *   1. 创建全部 19 个集合（已存在自动跳过）
 *   2. 创建关键查询索引（基于项目实际查询模式）
 *   3. 初始化 config 集合的板块（sections）数据
 *
 * 注意：微信云开发的 wx-server-sdk 不一定支持 db.collection().createIndex() API，
 *      若不支持则跳过程序化创建，请在云开发控制台 -> 数据库 -> 索引管理 手动创建。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 项目所需的全部集合名
const COLLECTIONS = [
  'users',              // 用户档案
  'posts',              // 帖子
  'comments',           // 评论
  'likes',              // 点赞记录
  'favorites',          // 收藏记录
  'blocks',             // 拉黑记录
  'notifications',      // 通知
  'conversations',      // 私信会话
  'messages',           // 私信消息
  'reports',            // 举报记录
  'moderation_logs',    // 审核日志
  'verifications',      // 学生认证
  'lost_found',         // 失物招领
  'delivery_tasks',     // 跑腿任务
  'section_follows',    // 板块关注记录
  'config'              // 全局配置
]

// 默认板块配置（初始化时写入 config 集合）
const DEFAULT_SECTIONS = [
  { key: 'daily', name: '日常', icon: '' },
  { key: 'secondhand', name: '二手', icon: '' },
  { key: 'help', name: '求助', icon: '' },
  { key: 'study', name: '学习', icon: '' },
  { key: 'emotion', name: '情感', icon: '' },
  { key: 'news', name: '资讯', icon: '' }
]

/**
 * 初始化板块配置数据
 * 检查 config 集合中是否已有 sections 记录，没有则插入
 */
async function initSections() {
  try {
    const { data } = await db
      .collection('config')
      .where({ key: 'sections' })
      .limit(1)
      .get()

    if (data.length > 0) {
      console.log('[initDB] 板块配置已存在，跳过初始化')
      return { status: 'exists' }
    }

    await db.collection('config').add({
      data: {
        key: 'sections',
        value: DEFAULT_SECTIONS,
        updatedAt: Date.now()
      }
    })
    console.log('[initDB] 板块配置初始化成功')
    return { status: 'created' }
  } catch (e) {
    console.error('[initDB] 板块配置初始化失败:', e)
    return { status: 'error', message: e.errMsg || e.message }
  }
}

/**
 * 初始化学生认证开关配置
 * 写入 config 集合 { key: 'verifyEnabled', value: false }
 * value 为 false 表示暂时关闭学生认证功能（已配置时跳过，不覆盖现有值）
 * @returns {Promise<{ status: string }>}
 */
async function initVerifyConfig() {
  try {
    const { data } = await db
      .collection('config')
      .where({ key: 'verifyEnabled' })
      .limit(1)
      .get()

    if (data.length > 0) {
      console.log('[initDB] 认证开关配置已存在，当前值:', data[0].value, '跳过初始化')
      return { status: 'exists', value: data[0].value }
    }

    await db.collection('config').add({
      data: {
        key: 'verifyEnabled',
        value: false, // 默认关闭学生认证
        updatedAt: Date.now()
      }
    })
    console.log('[initDB] 认证开关配置初始化成功：verifyEnabled = false（关闭）')
    return { status: 'created', value: false }
  } catch (e) {
    console.error('[initDB] 认证开关配置初始化失败:', e)
    return { status: 'error', message: e.errMsg || e.message }
  }
}

/**
 * 数据库索引定义
 * ------------------------------------------------------------
 * 基于项目实际查询模式整理的关键索引，按集合分组。
 * 字段值含义：1 表示升序，-1 表示降序。
 *
 * 注意：微信云开发 wx-server-sdk 的 createIndex API 支持情况因基础库版本而异，
 *      若运行时不存在该 API，initIndexes() 会自动跳过并打印提示，
 *      届时请前往「云开发控制台 -> 数据库 -> 索引管理」手动创建下列索引。
 */
const INDEX_DEFINITIONS = [
  {
    collection: 'posts',
    indexes: [
      // 我的帖子 / 他人帖子列表查询
      { keys: { authorId: 1, sortTime: -1 }, name: 'idx_posts_author_sortTime', desc: '我的帖子/他人帖子查询' },
      // 按板块浏览
      { keys: { section: 1, sortTime: -1 }, name: 'idx_posts_section_sortTime', desc: '按板块浏览' },
      // 信息流查询（状态过滤 + 排序）
      { keys: { status: 1, secStatus: 1, sortTime: -1 }, name: 'idx_posts_status_secStatus_sortTime', desc: '信息流查询' },
      // 幂等去重（同一客户端 + 同一作者）
      { keys: { clientId: 1, authorId: 1 }, name: 'idx_posts_clientId_authorId', desc: '幂等去重' }
    ]
  },
  {
    collection: 'comments',
    indexes: [
      // 帖子评论列表（按时间正序）
      { keys: { postId: 1, createdAt: 1 }, name: 'idx_comments_postId_createdAt', desc: '评论列表' },
      // 评论频率限制（按用户最近评论时间）
      { keys: { _openid: 1, createdAt: -1 }, name: 'idx_comments_openid_createdAt', desc: '评论频率限制' }
    ]
  },
  {
    collection: 'likes',
    indexes: [
      // 批量检查当前用户是否已赞若干目标
      { keys: { _openid: 1, targetId: 1, targetType: 1 }, name: 'idx_likes_openid_target', desc: '批量检查已赞' },
      // 删除目标（帖子/评论）时级联清理点赞
      { keys: { targetId: 1, targetType: 1 }, name: 'idx_likes_target', desc: '删除关联点赞' }
    ]
  },
  {
    collection: 'favorites',
    indexes: [
      // 我的收藏列表
      { keys: { _openid: 1, postId: 1 }, name: 'idx_favorites_openid_postId', desc: '我的收藏' },
      // 删帖时级联清理收藏
      { keys: { postId: 1 }, name: 'idx_favorites_postId', desc: '删帖级联清理' }
    ]
  },
  {
    collection: 'notifications',
    indexes: [
      // 通知列表 + 未读计数（按用户、已读状态、时间倒序）
      { keys: { _openid: 1, read: 1, createdAt: -1 }, name: 'idx_notifications_openid_read_createdAt', desc: '通知列表+未读计数' }
    ]
  },
  {
    collection: 'users',
    indexes: [
      // 用户查询（按 openid 唯一定位）
      { keys: { openid: 1 }, name: 'idx_users_openid', desc: '用户查询' },
      // 封禁用户列表查询
      { keys: { status: 1 }, name: 'idx_users_status', desc: '封禁用户列表查询' }
    ]
  }
]

/**
 * 初始化数据库索引
 * ------------------------------------------------------------
 * 遍历 INDEX_DEFINITIONS，逐个尝试调用 db.collection(name).createIndex({ keys, name })。
 *
 * 容错策略：
 *   - 若 createIndex 方法不存在（wx-server-sdk 不支持），整体跳过并返回 supported:false
 *   - 若单条索引已存在或创建失败，记录警告日志但不中断后续流程
 *
 * @returns {Promise<{ supported: boolean, results: Array, message?: string }>}
 */
async function initIndexes() {
  const results = []

  // 探测当前 wx-server-sdk 是否支持 createIndex API
  let supported = true
  try {
    const probeCollection = db.collection(INDEX_DEFINITIONS[0].collection)
    if (typeof probeCollection.createIndex !== 'function') {
      supported = false
    }
  } catch (e) {
    supported = false
    console.warn('[initDB] 探测 createIndex API 时出错:', e.errMsg || e.message)
  }

  if (!supported) {
    console.warn('[initDB] 当前 wx-server-sdk 不支持 db.collection().createIndex()，跳过程序化索引创建。')
    console.warn('[initDB] 请前往「云开发控制台 -> 数据库 -> 索引管理」手动创建下列索引：')
    INDEX_DEFINITIONS.forEach(group => {
      group.indexes.forEach(idx => {
        console.warn(`[initDB]   - ${group.collection}: ${JSON.stringify(idx.keys)}  // ${idx.desc}`)
      })
    })
    return {
      supported: false,
      message: 'wx-server-sdk 不支持 createIndex API，请前往云开发控制台手动创建索引',
      results: []
    }
  }

  // 逐个集合、逐个索引尝试创建
  for (let i = 0; i < INDEX_DEFINITIONS.length; i++) {
    const { collection, indexes } = INDEX_DEFINITIONS[i]
    for (let j = 0; j < indexes.length; j++) {
      const { keys, name, desc } = indexes[j]
      try {
        // createIndex 参数格式：{ keys: { 字段: 1/-1 }, name: '索引名' }
        await db.collection(collection).createIndex({ keys, name })
        results.push({ collection, name, desc, status: 'created' })
        console.log(`[initDB] 索引创建成功: ${collection}.${name} (${desc})`)
      } catch (e) {
        // 索引已存在或字段冲突等情况记录为 exists/error，但不中断流程
        const msg = e.errMsg || e.message || String(e)
        const isExists = msg.indexOf('already exists') !== -1 || msg.indexOf('exist') !== -1
        results.push({
          collection,
          name,
          desc,
          status: isExists ? 'exists' : 'error',
          message: msg
        })
        if (isExists) {
          console.log(`[initDB] 索引已存在: ${collection}.${name}`)
        } else {
          console.warn(`[initDB] 索引创建失败: ${collection}.${name} (${desc})`, msg)
        }
      }
    }
  }

  return { supported: true, results }
}

/**
 * 鉴权：仅管理员可执行数据库初始化（一次性运维操作）
 * 读取调用方 openid，查询 users 表判断 role 是否为 admin
 */
async function requireAdmin(context) {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) {
    throw new Error('未登录')
  }
  // 用户档案由云函数创建时写入 openid 字段（云函数写入不会自动注入 _openid）
  // 此前按 _openid 查询恒为空，导致 requireAdmin 永远 403，此处修正为按 openid 查询
  const { data } = await db.collection('users').where({ openid }).limit(1).get()
  if (!data.length || data[0].role !== 'admin') {
    throw new Error('无权限，仅管理员可执行')
  }
}

/**
 * 云函数入口
 * 1. 逐个创建集合，已存在的跳过
 * 2. 创建关键查询索引（基于项目实际查询模式）
 * 3. 初始化板块配置数据
 */
exports.main = async (event, context) => {
  // 鉴权：仅管理员可执行，避免任意客户端触发集合创建与数据清理
  try {
    await requireAdmin(context)
  } catch (e) {
    return { code: 403, data: null, message: e.message || '无权限' }
  }

  const results = []

  // 第一步：创建全部集合
  for (let i = 0; i < COLLECTIONS.length; i++) {
    const name = COLLECTIONS[i]
    try {
      await db.createCollection(name)
      results.push({ collection: name, status: 'created' })
      console.log('[initDB] 创建集合成功:', name)
    } catch (e) {
      // 集合已存在时 errMsg 为 "collection already exists"
      if (e.errMsg && e.errMsg.indexOf('already exists') !== -1) {
        results.push({ collection: name, status: 'exists' })
        console.log('[initDB] 集合已存在:', name)
      } else {
        results.push({ collection: name, status: 'error', message: e.errMsg || e.message })
        console.error('[initDB] 创建集合失败:', name, e)
      }
    }
  }

  // 第二步：创建关键查询索引（集合已存在，配置尚未初始化）
  // 注意：wx-server-sdk 可能不支持 createIndex，内部已做容错，失败不会中断后续流程
  const indexesResult = await initIndexes()

  // 第三步：初始化板块配置数据
  const sectionsResult = await initSections()

  // 第四步：初始化学生认证开关配置
  const verifyConfigResult = await initVerifyConfig()

  // 第五步：清理无效图片帖子（images 字段存的是本地临时路径 tmp_xxx）
  const cleanResult = await cleanInvalidImages()

  return {
    code: 0,
    data: {
      collections: results,
      total: COLLECTIONS.length,
      indexes: indexesResult,
      sections: sectionsResult,
      verifyConfig: verifyConfigResult,
      cleaned: cleanResult
    },
    message: '数据库初始化完成'
  }
}

/**
 * 清理无效图片帖子
 * 查找 images 数组中包含本地临时路径（wxfile:// 或 tmp_）的帖子，
 * 将这些无效路径从 images 数组中移除。
 * 如果清理后 images 为空且帖子类型为 image，则将类型改为 text。
 */
async function cleanInvalidImages() {
  try {
    const _ = db.command
    // 查找 images 数组中包含 tmp_ 或 wxfile 的帖子
    const { data: posts } = await db
      .collection('posts')
      .where({
        images: _.elemMatch(_.or([
          db.RegExp({ regexp: 'tmp_', options: 'i' }),
          db.RegExp({ regexp: 'wxfile://', options: 'i' })
        ]))
      })
      .get()

    if (posts.length === 0) {
      console.log('[initDB] 没有无效图片帖子需要清理')
      return { cleaned: 0 }
    }

    let cleanedCount = 0
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      const validImages = (post.images || []).filter(img => {
        return img && img.indexOf('cloud://') === 0 || (img && img.indexOf('http') === 0)
      })

      const updateData = { images: validImages }
      // 如果清理后无有效图片，且原类型为 image，改为 text
      if (validImages.length === 0 && post.type === 'image') {
        updateData.type = 'text'
      }

      await db.collection('posts').doc(post._id).update({ data: updateData })
      cleanedCount++
    }

    console.log('[initDB] 清理无效图片帖子完成:', cleanedCount, '条')
    return { cleaned: cleanedCount }
  } catch (e) {
    console.error('[initDB] 清理无效图片帖子失败:', e)
    return { cleaned: 0, error: e.errMsg || e.message }
  }
}
