/**
 * PostController - 帖子控制器
 * ------------------------------------------------------------
 * 处理帖子列表查询、详情、置顶/加精切换、状态更新、删除等 HTTP 请求。
 * 列表接口从 ctx.query 解析筛选与分页参数，分页由 parsePagination 工具统一处理。
 */

const PostService = require('../services/PostService')
const { parsePagination } = require('../utils/pagination')
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

/** 管理端允许设置的帖子状态白名单 */
const ALLOWED_POST_STATUS = ['normal', 'hidden', 'reviewing']

class PostController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.postService = new PostService()
  }

  /**
   * 分页查询帖子列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    // 解析分页参数（page / pageSize / offset），非法值回退默认
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，未传的字段为 undefined，由 Repository 自行忽略
    const filters = {
      status: query.status,
      module: query.module, // module 为 CommonJS 模块级变量名，此处作为对象 key 不冲突
      section: query.section,
      keyword: query.keyword,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.postService.getPosts(filters)
    ctx.success(result)
  }

  /**
   * 查询帖子详情
   * @param {Object} ctx Koa 上下文
   */
  async detail(ctx) {
    const { id } = ctx.params
    const result = await this.postService.getPostById(id)
    ctx.success(result)
  }

  /**
   * 切换帖子置顶状态
   * @param {Object} ctx Koa 上下文
   */
  async toggleTop(ctx) {
    const { id } = ctx.params
    const { isTop } = ctx.request.body
    // 布尔类型校验：字符串 "false" 此前会被当 truthy 误置顶
    if (typeof isTop !== 'boolean') {
      ctx.fail(ERRORS.PARAM_INVALID, 'isTop 必须为布尔值')
      return
    }
    await this.postService.toggleTop(id, isTop)
    ctx.success(null, '置顶状态更新成功')
  }

  /**
   * 切换帖子加精状态
   * @param {Object} ctx Koa 上下文
   */
  async toggleEssence(ctx) {
    const { id } = ctx.params
    const { isEssence } = ctx.request.body
    // 布尔类型校验
    if (typeof isEssence !== 'boolean') {
      ctx.fail(ERRORS.PARAM_INVALID, 'isEssence 必须为布尔值')
      return
    }
    await this.postService.toggleEssence(id, isEssence)
    ctx.success(null, '加精状态更新成功')
  }

  /**
   * 更新帖子状态
   * @param {Object} ctx Koa 上下文
   */
  async updateStatus(ctx) {
    const { id } = ctx.params
    const { status } = ctx.request.body
    // 枚举白名单校验：此前可写入任意字符串造成脏数据
    if (!ALLOWED_POST_STATUS.includes(status)) {
      ctx.fail(ERRORS.PARAM_INVALID, 'status 取值不合法')
      return
    }
    await this.postService.updatePostStatus(id, status)
    ctx.success(null, '帖子状态更新成功')
  }

  /**
   * 删除帖子
   * @param {Object} ctx Koa 上下文
   */
  async remove(ctx) {
    const { id } = ctx.params
    await this.postService.deletePost(id)
    ctx.success(null, '删除成功')
  }
}

module.exports = PostController
