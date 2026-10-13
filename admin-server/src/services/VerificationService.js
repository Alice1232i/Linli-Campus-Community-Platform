/**
 * VerificationService - 认证服务
 * ------------------------------------------------------------
 * 负责学生认证申请的查询、审核通过 / 驳回等管理业务。
 */

const VerificationRepository = require('../repositories/VerificationRepository')
const dbAdapter = require('../adapters')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

class VerificationService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.verificationRepo = new VerificationRepository()
  }

  /**
   * 校验认证记录存在且处于待审核状态
   * @param {string} id 认证记录 id
   * @returns {Promise<Object>} 认证记录
   */
  async assertPending(id) {
    const verification = await this.verificationRepo.findById(id)
    if (!verification) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }
    if (verification.status !== 'pending') {
      const err = new Error('仅待审核状态可操作，请刷新后重试')
      err.code = ERRORS.OPERATION_FAILED
      throw err
    }
    return verification
  }

  /**
   * 分页查询认证记录列表
   * @param {Object} filters 过滤条件（status / keyword / 时间范围 / 分页）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getVerifications(filters) {
    return this.verificationRepo.findWithFilters(filters)
  }

  /**
   * 审核通过认证申请
   * @param {string} id 认证记录 id
   * @returns {Promise<number>} 受影响行数
   */
  async approveVerification(id, reviewer = {}) {
    // 校验存在且待审核
    const verification = await this.assertPending(id)
    // 更新状态 + 审核人
    await this.verificationRepo.updateStatus(id, 'approved', reviewer)
    // 联动更新对应用户的认证状态（此前审核通过后用户端仍显示未认证）
    if (verification.openid) {
      try {
        await dbAdapter.update(
          'users',
          { openid: verification.openid },
          { studentVerified: true, verifyBadge: true }
        )
      } catch (e) {
        console.error('[VerificationService] 更新用户认证状态失败:', verification.openid, e.message)
        throw e
      }
    }
    return { updated: true }
  }

  /**
   * 驳回认证申请
   * @param {string} id 认证记录 id
   * @returns {Promise<number>} 受影响行数
   */
  async rejectVerification(id, reviewer = {}) {
    // 校验存在且待审核
    await this.assertPending(id)
    // 更新状态 + 审核人
    await this.verificationRepo.updateStatus(id, 'rejected', reviewer)
    return { updated: true }
  }
}

module.exports = VerificationService
