/**
 * 临里校园 - 云函数统一鉴权 / 校验 / 响应工具（云函数端使用）
 * ------------------------------------------------------------
 * 集中处理云函数中常见的：初始化云环境、获取登录态、角色与认证校验、
 * 参数校验、内容安全检测、统一响应格式、异常捕获等工作。
 *
 * 注意：
 * 1. 本文件主要供云函数使用（依赖 wx-server-sdk 与云数据库）。
 * 2. 同步脚本会将其拷贝到前端 miniprogram/utils/shared/，为避免前端
 *    require 时立即报错，对 wx-server-sdk 的引入做了 try/catch 保护，
 *    前端不应调用其中的云函数专用方法。
 * 3. 获取 openid 必须使用 cloud.getWXContext().OPENID，绝不可信任
 *    客户端传入的 _openid 字段。
 *
 * 使用示例：
 *   const { initCloud, run, getOpenid, getUser, requireLogin, validate, ok, SCHEMAS } = require('./shared/guard')
 *   initCloud()
 *   exports.main = run(async (event) => {
 *     const openid = requireLogin(getOpenid())
 *     validate(event, SCHEMAS['post.create'])
 *     // ...业务逻辑
 *     return ok({ postId: 'xxx' })
 *   })
 */

// 引入依赖：wx-server-sdk 仅云函数环境可用，做保护性引入
let cloud = null
try {
  cloud = require('wx-server-sdk')
} catch (e) {
  // 前端环境无此模块，cloud 保持为 null
  cloud = null
}

const { SUCCESS, ERRORS, getError } = require('./errors')
const { SCHEMAS, validate: schemaValidate } = require('./schema')
const { VERIFY_STATUS, USER_STATUS } = require('./constants')

/** 云环境是否已初始化标记，避免重复 init */
let inited = false

/**
 * 初始化云开发环境
 * 使用 DYNAMIC_CURRENT_ENV 自动适配当前云环境
 * @returns {object} cloud 实例
 */
function initCloud() {
  if (!cloud) {
    throw new Error('当前环境不支持 wx-server-sdk，请在云函数中调用')
  }
  if (!inited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    inited = true
  }
  return cloud
}

/**
 * 从云函数上下文获取当前调用者 openid
 * 必须以服务端获取的 OPENID 为准，禁止信任客户端传入的 _openid
 * @param {object} [context] 云函数上下文（保留参数以兼容签名，实际未使用）
 * @returns {string} openid，未登录时为空字符串
 */
function getOpenid(context) {
  if (!cloud) return ''
  const wxContext = cloud.getWXContext()
  return wxContext.OPENID || ''
}

/**
 * 根据 openid 查询用户档案
 * 同一 openid 可能因 handleLogin 容错降级产生重复记录，
 * 按 updatedAt 降序取第一条（最新更新的），确保返回用户最近修改的资料。
 * 查询后自动检查禁言/封禁是否已到期，到期则自动恢复为正常状态。
 * @param {string} openid 用户openid
 * @returns {Promise<object|null>} 用户文档，不存在返回 null
 */
async function getUser(openid) {
  if (!openid) return null
  initCloud()
  const db = cloud.database()
  const { data } = await db
    .collection('users')
    .where({ openid })
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  const user = data[0] || null
  // 禁言/封禁到期自动恢复：每次读取用户时检查是否已过期
  if (user) {
    await checkAndRestoreUserStatus(user)
  }
  return user
}

/**
 * 禁言/封禁到期自动恢复
 * 检查用户的 muteExpire/banExpire 时间戳，若已过期则自动恢复为 active 状态。
 * 这样无需定时任务，用户下次操作时即可自动解除过期的禁言/封禁。
 * @param {object} user 用户文档（会被原地修改 status/expire 字段）
 */
async function checkAndRestoreUserStatus(user) {
  if (!user) return
  const now = Date.now()
  let needRestore = false

  // 禁言到期检查：muteExpire > 0 表示有期限（0 表示永久），到期后自动恢复
  if (user.status === USER_STATUS.MUTED && user.muteExpire && user.muteExpire > 0 && user.muteExpire < now) {
    needRestore = true
  }
  // 封禁到期检查：banExpire > 0 表示有期限（0 表示永久），到期后自动恢复
  if (user.status === USER_STATUS.BANNED && user.banExpire && user.banExpire > 0 && user.banExpire < now) {
    needRestore = true
  }

  if (needRestore) {
    try {
      initCloud()
      const db = cloud.database()
      await db.collection('users').doc(user._id).update({
        data: {
          status: USER_STATUS.ACTIVE,
          muteExpire: 0,
          banExpire: 0
        }
      })
      // 原地修改，让调用方立即看到恢复后的状态
      user.status = USER_STATUS.ACTIVE
      user.muteExpire = 0
      user.banExpire = 0
      console.log('[guard.checkAndRestoreUserStatus] 用户禁言/封禁已到期自动恢复:', user.openid)
    } catch (e) {
      console.warn('[guard.checkAndRestoreUserStatus] 自动恢复失败:', e.message)
    }
  }
}

/**
 * 构造业务错误对象（携带 code，便于 run 统一捕获）
 * @param {number} code 错误码
 * @param {string} [message] 错误描述，缺省时取错误码默认描述
 * @returns {Error} 携带 code 属性的 Error 实例
 */
function bizError(code, message) {
  const err = new Error(message || getError(code).message)
  err.code = code
  return err
}

/**
 * 校验登录态，未登录则抛出 UNAUTHORIZED 错误
 * @param {string} openid 由 getOpenid 获取的 openid
 * @returns {string} 校验通过的 openid
 */
function requireLogin(openid) {
  if (!openid) {
    throw bizError(ERRORS.UNAUTHORIZED)
  }
  return openid
}

/**
 * 校验用户角色，无权限则抛出 ROLE_DENIED 错误
 * @param {object} user 用户档案（getUser 返回值）
 * @param {string|string[]} roles 允许的角色（单个或数组）
 * @returns {object} 校验通过的用户对象
 */
function requireRole(user, roles) {
  if (!user) {
    throw bizError(ERRORS.UNAUTHORIZED)
  }
  // 封禁账号一律拒绝
  if (user.status === USER_STATUS.BANNED) {
    throw bizError(ERRORS.BLOCKED)
  }
  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(user.role)) {
    throw bizError(ERRORS.ROLE_DENIED)
  }
  return user
}

/**
 * 校验学生认证状态，未认证则抛出 NOT_VERIFIED 错误
 * @param {object} user 用户档案
 * @returns {object} 校验通过的用户对象
 */
function requireVerified(user) {
  if (!user) {
    throw bizError(ERRORS.UNAUTHORIZED)
  }
  if (user.verifyStatus !== VERIFY_STATUS.APPROVED) {
    throw bizError(ERRORS.NOT_VERIFIED)
  }
  return user
}

/**
 * 参数校验（封装 shared/schema.js 的 validate）
 * 校验失败时抛出 PARAM_INVALID 业务错误，由 run 统一捕获
 * @param {object} data 待校验数据（通常是 event）
 * @param {object} schema 校验规则
 * @returns {{ valid: true }} 校验通过结果
 */
function validate(data, schema) {
  const result = schemaValidate(data, schema)
  if (!result.valid) {
    throw bizError(ERRORS.PARAM_INVALID, result.message)
  }
  return result
}

/**
 * 构造成功响应
 * @param {*} data 业务数据
 * @param {string} [message] 提示信息
 * @returns {{ code: number, data: *, message: string }}
 */
function ok(data, message) {
  return {
    code: SUCCESS, // 成功码固定为 0
    data,
    message: message || 'ok'
  }
}

/**
 * 构造失败响应
 * @param {number} code 错误码
 * @param {string} [message] 错误描述，缺省时取错误码默认描述
 * @returns {{ code: number, data: null, message: string }}
 */
function fail(code, message) {
  return {
    code,
    data: null,
    message: message || getError(code).message
  }
}

/**
 * 文本内容安全检测（微信开放接口 security.msgSecCheck）
 *
 * 优先使用 v2 接口：传入 openid + scene 可获得细粒度结论（result.suggest: pass/review/risky）。
 * v2 调用失败（含 openid 不满足「近两小时访问过小程序」等前置条件）时自动降级 v1，
 * 保证发帖/评论主流程不因接口升级而不可用。
 *
 * @param {string} content 待检测文本
 * @param {string} [openid] 用户 openid，传入则走 v2
 * @param {number} [scene] 场景值：1 资料 / 2 评论 / 3 论坛 / 4 社交日志，默认 2
 * @returns {Promise<{ pass: boolean, error?: boolean, detail: * }>}
 *          pass=true 通过；error=true 表示审核服务异常（调用方自行决定放行或拒绝）
 */
async function contentCheck(content, openid, scene) {
  initCloud()
  const text = content || ''
  // 87014 = 内容含有违法违规内容：无论 v1/v2 均视为「内容违规」而非「服务异常」
  const isRiskErr = function (e) {
    return !!e && (e.errCode === 87014 || e.errcode === 87014)
  }

  // ---- v2：传入 openid 时优先使用，可拿到 suggest 细粒度结论 ----
  if (openid) {
    try {
      const res = await cloud.openapi.security.msgSecCheck({
        version: 2,
        openid: openid,
        scene: scene || 2,
        content: text
      })
      const suggest = (res && res.result && res.result.suggest) || ''
      // errCode 0 且 suggest 非 risky/review 视为通过（suggest 缺失时按 v1 语义兼容）
      const pass = res.errCode === 0 && suggest !== 'risky' && suggest !== 'review'
      return { pass: pass, detail: res }
    } catch (e) {
      if (isRiskErr(e)) return { pass: false, detail: e }
      // v2 前置条件不满足或接口异常 → 降级 v1，避免误伤主流程
      console.warn('[guard.contentCheck] v2 调用失败，降级 v1:', (e && e.errCode) || '', (e && e.message) || '')
    }
  }

  // ---- v1 兼容路径（无 openid，或 v2 降级）----
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text
    })
    // errCode === 0 表示内容正常
    return { pass: res.errCode === 0, detail: res }
  } catch (e) {
    if (isRiskErr(e)) return { pass: false, detail: e }
    // 调用异常时标记 error: true，让调用方区分「服务异常」与「内容违规」
    // 服务异常时调用方可选择放行（如用户资料更新），内容违规时才拒绝
    console.error('[guard.contentCheck] 调用失败:', e)
    return { pass: false, error: true, detail: e }
  }
}

/**
 * 图片内容安全检测（调用微信开放接口 security.imgSecCheck）
 * @param {Buffer} mediaBuffer 图片二进制数据
 * @param {string} [contentType] 图片 MIME 类型，默认 image/jpeg
 * @returns {Promise<{ pass: boolean, detail: * }>} pass 为 true 表示检测通过
 */
async function imageCheck(mediaBuffer, contentType) {
  initCloud()
  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: contentType || 'image/jpeg',
        value: mediaBuffer
      }
    })
    return { pass: res.errCode === 0, detail: res }
  } catch (e) {
    console.error('[guard.imageCheck] 调用失败:', e)
    return { pass: false, detail: e }
  }
}

/**
 * 批量将 cloud:// fileID 转换为 HTTP 临时 URL
 * 云存储安全规则可能限制跨用户读取，getTempFileURL 以管理员权限生成
 * 临时下载链接（默认有效期 2 小时），确保所有用户都能访问图片。
 *
 * 性能优化：容器级内存缓存（TTL 110 分钟）
 * 临时 URL 有效期 120 分钟，提前 10 分钟刷新避免边界失效。
 * 同一容器实例内高频重复的 fileID（如用户头像、热门帖子图片）
 * 命中缓存直接返回，跳过 getTempFileURL 网络调用（100-300ms/次）。
 *
 * @param {string[]} fileIds cloud:// 开头的文件 ID 列表（自动去重）
 * @returns {Promise<Object<string, string>>} { fileId: httpUrl } 映射表
 */
// ============ fileID → HTTPS 临时 URL 内存缓存 ============
// 容器级缓存，TTL 110 分钟（临时 URL 有效期 120 分钟，提前 10 分钟刷新）
const _fileUrlCache = new Map()
const FILE_URL_CACHE_TTL = 110 * 60 * 1000

async function resolveCloudFileIds(fileIds) {
  if (!fileIds || !fileIds.length) return {}
  // 去重，避免同一 fileID 重复请求
  const unique = []
  const seen = {}
  fileIds.forEach((id) => {
    if (id && id.indexOf('cloud://') === 0 && !seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  if (!unique.length) return {}

  const now = Date.now()
  const result = {}
  // 从缓存中命中已转换的 fileID，只对未命中的调用 API
  const uncached = []

  unique.forEach((id) => {
    const cached = _fileUrlCache.get(id)
    if (cached && now < cached.expireAt) {
      result[id] = cached.url
    } else {
      uncached.push(id)
    }
  })

  // 全部命中缓存，直接返回，跳过网络调用
  if (!uncached.length) return result

  initCloud()
  // getTempFileURL 单次最多 100 个，分批处理
  const BATCH = 100
  for (let i = 0; i < uncached.length; i += BATCH) {
    const chunk = uncached.slice(i, i + BATCH)
    try {
      const res = await cloud.getTempFileURL({
        fileList: chunk
      })
      if (res && res.fileList) {
        res.fileList.forEach((f) => {
          if (f.tempFileURL) {
            result[f.fileID] = f.tempFileURL
            // 写入缓存
            _fileUrlCache.set(f.fileID, {
              url: f.tempFileURL,
              expireAt: now + FILE_URL_CACHE_TTL
            })
          }
        })
      }
    } catch (e) {
      console.warn('[guard.resolveCloudFileIds] 转换失败:', e.message)
    }
  }
  return result
}

/**
 * 批量查询用户档案并构造作者信息映射
 * 用于读取路径实时填充帖子/评论的 author 字段，避免冗余快照过期
 *
 * 去重策略：同一 openid 可能因 handleLogin 容错降级产生重复记录，
 * 按 updatedAt 降序排列后取第一条（最新更新的），保证展示的是用户
 * 最近一次修改的资料，而非早期自动建档时的随机昵称。
 *
 * @param {string[]} openids 用户 openid 去重列表
 * @returns {Promise<object>} { openid: { nickname, avatar, verifyBadge, profileVersion } }
 */
async function batchGetUserMap(openids) {
  if (!openids || !openids.length) return {}
  initCloud()
  const db = cloud.database()
  const _ = db.command
  const map = {}
  // 云数据库 where in 查询单次最多 100 条，分批处理
  const BATCH = 100
  for (let i = 0; i < openids.length; i += BATCH) {
    const chunk = openids.slice(i, i + BATCH)
    try {
      const { data } = await db
        .collection('users')
        .where({ openid: _.in(chunk) })
        .orderBy('updatedAt', 'desc')
        .limit(chunk.length * 5)
        .get()
      // 按 updatedAt 降序遍历，同一 openid 只取第一条（最新更新）
      data.forEach((u) => {
        if (map[u.openid]) return // 已有记录（更早遍历到的 = 更新的），跳过
        map[u.openid] = {
          // 必须带上 _id：enrichAuthors 用它生成对外 userId（users._id），
          // 此前漏掉导致所有帖子的 author.userId 恒为空、点头像无法跳转作者主页
          _id: u._id || '',
          nickname: u.nickname || '',
          avatar: u.avatar || '',
          verifyBadge: !!u.verifyBadge,
          profileVersion: u.profileVersion || 0
        }
      })
    } catch (e) {
      console.warn('[guard.batchGetUserMap] 查询失败:', e.message)
    }
  }
  return map
}

/**
 * 为帖子/评论列表实时填充 author 字段
 * 核心思想：列表中只存储用户 ID，author 信息每次读取时从 users 表拉取最新资料
 * 这样用户修改昵称/头像后，所有历史帖子/评论都会展示最新身份
 *
 * 同时将头像 cloud:// fileID 批量转换为 HTTP 临时 URL，
 * 确保其他用户不受云存储安全规则限制，均能正常加载头像。
 *
 * @param {Array} items 帖子或评论列表
 * @param {string} [idField] 用户 ID 字段名，帖子用 'authorId'（默认），评论用 '_openid'
 * @returns {Promise<Array>} 填充 author 后的列表（原地修改并返回）
 */
async function enrichAuthors(items, idField) {
  if (!items || !items.length) return items
  const field = idField || 'authorId'
  // 收集所有作者 ID 并去重
  const idSet = {}
  items.forEach((item) => {
    const uid = item[field] || item._openid || ''
    if (uid) idSet[uid] = true
  })
  const openids = Object.keys(idSet)
  if (!openids.length) return items

  // 批量查询用户资料
  const userMap = await batchGetUserMap(openids)

  // 逐条注入最新 author 信息
  items.forEach((item) => {
    const uid = item[field] || item._openid || ''

    // ---- 匿名帖子处理：使用匿名昵称，不暴露真实用户信息 ----
    // 帖子创建时已写入 isAnonymous + anonymousName 字段
    // 此处据此展示匿名身份，真实 openid 仍保留在 authorId/_openid 供后台管理追溯
    if (item.isAnonymous) {
      item.author = {
        nickname: item.anonymousName || '匿名同学',
        avatar: '',
        verifyBadge: false
      }
      // 匿名帖不对外暴露作者真实 openid（authorId/_openid 仅供后台管理追溯）
      delete item.authorId
      delete item._openid
      return
    }

    const u = userMap[uid]
    if (u) {
      let avatar = u.avatar || ''
      // cloud:// fileID 暂时保留，稍后批量转换为 HTTP URL
      item.author = {
        nickname: u.nickname,
        avatar: avatar,
        verifyBadge: u.verifyBadge,
        // 对外暴露用户内部 ID（users._id），替代 openid 作为跳转/标识用途
        userId: u._id || ''
      }
    } else {
      // 用户档案不存在时（已注销等），给出占位信息
      item.author = {
        nickname: '匿名用户',
        avatar: '',
        verifyBadge: false
      }
    }
  })

  // 批量将头像 cloud:// fileID 转换为 HTTP 临时 URL
  const avatarFileIds = []
  items.forEach((item) => {
    if (item.author && item.author.avatar && item.author.avatar.indexOf('cloud://') === 0) {
      avatarFileIds.push(item.author.avatar)
    }
  })
  if (avatarFileIds.length) {
    const urlMap = await resolveCloudFileIds(avatarFileIds)
    items.forEach((item) => {
      if (item.author && item.author.avatar && urlMap[item.author.avatar]) {
        item.author.avatar = urlMap[item.author.avatar]
      }
    })
  }

  // ---- 统一移除对外响应中的 openid（数据库自动注入字段），避免他人 openid 泄露 ----
  // 身份判断一律使用 author.userId（users._id）与各接口返回的 isMine/isOwner 等权威字段
  items.forEach((item) => {
    delete item._openid
    delete item.authorId
  })

  return items
}

/**
 * 检查拉黑关系（当前用户是否拉黑了目标用户）
 * @param {string} openid 当前用户openid
 * @param {string} targetOpenid 目标用户openid
 * @returns {Promise<boolean>} 存在拉黑记录返回 true
 */
async function isBlocked(openid, targetOpenid) {
  if (!openid || !targetOpenid) return false
  initCloud()
  const db = cloud.database()
  const { data } = await db
    .collection('blocks')
    .where({ openid, targetOpenid })
    .limit(1)
    .get()
  return data.length > 0
}

// ============ 封禁用户列表内存缓存（容器级，TTL 5 分钟）============
// 用于信息流/搜索等场景排除被封禁用户的帖子，避免每次请求都查数据库
let _bannedOpenidsCache = null
let _bannedOpenidsExpireAt = 0
const BANNED_CACHE_TTL = 5 * 60 * 1000

/**
 * 获取被封禁用户的 openid 列表（内存缓存，TTL 5 分钟）
 * 查询 users 集合中 status='banned' 的用户 openid。
 * 注意：此处不区分永久封禁和临时封禁，临时封禁到期后由 getUser 自动恢复，
 * 缓存最多 5 分钟后刷新，过期封禁用户会自动从列表中移除。
 * @returns {Promise<string[]>} 被封禁用户的 openid 数组
 */
async function getBannedOpenids() {
  const now = Date.now()
  // 缓存未过期则直接返回
  if (_bannedOpenidsCache && now < _bannedOpenidsExpireAt) {
    return _bannedOpenidsCache
  }
  initCloud()
  const db = cloud.database()
  try {
    const { data } = await db
      .collection('users')
      .where({ status: USER_STATUS.BANNED })
      .field({ openid: true })
      .get()
    _bannedOpenidsCache = data.map(function (u) { return u.openid }).filter(Boolean)
  } catch (e) {
    console.warn('[guard.getBannedOpenids] 查询失败:', e.message)
    // 查询失败时使用上一次缓存（如果有），避免阻断主流程
    if (!_bannedOpenidsCache) _bannedOpenidsCache = []
  }
  _bannedOpenidsExpireAt = now + BANNED_CACHE_TTL
  return _bannedOpenidsCache
}

// ============ 搜索频率限制内存缓存（用户级，5 秒间隔）============
// 防止用户频繁搜索造成数据库压力
const _searchRateLimitCache = new Map()
const SEARCH_RATE_LIMIT_INTERVAL = 5 * 1000

/**
 * 检查搜索频率限制（同一用户 5 秒内仅允许一次搜索）
 * @param {string} openid 用户 openid
 * @returns {boolean} true=允许搜索，false=被限制
 */
function checkSearchRateLimit(openid) {
  if (!openid) return true
  const now = Date.now()
  const lastSearch = _searchRateLimitCache.get(openid)
  if (lastSearch && now - lastSearch < SEARCH_RATE_LIMIT_INTERVAL) {
    return false
  }
  _searchRateLimitCache.set(openid, now)
  return true
}

// ============ 评论频率限制（数据库版，10 秒间隔）============
// 防止用户恶意刷评论：查询最近 10 秒内该用户的评论记录。
// 采用数据库查询而非内存缓存，多实例/多容器下依然有效。
// 对应 initDB 中的 idx_comments_openid_createdAt 索引（评论频率限制）。
const COMMENT_RATE_LIMIT_INTERVAL = 10 * 1000

/**
 * 检查评论频率限制（同一用户 10 秒内仅允许发 1 条评论）
 * 查询该用户最近一条评论，与当前时间差小于 10 秒即拒绝
 * @param {string} openid 用户 openid
 * @returns {Promise<boolean>} true=允许评论，false=被限制
 */
async function checkCommentRateLimit(openid) {
  if (!openid) return true
  try {
    initCloud()
    const db = cloud.database()
    const { data } = await db
      .collection("comments")
      .where({ _openid: openid })
      .orderBy("createdAt", "desc")
      .limit(1)
      .get()
    if (!data || data.length === 0) return true
    return Date.now() - data[0].createdAt >= COMMENT_RATE_LIMIT_INTERVAL
  } catch (e) {
    // 限频查询失败时保守放行，避免限频故障阻塞正常评论
    console.warn("[guard.checkCommentRateLimit] 查询失败，放行:", e.message)
    return true
  }
}

/**
 * 通用 cloud:// 图片批量转换工具
 * 扫描对象/数组中的所有 cloud:// 字符串字段，批量转为 HTTPS 临时链接
 * 支持嵌套对象（如 publisher.avatar、author.avatar、images[] 等）
 *
 * @param {Object|Array} data 待处理的数据对象或数组（原地修改）
 * @param {string[]} [extraFields] 额外需要检查的字段名（默认扫描所有字符串值）
 * @returns {Promise<void>}
 */
async function resolveCloudImages(data, extraFields) {
  if (!data) return

  // 收集所有 cloud:// fileID
  const fileIdSet = {}

  function collect(obj) {
    if (!obj) return
    // 字符串直接检查（处理数组元素为字符串的情况，如 images: ['cloud://xxx']）
    if (typeof obj === 'string') {
      if (obj.indexOf('cloud://') === 0) fileIdSet[obj] = true
      return
    }
    if (typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        collect(obj[i])
      }
      return
    }
    for (const key in obj) {
      collect(obj[key])
    }
  }

  collect(data)

  const fileIds = Object.keys(fileIdSet)
  if (!fileIds.length) return

  // 批量转换为 HTTPS 临时链接
  const urlMap = await resolveCloudFileIds(fileIds)
  if (!urlMap || !Object.keys(urlMap).length) return

  // 回写转换后的 URL
  function rewrite(obj) {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'string' && urlMap[obj[i]]) {
          obj[i] = urlMap[obj[i]]
        } else {
          rewrite(obj[i])
        }
      }
      return
    }
    for (const key in obj) {
      if (typeof obj[key] === 'string' && urlMap[obj[key]]) {
        obj[key] = urlMap[obj[key]]
      } else {
        rewrite(obj[key])
      }
    }
  }

  rewrite(data)
}

/**
 * 云函数统一入口包装器
 * 自动捕获异常并转换为统一响应格式：
 *   - handler 返回标准格式（含 code 字段）：原样返回
 *   - handler 返回普通数据：包装为成功响应
 *   - 抛出业务错误（含 code）：返回对应失败响应
 *   - 抛出未知异常：返回 INTERNAL_ERROR
 * @param {(event: object, context: object) => Promise<*>} handler 业务处理函数
 * @returns {(event: object, context: object) => Promise<object>} 包装后的云函数入口
 */
function run(handler) {
  return async function (event, context) {
    try {
      const result = await handler(event, context)
      // 已是标准响应格式则直接返回
      if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'code')) {
        return result
      }
      // 否则视为成功业务数据
      return ok(result)
    } catch (err) {
      // 业务错误：携带 code
      if (err && err.code) {
        console.warn('[guard.run] 业务错误:', err.code, err.message)
        return fail(err.code, err.message)
      }
      // 未知异常：统一返回内部错误，避免泄漏堆栈
      console.error('[guard.run] 未捕获异常:', err)
      return fail(ERRORS.INTERNAL_ERROR, err && err.message)
    }
  }
}

module.exports = {
  // 透传导出 schema 集合，便于云函数直接引用
  SCHEMAS,
  // 透传导出错误码，便于业务侧使用
  ERRORS,
  // 工具方法
  initCloud,
  getOpenid,
  getUser,
  checkAndRestoreUserStatus,
  batchGetUserMap,
  resolveCloudFileIds,
  enrichAuthors,
  bizError,
  requireLogin,
  requireRole,
  requireVerified,
  validate,
  ok,
  fail,
  contentCheck,
  imageCheck,
  isBlocked,
  getBannedOpenids,
  checkSearchRateLimit,
  checkCommentRateLimit,
  resolveCloudImages,
  run
}
