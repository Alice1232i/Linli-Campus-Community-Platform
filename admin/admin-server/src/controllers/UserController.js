/**
 * UserController - 用户控制器
 * ------------------------------------------------------------
 * 处理小程序用户的列表查询、详情、状态与角色更新等 HTTP 请求。
 * 用户主键为 id（_id 映射），由路由参数 :id 提供。
 */

const UserService = require('../services/UserService')
const { parsePagination } = require('../utils/pagination')

class UserController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.userService = new UserService()
  }

  /**
   * 分页查询用户列表
   * @param {Object} ctx Koa 上下文
   */
  async list(ctx) {
    const query = ctx.query
    const { page, pageSize } = parsePagination(query)
    // 组装筛选条件，支持按状态 / 角色 / 关键词 / 时间范围过滤
    const filters = {
      status: query.status,
      role: query.role,
      keyword: query.keyword,
      startDate: query.startDate,
      endDate: query.endDate,
      sortOrder: query.sortOrder,
      page,
      pageSize
    }
    const result = await this.userService.getUsers(filters)
    ctx.success(result)
  }

  /**
   * 按 id 查询用户详情
   * @param {Object} ctx Koa 上下文
   */
  async detail(ctx) {
    const { id } = ctx.params
    const result = await this.userService.getUserById(id)
    ctx.success(result)
  }

  /**
   * 更新用户状态（active / muted / banned）
   * 当状态为 muted 或 banned 时，可携带 duration（天数）设置到期时间
   * 当状态为 active 时，自动清除禁言/封禁到期时间
   * @param {Object} ctx Koa 上下文
   */
  async updateStatus(ctx) {
    const { id } = ctx.params
    const { status, duration } = ctx.request.body
    await this.userService.updateUserStatus(id, status, duration)
    ctx.success(null, '用户状态更新成功')
  }

  /**
   * 解除封禁/禁言（恢复为正常状态，清除到期时间）
   * @param {Object} ctx Koa 上下文
   */
  async unban(ctx) {
    const { id } = ctx.params
    await this.userService.unbanUser(id)
    ctx.success(null, '已解除封禁/禁言')
  }

  /**
   * 更新用户角色（user / merchant / admin）
   * @param {Object} ctx Koa 上下文
   */
  async updateRole(ctx) {
    const { id } = ctx.params
    const { role } = ctx.request.body
    await this.userService.updateUserRole(id, role)
    ctx.success(null, '用户角色更新成功')
  }

  /**
   * 删除用户
   * 硬删除：从数据库中移除用户记录
   * 用户发布的帖子/评论仍保留（通过 _openid 关联），作者信息将在读取时降级为空
   * @param {Object} ctx Koa 上下文
   */
  async delete(ctx) {
    const { id } = ctx.params
    await this.userService.deleteUser(id)
    ctx.success(null, '用户删除成功')
  }
}

module.exports = UserController
