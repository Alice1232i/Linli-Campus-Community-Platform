/**
 * UserService - 用户服务
 * ------------------------------------------------------------
 * 负责小程序用户的查询、状态与角色更新等管理业务。
 * 对状态 / 角色取值进行白名单校验，非法值抛 1002。
 * 用户标识使用 id（_id 映射），因云数据库 HTTP API where() 不支持 _openid 查询。
 * 查询用户时自动检查禁言/封禁是否到期，到期则自动恢复为 active 状态。
 */

const UserRepository = require('../repositories/UserRepository')
const dbAdapter = require('../adapters')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

// 允许的用户状态白名单
const ALLOWED_STATUS = ['active', 'muted', 'banned']
// 允许的用户角色白名单
const ALLOWED_ROLE = ['user', 'merchant', 'admin']
// 一天的毫秒数
const ONE_DAY_MS = 86400000

class UserService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.userRepo = new UserRepository()
  }

  /**
   * 分页查询用户列表
   * 查询后自动检查并恢复已过期的禁言/封禁用户
   * @param {Object} filters 过滤条件（status / role / keyword / 时间范围 / 分页）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getUsers(filters) {
    const result = await this.userRepo.findWithFilters(filters)
    // 批量检查列表中是否有禁言/封禁已过期的用户，有则自动恢复
    await this.batchCheckAndRestore(result.list)
    return result
  }

  /**
   * 按 id 查询用户
   * 查询后自动检查禁言/封禁是否到期，到期则自动恢复
   * @param {string} id 用户 id（_id 映射）
   * @returns {Promise<Object>}
   * @throws {Error} 用户不存在抛 3001
   */
  async getUserById(id) {
    const user = await this.userRepo.findById(id)

    // 用户不存在抛 3001
    if (!user) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    // 禁言/封禁到期自动恢复
    await this.checkAndRestoreStatus(user)

    return user
  }

  /**
   * 检查单个用户的禁言/封禁是否已到期，到期则自动恢复为 active
   * @param {Object} user 用户对象（会被原地修改 status/expire 字段）
   */
  async checkAndRestoreStatus(user) {
    if (!user) return
    const now = Date.now()
    let needRestore = false

    // 禁言到期检查：mute_expire > 0 表示有期限（0=永久），到期后自动恢复
    if (user.status === 'muted' && user.mute_expire && user.mute_expire > 0 && user.mute_expire < now) {
      needRestore = true
    }
    // 封禁到期检查：ban_expire > 0 表示有期限（0=永久），到期后自动恢复
    if (user.status === 'banned' && user.ban_expire && user.ban_expire > 0 && user.ban_expire < now) {
      needRestore = true
    }

    if (needRestore) {
      try {
        await this.userRepo.unbanUser(user.id)
        user.status = 'active'
        user.mute_expire = 0
        user.ban_expire = 0
        console.log('[UserService] 用户禁言/封禁已到期自动恢复:', user.id, user.openid)
      } catch (e) {
        console.warn('[UserService] 自动恢复失败:', e.message)
      }
    }
  }

  /**
   * 批量检查用户列表中是否有禁言/封禁已过期的用户
   * @param {Array} users 用户列表
   */
  async batchCheckAndRestore(users) {
    if (!users || !users.length) return
    for (const user of users) {
      await this.checkAndRestoreStatus(user)
    }
  }

  /**
   * 更新用户状态
   * 当状态为 muted 时，设置禁言到期时间（duration 天后，0=永久）
   * 当状态为 banned 时，设置封禁到期时间（duration 天后，0=永久）
   * 当状态为 active 时，清除所有到期时间（解除禁言/封禁）
   * @param {string} id 用户 id
   * @param {string} status 状态（active / muted / banned）
   * @param {number} [duration] 禁言/封禁天数（0=永久，仅 muted/banned 有效）
   * @returns {Promise<number>} 受影响行数
   * @throws {Error} 状态值非法抛 1002
   */
  async updateUserStatus(id, status, duration) {
    // 存在性校验 + 获取原状态（用于解除后发送通知）
    const originUser = await this.getUserById(id)

    // 状态值白名单校验，非法抛 1002
    if (!ALLOWED_STATUS.includes(status)) {
      const err = new Error(ERROR_MESSAGES[ERRORS.PARAM_INVALID])
      err.code = ERRORS.PARAM_INVALID
      throw err
    }

    // duration 校验：必须为非负数值，此前负数/字符串会被当作 0=永久封禁
    if (duration !== undefined && duration !== null) {
      if (typeof duration !== 'number' || Number.isNaN(duration) || duration < 0) {
        const err = new Error(ERROR_MESSAGES[ERRORS.PARAM_INVALID])
        err.code = ERRORS.PARAM_INVALID
        throw err
      }
    }

    // 计算到期时间戳（0 表示永久）
    const expire = duration > 0 ? Date.now() + duration * ONE_DAY_MS : 0

    if (status === 'muted') {
      const result = await this.userRepo.muteUser(id, expire)
      // 禁言时通知用户（此前仅解除时有通知，手动禁言无感知）
      await this.notifyStatusChange(
        originUser,
        duration > 0 ? `您的账号已被禁言 ${duration} 天，期间无法发布内容与评论` : '您的账号已被永久禁言，期间无法发布内容与评论'
      )
      return result
    }

    if (status === 'banned') {
      const result = await this.userRepo.banUser(id, expire)
      // 封禁时通知用户
      await this.notifyStatusChange(
        originUser,
        duration > 0 ? `您的账号已被封禁 ${duration} 天` : '您的账号已被永久封禁'
      )
      return result
    }

    // active：恢复正常，清除到期时间；解除禁言/封禁后发送系统通知
    const result = await this.userRepo.unbanUser(id)
    if (originUser && originUser.status === 'muted') {
      await this.notifyStatusChange(originUser, '您的账号已被解除禁言，现在可以正常发布内容与互动了')
    } else if (originUser && originUser.status === 'banned') {
      await this.notifyStatusChange(originUser, '您的账号已被解除封禁，欢迎回来')
    }
    return result
  }

  /**
   * 向用户发送账号状态变更系统通知
   * @param {Object} user 用户记录（含 openid）
   * @param {string} message 通知正文
   */
  async notifyStatusChange(user, message) {
    if (!user || !user.openid) return
    try {
      await dbAdapter.insert('notifications', {
        openid: user.openid,
        type: 'system',
        title: '账号状态变更',
        body: message,
        refType: '',
        refId: '',
        read: false,
        created_at: Date.now()
      })
    } catch (e) {
      console.error('[UserService] 发送账号状态变更通知失败:', e.message)
    }
  }

  /**
   * 解除封禁/禁言（恢复为正常状态）
   * @param {string} id 用户 id
   * @returns {Promise<number>} 受影响行数
   */
  async unbanUser(id) {
    // 存在性校验 + 获取原状态
    const user = await this.getUserById(id)
    const result = await this.userRepo.unbanUser(id)
    // 解除后发送系统通知（区分禁言/封禁）
    if (user && user.status === 'muted') {
      await this.notifyStatusChange(user, '您的账号已被解除禁言，现在可以正常发布内容与互动了')
    } else if (user && user.status === 'banned') {
      await this.notifyStatusChange(user, '您的账号已被解除封禁，欢迎回来')
    }
    return result
  }

  /**
   * 更新用户角色
   * @param {string} id 用户 id
   * @param {string} role 角色（user / merchant / admin）
   * @returns {Promise<number>} 受影响行数
   * @throws {Error} 角色值非法抛 1002
   */
  async updateUserRole(id, role) {
    // 存在性校验：用户不存在抛 3001
    await this.getUserById(id)

    // 角色值白名单校验，非法抛 1002
    if (!ALLOWED_ROLE.includes(role)) {
      const err = new Error(ERROR_MESSAGES[ERRORS.PARAM_INVALID])
      err.code = ERRORS.PARAM_INVALID
      throw err
    }

    return this.userRepo.updateRoleById(id, role)
  }

  /**
   * 删除用户（硬删除）
   * 从数据库中移除用户记录，用户发布的帖子/评论仍保留
   * @param {string} id 用户 id
   * @returns {Promise<number>} 受影响行数
   * @throws {Error} 用户不存在抛 3001
   */
  async deleteUser(id) {
    // 先查询用户是否存在
    const user = await this.userRepo.findById(id)
    if (!user) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    return this.userRepo.removeById(id)
  }
}

module.exports = UserService
