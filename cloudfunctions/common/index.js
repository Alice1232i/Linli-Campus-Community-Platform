/**
 * 临里校园 - 通用配置云函数
 * ------------------------------------------------------------
 * 提供全局配置读取、板块列表、点赞冷数据归档等能力。
 * archiveLikes 可配置为定时触发器自动执行。
 *
 * 支持的 action：
 *   - getConfig     : 获取全局配置（按 key 或返回全部）
 *   - sections      : 获取社区板块列表
 *   - archiveLikes  : 归档超过 6 个月的点赞记录（定时触发器调用）
 *
 * 统一响应格式：{ code, data, message }
 */

const {
  initCloud,
  run,
  getOpenid,
  getUser,
  requireLogin,
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

/** 点赞记录归档阈值：6 个月（毫秒） */
const ARCHIVE_THRESHOLD = 6 * 30 * 24 * 60 * 60 * 1000

/**
 * action: getConfig
 * 获取全局配置：
 * 1. 无需登录（公开配置所有用户可读）
 * 2. 支持按 key 精确查询，不传 key 返回全部配置
 * 3. 返回 { config: { key1: value1, key2: value2 } }
 */
async function handleGetConfig(event, context) {
  const key = event.key || ''

  if (key) {
    // 按 key 查询单条配置
    const { data } = await db
      .collection('config')
      .where({ key })
      .limit(1)
      .get()

    if (data.length === 0) {
      return ok({ config: null })
    }
    return ok({ config: { [data[0].key]: data[0].value } })
  }

  // 返回全部配置
  const { data: list } = await db.collection('config').limit(100).get()
  const config = {}
  list.forEach((item) => {
    config[item.key] = item.value
  })
  return ok({ config })
}

/**
 * action: sections
 * 获取社区板块列表：
 * 1. 优先从 config 集合读取（支持运营动态配置）
 * 2. config 不存在时返回内置默认板块
 * 3. 返回 { sections: [{ key, name, icon }] }
 */
async function handleSections(event, context) {
  // 尝试从 config 集合读取板块配置
  const { data } = await db
    .collection('config')
    .where({ key: 'sections' })
    .limit(1)
    .get()

  if (data.length > 0 && data[0].value) {
    return ok({ sections: data[0].value })
  }

  // 降级：返回内置默认板块
  const defaultSections = [
    { key: 'daily', name: '日常', icon: '' },
    { key: 'secondhand', name: '二手', icon: '' },
    { key: 'help', name: '求助', icon: '' },
    { key: 'study', name: '学习', icon: '' },
    { key: 'emotion', name: '情感', icon: '' },
    { key: 'news', name: '资讯', icon: '' }
  ]
  return ok({ sections: defaultSections })
}

/**
 * action: archiveLikes
 * 点赞冷数据归档：
 * 1. 查询 likes 集合中 createdAt 超过 6 个月的记录
 * 2. 将其写入 likes_archive 集合
 * 3. 从 likes 集合中删除
 * 4. 分批处理，每批 100 条，避免单次操作超时
 * 5. 返回 { archived: 归档数量 }
 *
 * 建议配置定时触发器：每天凌晨 3 点执行
 * config.json 中配置：
 *   "triggers": [{ "type": "timer", "config": "0 0 3 * * * *" }]
 */
async function handleArchiveLikes(event, context) {
  // 鉴权：定时触发器放行；客户端调用需 admin 权限，避免任意用户触发数据删除
  const isTimer = context && context.triggerSource === 'timer'
  if (!isTimer) {
    const user = await getUser(getOpenid(context))
    requireRole(user, ['admin'])
  }
  const threshold = Date.now() - ARCHIVE_THRESHOLD
  let archived = 0
  const batchSize = 100

  // 循环分批处理，直到没有需要归档的记录
  // 最多处理 10 批，防止云函数超时
  for (let i = 0; i < 10; i++) {
    // 查询一批需要归档的点赞记录
    const { data: oldLikes } = await db
      .collection('likes')
      .where({ createdAt: _.lt(threshold) })
      .limit(batchSize)
      .get()

    if (oldLikes.length === 0) {
      break // 没有需要归档的记录了
    }

    // 逐条写入归档集合并删除原记录
    // 使用事务保证一致性
    for (const like of oldLikes) {
      try {
        await db.runTransaction(async (transaction) => {
          // 写入归档集合
          await transaction.collection('likes_archive').add({
            data: {
              _openid: like._openid,
              targetId: like.targetId,
              targetType: like.targetType,
              createdAt: like.createdAt,
              archivedAt: Date.now()
            }
          })
          // 删除原记录
          await transaction.collection('likes').doc(like._id).remove()
        })
        archived++
      } catch (e) {
        // 单条失败不影响整体归档，记录日志继续
        console.error('[archiveLikes] 归档失败:', like._id, e.message)
      }
    }

    // 如果本批不足 batchSize 条，说明已处理完
    if (oldLikes.length < batchSize) {
      break
    }
  }

  return ok({ archived })
}

/**
 * 云函数入口：按 action 分发
 */
exports.main = run(async (event, context) => {
  const { action } = event
  switch (action) {
    case 'getConfig':
      return handleGetConfig(event, context)
    case 'sections':
      return handleSections(event, context)
    case 'archiveLikes':
      return handleArchiveLikes(event, context)
    default:
      return fail(ERRORS.PARAM_INVALID, '未知操作')
  }
})
