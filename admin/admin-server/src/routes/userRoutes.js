/**
 * 用户路由
 * ------------------------------------------------------------
 * 前缀：/api/users
 *   GET    /               用户列表      user:read
 *   GET    /:id            用户详情      user:read
 *   PUT    /:id/status     更新状态      user:ban
 *   PUT    /:id/role       更新角色      admin:user:manage
 *   PUT    /:id/unban      解除禁言/封禁  user:ban
 *   DELETE /:id            删除用户      admin:user:manage
 *
 * 注：/:id 仅匹配单段路径，不会误匹配 /:id/status 等多段路径。
 * 使用 id（_id 映射）作为用户标识，因云数据库 HTTP API where() 不支持 _openid 查询。
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const UserController = require('../controllers/UserController')

const router = new Router({ prefix: '/api/users' })
// 实例化控制器
const controller = new UserController()

// 用户列表
router.get('/', jwtAuth(), requirePermission('user:read'), (ctx) => controller.list(ctx))

// 用户详情
router.get('/:id', jwtAuth(), requirePermission('user:read'), (ctx) => controller.detail(ctx))

// 更新用户状态（支持禁言/封禁时长）
router.put('/:id/status', jwtAuth(), requirePermission('user:ban'), (ctx) => controller.updateStatus(ctx))

// 更新用户角色
router.put('/:id/role', jwtAuth(), requirePermission('admin:user:manage'), (ctx) => controller.updateRole(ctx))

// 解除封禁/禁言
router.put('/:id/unban', jwtAuth(), requirePermission('user:ban'), (ctx) => controller.unban(ctx))

// 删除用户
router.delete('/:id', jwtAuth(), requirePermission('admin:user:manage'), (ctx) => controller.delete(ctx))

module.exports = router
