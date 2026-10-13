/**
 * 举报路由
 * ------------------------------------------------------------
 * 前缀：/api/reports
 *   GET  /           举报列表      report:read
 *   GET  /:id        举报详情      report:read
 *   PUT  /:id/handle 处理举报      report:handle
 *   DELETE /batch    批量删除举报  report:handle
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const ReportController = require('../controllers/ReportController')

const router = new Router({ prefix: '/api/reports' })
// 实例化控制器
const controller = new ReportController()

// 举报列表
router.get('/', jwtAuth(), requirePermission('report:read'), (ctx) => controller.list(ctx))

// 举报详情
router.get('/:id', jwtAuth(), requirePermission('report:read'), (ctx) => controller.detail(ctx))

// 处理举报
router.put('/:id/handle', jwtAuth(), requirePermission('report:handle'), (ctx) => controller.handle(ctx))

// 批量删除举报
router.delete('/batch', jwtAuth(), requirePermission('report:handle'), (ctx) => controller.batchDelete(ctx))

module.exports = router
