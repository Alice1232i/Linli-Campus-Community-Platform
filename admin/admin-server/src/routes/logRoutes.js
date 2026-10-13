/**
 * 操作日志路由
 * ------------------------------------------------------------
 * 前缀：/api/logs
 *   GET / 日志列表 log:read
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const LogController = require('../controllers/LogController')

const router = new Router({ prefix: '/api/logs' })
// 实例化控制器
const controller = new LogController()

// 操作日志列表
router.get('/', jwtAuth(), requirePermission('log:read'), (ctx) => controller.list(ctx))

module.exports = router
