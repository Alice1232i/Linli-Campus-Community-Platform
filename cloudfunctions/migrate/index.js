/**
 * 临里校园 - 数据库迁移云函数
 * ------------------------------------------------------------
 * 用途：清除 posts / comments 集合中历史遗留的冗余 author 字段，
 *       并为 users 集合补充 profileVersion 字段。
 *
 * 背景：身份同步改造后，帖子/评论表仅存储用户 ID（authorId/_openid），
 *       author 信息改由读取路径实时从 users 表拉取。
 *       历史数据中残留的 author 字段不再需要，执行此迁移可清除。
 *
 * 使用方式：
 *   部署后在微信开发者工具云开发控制台手动调用，或在小程序中调用：
 *   wx.cloud.callFunction({ name: 'migrate' })
 *
 * 返回：{ code, data: { postsRemoved, commentsRemoved, usersUpdated }, message }
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 单次批量更新上限（云数据库 where + update 单次最多处理 100 条）
const BATCH = 100

/**
 * 迁移 posts 集合：移除冗余 author 字段
 * 云数据库使用 db.command.remove() 在 update 中删除字段
 * @returns {Promise<number>} 已处理的文档数
 */
async function migratePosts() {
  let processed = 0
  let hasMore = true
  while (hasMore) {
    // 查询包含 author 字段的帖子（仅处理存量数据）
    const { data } = await db
      .collection('posts')
      .where({ author: _.exists(true) })
      .limit(BATCH)
      .get()

    if (!data.length) {
      hasMore = false
      break
    }

    // 逐条移除 author 字段（云数据库不支持批量 remove 单个字段，需逐文档更新）
    for (const post of data) {
      try {
        await db
          .collection('posts')
          .doc(post._id)
          .update({
            data: {
              author: _.remove()
            }
          })
        processed++
      } catch (e) {
        console.warn('[migrate.posts] 跳过文档:', post._id, e.message)
      }
    }

    // 如果本批不足 BATCH 条，说明已处理完
    if (data.length < BATCH) {
      hasMore = false
    }
  }
  return processed
}

/**
 * 迁移 comments 集合：移除冗余 author 字段
 * @returns {Promise<number>} 已处理的文档数
 */
async function migrateComments() {
  let processed = 0
  let hasMore = true
  while (hasMore) {
    const { data } = await db
      .collection('comments')
      .where({ author: _.exists(true) })
      .limit(BATCH)
      .get()

    if (!data.length) {
      hasMore = false
      break
    }

    for (const comment of data) {
      try {
        await db
          .collection('comments')
          .doc(comment._id)
          .update({
            data: {
              author: _.remove()
            }
          })
        processed++
      } catch (e) {
        console.warn('[migrate.comments] 跳过文档:', comment._id, e.message)
      }
    }

    if (data.length < BATCH) {
      hasMore = false
    }
  }
  return processed
}

/**
 * 迁移 users 集合：为缺少 profileVersion 的用户补充该字段
 * profileVersion 用于头像 URL 缓存穿透，初始值设为创建时间
 * @returns {Promise<number>} 已处理的文档数
 */
async function migrateUsers() {
  let processed = 0
  let hasMore = true
  while (hasMore) {
    const { data } = await db
      .collection('users')
      .where({ profileVersion: _.exists(false) })
      .limit(BATCH)
      .get()

    if (!data.length) {
      hasMore = false
      break
    }

    for (const user of data) {
      try {
        await db
          .collection('users')
          .doc(user._id)
          .update({
            data: {
              profileVersion: user.createdAt || Date.now()
            }
          })
        processed++
      } catch (e) {
        console.warn('[migrate.users] 跳过文档:', user._id, e.message)
      }
    }

    if (data.length < BATCH) {
      hasMore = false
    }
  }
  return processed
}

/**
 * 鉴权：仅管理员可执行数据库迁移（一次性运维操作）
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
 */
exports.main = async (event, context) => {
  console.log('[migrate] 开始数据库迁移...')

  // 鉴权：仅管理员可执行，避免任意客户端触发批量数据改写
  try {
    await requireAdmin(context)
  } catch (e) {
    return { code: 403, data: null, message: e.message || '无权限' }
  }

  try {
    const postsRemoved = await migratePosts()
    console.log('[migrate] posts 冗余 author 字段已清除:', postsRemoved)

    const commentsRemoved = await migrateComments()
    console.log('[migrate] comments 冗余 author 字段已清除:', commentsRemoved)

    const usersUpdated = await migrateUsers()
    console.log('[migrate] users profileVersion 已补充:', usersUpdated)

    return {
      code: 0,
      data: {
        postsRemoved,
        commentsRemoved,
        usersUpdated
      },
      message: '迁移完成'
    }
  } catch (err) {
    console.error('[migrate] 迁移失败:', err)
    return {
      code: 500,
      data: null,
      message: '迁移失败: ' + (err.message || '未知错误')
    }
  }
}
