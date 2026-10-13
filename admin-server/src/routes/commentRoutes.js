/**
 * 评论路由
 * ------------------------------------------------------------
 * 前缀：/api/comments
 *   GET    /    评论列表  comment:read
 *   DELETE /:id 删除评论  comment:delete
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const CommentController = require('../controllers/CommentController')

const router = new Router({ prefix: '/api/comments' })
// 实例化控制器
const controller = new CommentController()

// 评论列表
router.get('/', jwtAuth(), requirePermission('comment:read'), (ctx) => controller.list(ctx))

// 删除评论
router.delete('/:id', jwtAuth(), requirePermission('comment:delete'), (ctx) => controller.remove(ctx))

module.exports = router
