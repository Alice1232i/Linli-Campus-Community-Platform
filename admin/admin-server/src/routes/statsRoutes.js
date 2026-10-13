/**
 * 统计路由
 * ------------------------------------------------------------
 * 前缀：/api/stats
 *   GET /overview 概览统计 stats:read
 *   GET /trend    趋势统计 stats:read
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const StatsController = require('../controllers/StatsController')

const router = new Router({ prefix: '/api/stats' })
// 实例化控制器
const controller = new StatsController()

// 概览统计
router.get('/overview', jwtAuth(), requirePermission('stats:read'), (ctx) => controller.overview(ctx))

// 趋势统计
router.get('/trend', jwtAuth(), requirePermission('stats:read'), (ctx) => controller.trend(ctx))

module.exports = router
