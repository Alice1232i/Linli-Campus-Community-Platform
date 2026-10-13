/**
 * 认证审核路由
 * ------------------------------------------------------------
 * 前缀：/api/verifications
 *   GET /            认证列表    verify:read
 *   PUT /:id/approve 审核通过    verify:approve
 *   PUT /:id/reject  驳回申请    verify:approve
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const VerificationController = require('../controllers/VerificationController')

const router = new Router({ prefix: '/api/verifications' })
// 实例化控制器
const controller = new VerificationController()

// 认证申请列表
router.get('/', jwtAuth(), requirePermission('verify:read'), (ctx) => controller.list(ctx))

// 审核通过
router.put('/:id/approve', jwtAuth(), requirePermission('verify:approve'), (ctx) => controller.approve(ctx))

// 驳回申请
router.put('/:id/reject', jwtAuth(), requirePermission('verify:approve'), (ctx) => controller.reject(ctx))

module.exports = router
