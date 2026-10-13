/**
 * FeedbackService - 意见箱服务
 * ------------------------------------------------------------
 * 负责测试版本用户反馈的查询、标记处理等管理业务。
 * 反馈由小程序「意见箱」（feedback 云函数）写入 feedbacks 集合，
 * 处理结果（status / reply）会回显到小程序「我的反馈」。
 */

const FeedbackRepository = require('../repositories/FeedbackRepository')
const UserRepository = require('../repositories/UserRepository')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

// 反馈类型中文映射（与小程序端 TYPE_LABEL 保持一致）
const TYPE_MAP = {
  suggestion: '功能建议',
  bug: '问题反馈',
  other: '其他'
}

class FeedbackService {
  constructor() {
    this.feedbackRepo = new FeedbackRepository()
    this.userRepo = new UserRepository()
  }

  /**
   * 分页查询反馈列表，并批量补充提交者昵称/头像
   * @param {Object} filters 过滤条件（透传给 Repository）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getFeedbacks(filters) {
    const result = await this.feedbackRepo.findWithFilters(filters)

    // 批量反查提交者信息（users 集合以显式 openid 字段关联）
    const openids = [...new Set((result.list || []).map((item) => item.openid).filter(Boolean))]
    const userMap = {}
    if (openids.length > 0) {
      try {
        const users = await this.userRepo.findAll({ openid: { $in: openids } })
        for (const u of users) {
          userMap[u.openid] = u
        }
      } catch (e) {
        // 用户信息补充失败不阻塞列表展示，降级为显示 openid
        console.error('[FeedbackService] 补充提交者信息失败:', e.message)
      }
    }

    result.list = (result.list || []).map((item) => {
      const user = userMap[item.openid]
      return {
        ...item,
        typeText: TYPE_MAP[item.type] || item.type || '其他',
        reporter: (user && user.nickname) || '匿名同学',
        reporterAvatar: (user && user.avatar) || ''
      }
    })

    return result
  }

  /**
   * 标记反馈为已处理
   * @param {string} id 反馈 id
   * @param {Object} data { reply 官方回复（选填） }
   * @param {string} handlerName 处理人姓名
   * @returns {Promise<Object>} 更新后的反馈
   */
  async markHandled(id, data, handlerName) {
    const feedback = await this.feedbackRepo.findById(id)
    if (!feedback) {
      throw new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND] || '反馈不存在')
    }

    const reply = String((data && data.reply) || '').trim()
    if (reply.length > 200) {
      throw new Error('回复内容不能超过 200 字')
    }

    await this.feedbackRepo.markHandled(id, { reply }, handlerName)

    // 返回更新后的记录，供前端刷新当前行
    return this.feedbackRepo.findById(id)
  }

  /**
   * 批量删除反馈
   * @param {string[]} ids 反馈 id 数组
   * @returns {Promise<{deleted: number}>}
   */
  async batchDeleteFeedbacks(ids) {
    const deleted = await this.feedbackRepo.batchDelete(ids)
    return { deleted }
  }
}

module.exports = FeedbackService
