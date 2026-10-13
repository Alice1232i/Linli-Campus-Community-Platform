/**
 * 字段映射表 - MongoDB 风格字段 ↔ MySQL 规范化字段
 * ------------------------------------------------------------
 * 核心作用：CloudDbAdapter 从云数据库读出数据后，
 *   将 _id → id、嵌套对象拍平为独立字段；
 *   写入云数据库前，反向将规范字段还原为 Mongo 风格。
 * 业务代码只接触规范化字段，永远不直接操作 _id / 嵌套 stats。
 *
 * 切换到 MySQL 时，MySqlAdapter 直接使用规范化字段，
 *   无需映射，fieldMapping 不再参与调用链。
 */

/**
 * 通用字段映射（所有集合共享）
 * key   : 云数据库原始字段名
 * value : 规范化字段名（也是 MySQL 列名）
 */
const COMMON_FIELD_MAP = {
  '_id': 'id',
  '_openid': 'openid',
  'createdAt': 'created_at',
  'updatedAt': 'updated_at',
  'resolvedAt': 'resolved_at'
}

/**
 * 各集合适用的额外字段映射（嵌套对象拍平）
 * key   : 云数据库中的嵌套路径
 * value : 规范化字段名
 */
const COLLECTION_FIELD_MAP = {
  // posts 集合：嵌套 stats、tradeInfo 拍平
  posts: {
    'stats.likes': 'like_count',
    'stats.comments': 'comment_count',
    'stats.views': 'view_count',
    'stats.shares': 'share_count',
    'stats.favorites': 'favorite_count',
    'tradeInfo.price': 'trade_price',
    'tradeInfo.condition': 'trade_condition',
    'tradeInfo.location': 'trade_location',
    // 运营字段：云数据库用驼峰，规范化用蛇形
    'isTop': 'is_top',
    'isEssence': 'is_essence',
    'topExpire': 'top_expire',
    'sortTime': 'sort_time'
  },
  // users 集合：嵌套 stats 拍平 + 禁言/封禁到期时间驼峰转蛇形
  // 注意：users 集合的 openid 是注册时手动写入的显式字段（非云数据库自动 _openid），
  // 必须添加 'openid':'openid' 自映射，覆盖通用映射 _openid→openid 的反向映射，
  // 否则 findByOpenid 查询时 openid 会被还原为 _openid，导致查不到用户
  // feedbacks 集合：处理时间驼峰转蛇形（createdAt/_openid 走通用映射）
  feedbacks: {
    'handledAt': 'handled_at'
  },
  users: {
    'openid': 'openid',
    'stats.postCount': 'post_count',
    'stats.likeCount': 'like_received_count',
    'stats.followerCount': 'follower_count',
    'stats.followingCount': 'following_count',
    'banExpire': 'ban_expire',
    'muteExpire': 'mute_expire'
  },
  // comments 集合：嵌套 replyTo 拍平
  comments: {
    'replyTo.userId': 'reply_to_user_id',
    'replyTo.nickname': 'reply_to_nickname'
  },
  // reports 集合：handler 为字符串（处理人名称），不做嵌套拍平
  // 避免写入时 denormalize 把 handler_id 还原为嵌套对象导致类型冲突
  reports: {},
  // operation_logs 集合：operationLogger 中间件用蛇形命名写入
  // 添加映射让 normalize/denormalize 自动转换驼峰 ↔ 蛇形，
  // 使 Repository 查询条件（蛇形）与云数据库存储（驼峰）正确匹配
  operation_logs: {
    'adminId': 'admin_id',
    'adminName': 'admin_name',
    'targetType': 'target_type',
    'targetId': 'target_id',
    'statusCode': 'status_code',
    'beforeData': 'before_data',
    'afterData': 'after_data',
    'requestBody': 'request_body',
    'logHash': 'log_hash'
  }
}

/**
 * 获取指定集合的完整字段映射（通用 + 集合专属）
 * @param {string} collection 集合名
 * @returns {Object} { 原始字段: 规范化字段 }
 */
function getFieldMap(collection) {
  return {
    ...COMMON_FIELD_MAP,
    ...(COLLECTION_FIELD_MAP[collection] || {})
  }
}

/**
 * 反向映射：规范化字段 → 云数据库原始字段
 * @param {string} collection 集合名
 * @returns {Object} { 规范化字段: 原始字段 }
 */
function getReverseFieldMap(collection) {
  const map = getFieldMap(collection)
  const reversed = {}
  for (const [orig, norm] of Object.entries(map)) {
    reversed[norm] = orig
  }
  return reversed
}

/**
 * 数组类字段标记（这些字段在 Mongo 中是数组，MySQL 中用 JSON 列存储）
 * 适配器在序列化/反序列化时需特殊处理
 */
const ARRAY_FIELDS = {
  posts: ['images', 'tags'],
  comments: [],
  users: [],
  reports: ['evidence'],
  notifications: []
}

/**
 * 判断某字段是否为数组类型
 */
function isArrayField(collection, field) {
  return (ARRAY_FIELDS[collection] || []).includes(field)
}

module.exports = {
  COMMON_FIELD_MAP,
  COLLECTION_FIELD_MAP,
  getFieldMap,
  getReverseFieldMap,
  isArrayField
}
