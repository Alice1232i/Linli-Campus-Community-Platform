/**
 * PostService - 帖子服务
 * ------------------------------------------------------------
 * 负责帖子的查询、置顶/加精切换、状态更新、删除等管理业务。
 * Service 层封装 Repository 调用，并处理资源不存在等业务错误。
 */

const PostRepository = require('../repositories/PostRepository')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

class PostService {
  constructor() {
    // 构造函数中实例化对应的 Repository
    this.postRepo = new PostRepository()
  }

  /**
   * 分页查询帖子列表
   * @param {Object} filters 过滤条件（status / module / section / keyword / 时间范围 / 分页）
   * @returns {Promise<{list: Array, total: number, page: number, pageSize: number}>}
   */
  async getPosts(filters) {
    return this.postRepo.findWithFilters(filters)
  }

  /**
   * 按 id 查询帖子详情
   * @param {string} id 帖子 id
   * @returns {Promise<Object>}
   * @throws {Error} 帖子不存在抛 3001
   */
  async getPostById(id) {
    const post = await this.postRepo.findById(id)

    // 帖子不存在抛 3001
    if (!post) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }

    return post
  }

  /**
   * 切换帖子置顶状态
   * @param {string} id 帖子 id
   * @param {boolean} isTop 是否置顶
   * @returns {Promise<number>} 受影响行数
   */
  async toggleTop(id, isTop) {
    await this.assertPostExists(id)
    return this.postRepo.toggleTop(id, isTop)
  }

  /**
   * 切换帖子加精状态
   * @param {string} id 帖子 id
   * @param {boolean} isEssence 是否加精
   * @returns {Promise<number>} 受影响行数
   */
  async toggleEssence(id, isEssence) {
    await this.assertPostExists(id)
    return this.postRepo.toggleEssence(id, isEssence)
  }

  /**
   * 更新帖子状态
   * @param {string} id 帖子 id
   * @param {string} status 新状态
   * @returns {Promise<number>} 受影响行数
   */
  async updatePostStatus(id, status) {
    await this.assertPostExists(id)
    return this.postRepo.updateStatus(id, status)
  }

  /**
   * 删除帖子（逻辑删除）
   * 合规要求：UGC内容不物理删除，仅标记 status='deleted'，
   * 原始内容永久留存供审计追溯，操作日志由中间件自动记录 before/after 快照
   * @param {string} id 帖子 id
   * @returns {Promise<number>} 受影响行数
   */
  async deletePost(id) {
    await this.assertPostExists(id)
    return this.postRepo.updateStatus(id, 'deleted')
  }

  /**
   * 校验帖子存在，不存在抛 3001（防止误传 ID 静默返回成功）
   * @param {string} id 帖子 id
   * @returns {Promise<Object>} 帖子
   */
  async assertPostExists(id) {
    const post = await this.postRepo.findById(id)
    if (!post) {
      const err = new Error(ERROR_MESSAGES[ERRORS.NOT_FOUND])
      err.code = ERRORS.NOT_FOUND
      throw err
    }
    return post
  }
}

module.exports = PostService
