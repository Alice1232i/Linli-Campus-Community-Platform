/**
 * ReportService - 举报服务
 * ------------------------------------------------------------
 * 负责举报的查询、处理等管理业务。
 * 处理举报时根据 action 执行对应操作：
 *   ban    - 封禁用户（可设天数）
 *   mute   - 禁言用户（可设天数）
 *   warn   - 警告用户（仅发通知）
 *   dismiss - 驳回举报
 * 处理后向被举报用户发送系统通知。
 */

const ReportRepository = require('../repositories/ReportRepository')
const UserRepository = require('../repositories/UserRepository')
const BaseRepository = require('../repositories/BaseRepository')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')
const axios = require('axios')
const cloudToken = require('../adapters/cloudToken')

// 举报结果订阅消息模板（一次性订阅）：thing2=举报内容 thing3=用户昵称 thing4=反馈内容 thing5=审核结果 time10=处理日期
const SUBSCRIBE_REPORT_TEMPLATE_ID = 'e9e-G1oO7Ed6uFKtUlZR9o2RHcdtGdi0P9_xtHYxdw4'

// 处理动作 → 审核结果文案
const ACTION_RESULT_TEXT = {
  ban: '已封禁',
  mute: '已禁言',
  warn: '已警告',
  dismiss: '举报不成立'
}

/**
 * 毫秒时间戳 → 'YYYY-MM-DD HH:mm'（订阅消息 time 字段格式）
 */
function formatDateTime(ts) {
  const d = new Date(ts || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// 允许的举报处理动作白名单
const ALLOWED_ACTIONS = ['ban', 'mute', 'warn', 'dismiss']

// 举报原因中文映射（与前端 REASON_MAP 保持一致）
const REASON_MAP = {
  spam: '垃圾广告',
  abuse: '辱骂攻击',
  porn: '色情低俗',
  fraud: '欺诈',
  privacy: '隐私侵犯',
  other: '其他'
}

// targetType → 集合名映射（用于反查被举报用户 openid）
const TARGET_COLLECTION_MAP = {
  post: 'posts',
  comment: 'comments',
  message: 'messages',
  lostfound: 'lost_found',
  delivery: 'delivery_tasks'
}

// 一天的毫秒数
const ONE_DAY_MS = 86400000

class ReportService {
  constructor() {
    this.reportRepo = new ReportRepository()
    this.userRepo = new UserRepository()
  }

  /**
   * 分页查询举报列表
   * @param {Object} filters 过滤条件
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getReports(filters) {
    return this.reportRepo.findWithFilters(filters)
  }

  /**
   * 批量删除举报
   * @param {string[]} ids 举报 id 数组
   * @returns {Promise<number>} 删除条数
   */
  async batchDeleteReports(ids) {
    return this.reportRepo.batchDelete(ids)
  }

  /**
   * 按 id 查询举报详情（含被举报内容反查）
   * 根据 targetType + targetId 反查被举报的帖子/评论内容，
   * 让管理员能直接看到具体是哪个内容违规被举报。
   * @param {string} id 举报 id
   * @returns {Promise<Object>}
   * @throws {Error} 举报不存在抛 3001
   */
  async getReportById(id) {
    const report = await this.reportRepo.findById(id)
    if (!report) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    // ---- 反查被举报内容摘要 ----
    // 让管理员能直接看到具体是哪个帖子/评论违规，无需手动拿 ID 去查
    report.targetContent = await this.fetchTargetContent(report.targetType, report.targetId)

    return report
  }

  /**
   * 根据 targetType + targetId 反查被举报内容摘要
   * @param {string} targetType 目标类型（post/comment/user 等）
   * @param {string} targetId 目标 ID
   * @returns {Promise<Object|null>} 被举报内容摘要 { type, title, content, images, author, status }
   */
  async fetchTargetContent(targetType, targetId) {
    if (!targetType || !targetId) return null

    try {
      if (targetType === 'post') {
        const postRepo = new BaseRepository('posts')
        const post = await postRepo.findById(targetId)
        if (!post) return { type: 'post', exists: false }
        return {
          type: 'post',
          exists: true,
          title: post.title || '',
          content: post.content || '',
          images: post.images || [],
          section: post.section || '',
          author: post.authorId || post.openid || '',
          status: post.status || ''
        }
      }

      if (targetType === 'comment') {
        const commentRepo = new BaseRepository('comments')
        const comment = await commentRepo.findById(targetId)
        if (!comment) return { type: 'comment', exists: false }
        return {
          type: 'comment',
          exists: true,
          content: comment.content || '',
          author: comment.authorId || comment.openid || '',
          postId: comment.postId || '',
          status: comment.status || ''
        }
      }

      if (targetType === 'user') {
        const user = await this.userRepo.findById(targetId)
        if (!user) return { type: 'user', exists: false }
        return {
          type: 'user',
          exists: true,
          nickname: user.nickname || '',
          avatar: user.avatar || '',
          status: user.status || ''
        }
      }

      // 其他类型（lostfound/delivery）查对应集合
      const collection = TARGET_COLLECTION_MAP[targetType]
      if (!collection) return null
      const repo = new BaseRepository(collection)
      const target = await repo.findById(targetId)
      if (!target) return { type: targetType, exists: false }
      return {
        type: targetType,
        exists: true,
        title: target.title || '',
        content: target.content || '',
        author: target.openid || '',
        status: target.status || ''
      }
    } catch (e) {
      console.error('[ReportService] 反查被举报内容失败:', targetType, targetId, e.message)
      return null
    }
  }

  /**
   * 处理举报
   * 1. 校验 action 白名单
   * 2. 更新举报记录（状态、处理人、处理结果、动作、天数）
   * 3. 反查被举报用户 openid
   * 4. 若 ban/mute，更新用户状态和到期时间
   * 5. 给被举报用户发送系统通知
   * @param {string} id 举报 id
   * @param {Object} data 处理参数
   * @param {string} data.action 处理动作（ban / mute / warn / dismiss）
   * @param {number} data.duration 封禁/禁言天数（0=永久，仅 ban/mute 有效）
   * @param {string} data.result 处理结果说明
   * @param {Object} adminInfo 处理人信息 { id, username }
   * @throws {Error} action 非法抛 1002
   */
  async handleReport(id, { action, duration, result }, adminInfo) {
    // action 白名单校验
    if (!ALLOWED_ACTIONS.includes(action)) {
      const err = new Error(ERROR_MESSAGES[ERRORS.PARAM_INVALID])
      err.code = ERRORS.PARAM_INVALID
      throw err
    }

    // 推导举报状态：dismiss 为驳回，其余为已处理
    const status = action === 'dismiss' ? 'rejected' : 'resolved'

    // 获取举报详情（需要 targetType/targetId 来反查被举报用户）
    const report = await this.reportRepo.findById(id)
    if (!report) return

    // 反查被举报用户 openid
    const targetOpenid = await this.getTargetOpenid(report.targetType, report.targetId)

    // 先执行用户处置（封禁/禁言）：失败抛错，举报状态保持未处理，管理员可重试。
    // 修复：此前先更新举报状态再封禁，封禁失败时会出现「举报已处理但用户未被处置」的不一致。
    if (targetOpenid && (action === 'ban' || action === 'mute')) {
      await this.applyUserAction(targetOpenid, action, duration)
    }

    // 用户处置成功后再更新举报记录状态
    await this.reportRepo.updateStatus(
      id, status, adminInfo.id, adminInfo.username, result, action, duration
    )

    // 发送通知给被举报用户（失败不影响主流程）
    // 通知的 refType/refId 设为被举报内容的类型和ID，使点击通知可跳转到对应帖子/评论详情
    if (targetOpenid) {
      try {
        await this.sendReportNotification(
          targetOpenid, action, duration, result, id,
          report.targetType, report.targetId, report.reason
        )
      } catch (e) {
        console.error('[ReportService] 发送通知失败:', e.message)
      }
      // 发送举报结果订阅消息（微信服务通知）：需被举报用户发布内容时已订阅该模板
      await this.sendSubscribeReportNotification(targetOpenid, report, action, result)
    }
  }

  /**
   * 发送举报结果订阅消息（微信服务通知）
   * 一次性订阅：被举报用户在发布内容时已通过 requestSubscribeMessage 订阅该模板
   * 未订阅/配额用完时静默失败，不影响举报处理主流程
   * @param {string} openid 被举报用户 openid
   * @param {Object} report 举报记录
   * @param {string} action 处理动作
   * @param {string} result 处理说明
   */
  async sendSubscribeReportNotification(openid, report, action, result) {
    if (!openid) return
    try {
      const token = await cloudToken.getAccessToken()
      const reasonText = (REASON_MAP[report.reason] || report.reason || '其他').slice(0, 20)
      const resultText = (ACTION_RESULT_TEXT[action] || '已处理').slice(0, 20)
      const feedbackText = (result || '您的举报已处理').slice(0, 20)
      // 用户昵称：被举报用户自己的昵称（收件人）
      let nickname = '您'
      try {
        const user = await this.userRepo.findByOpenid(openid)
        if (user && user.nickname) nickname = user.nickname.slice(0, 20)
      } catch (e) {
        console.warn('[ReportService] 查询被举报用户昵称失败:', e.message)
      }

      await axios.post('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + token, {
        touser: openid,
        template_id: SUBSCRIBE_REPORT_TEMPLATE_ID,
        page: 'pages/message/index',
        data: {
          thing2: { value: reasonText },
          thing3: { value: nickname },
          thing4: { value: feedbackText },
          thing5: { value: resultText },
          time10: { value: formatDateTime(Date.now()) }
        }
      }, { timeout: 10000 })
      console.log('[ReportService] 举报结果订阅消息发送成功:', openid.slice(0, 10))
    } catch (e) {
      console.error('[ReportService] 举报结果订阅消息发送失败（未订阅或配额用完）:', e.message)
    }
  }

  /**
   * 根据 targetType 和 targetId 反查被举报用户的 openid
   * @param {string} targetType 目标类型
   * @param {string} targetId 目标 ID
   * @returns {Promise<string|null>} 被举报用户 openid
   */
  async getTargetOpenid(targetType, targetId) {
    if (!targetType || !targetId) return null

    // 举报用户：targetId 可能是用户 id 或 openid
    if (targetType === 'user') {
      // 先按 id 查
      const user = await this.userRepo.findById(targetId)
      if (user) return user.openid
      // 再按 openid 查
      const userByOpenid = await this.userRepo.findByOpenid(targetId)
      return userByOpenid ? userByOpenid.openid : null
    }

    // 其他类型：查对应集合取作者 openid
    const collection = TARGET_COLLECTION_MAP[targetType]
    if (!collection) return null

    const repo = new BaseRepository(collection)
    const target = await repo.findById(targetId)
    if (!target) return null
    // posts 集合同时有 openid（从 _openid 映射）和 authorId 字段，优先取 openid
    // comments 集合的 _openid 被 normalize 映射为 openid
    return target.openid || target.authorId || null
  }

  /**
   * 对用户执行封禁/禁言
   * @param {string} openid 被举报用户 openid
   * @param {string} action 动作（ban / mute）
   * @param {number} duration 天数（0=永久）
   */
  async applyUserAction(openid, action, duration) {
    const user = await this.userRepo.findByOpenid(openid)
    if (!user) {
      console.warn('[ReportService] 被举报用户不存在:', openid)
      return
    }

    // 计算到期时间戳（0 表示永久）
    const expire = duration > 0 ? Date.now() + duration * ONE_DAY_MS : 0

    if (action === 'ban') {
      await this.userRepo.banUser(user.id, expire)
    } else if (action === 'mute') {
      await this.userRepo.muteUser(user.id, expire)
    }
  }

  /**
   * 发送举报处理通知给被举报用户
   * 通知的 refType/refId 设为被举报内容的类型和ID，
   * 使被举报用户点击通知可跳转到对应帖子/评论详情查看是哪条内容被警告
   * 通知正文包含举报原因和处理说明，让用户知道为什么被举报处理
   * @param {string} openid 被举报用户 openid
   * @param {string} action 处理动作
   * @param {number} duration 天数
   * @param {string} result 处理说明
   * @param {string} reportId 举报 ID
   * @param {string} targetType 被举报内容类型（post/comment/user 等）
   * @param {string} targetId 被举报内容 ID
   * @param {string} reason 举报原因（spam/abuse/porn/fraud/privacy/other）
   */
  async sendReportNotification(openid, action, duration, result, reportId, targetType, targetId, reason) {
    const durationText = duration > 0 ? `${duration}天` : '永久'
    const titleMap = {
      ban: `账号封禁通知（${durationText}）`,
      mute: `账号禁言通知（${durationText}）`,
      warn: '违规警告通知',
      dismiss: '举报处理通知'
    }

    // 拼接通知正文：举报原因 + 管理员处理说明
    const reasonText = REASON_MAP[reason] || reason || '其他'
    let body = `您的内容因「${reasonText}」被举报`
    if (result) {
      body += `。处理说明：${result}`
    } else {
      body += '，已被管理员处理'
    }

    const notifRepo = new BaseRepository('notifications')
    await notifRepo.insert({
      openid,
      type: 'system',
      title: titleMap[action] || '举报处理通知',
      body,
      // refType/refId 设为被举报内容的类型和ID，点击通知可跳转到帖子/评论详情
      refType: targetType || 'report',
      refId: targetId || reportId,
      senderId: 'system',
      senderName: '系统通知',
      senderAvatar: '',
      read: false
    })
  }
}

module.exports = ReportService
