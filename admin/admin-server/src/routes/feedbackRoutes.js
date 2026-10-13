/**
 * 意见箱路由
 * ------------------------------------------------------------
 * 前缀：/api/feedbacks
 *   GET    /         反馈列表          feedback:read
 *   PUT    /:id/handle  标记已处理（可附回复）  feedback:handle
 *   DELETE /batch    批量删除反馈       feedback:handle
 *
 * 数据来源：小程序「意见箱」（feedback 云函数写入 feedbacks 集合）
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const FeedbackController = require('../controllers/FeedbackController')

const router = new Router({ prefix: '/api/feedbacks' })
// 实例化控制器
const controller = new FeedbackController()

// 反馈列表
router.get('/', jwtAuth(), requirePermission('feedback:read'), (ctx) => controller.list(ctx))

// 标记已处理
router.put('/:id/handle', jwtAuth(), requirePermission('feedback:handle'), (ctx) => controller.markHandled(ctx))

// 批量删除
router.delete('/batch', jwtAuth(), requirePermission('feedback:handle'), (ctx) => controller.batchDelete(ctx))

module.exports = router
