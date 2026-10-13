/**
 * 帖子路由
 * ------------------------------------------------------------
 * 前缀：/api/posts
 *   GET    /            帖子列表      post:read
 *   GET    /:id         帖子详情      post:read
 *   PUT    /:id/top     切换置顶      post:pin
 *   PUT    /:id/essence 切换加精      post:pin
 *   PUT    /:id/status  更新状态      post:delete
 *   DELETE /:id         删除帖子      post:delete
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { requirePermission } = require('../middleware/permission')
const PostController = require('../controllers/PostController')

const router = new Router({ prefix: '/api/posts' })
// 实例化控制器
const controller = new PostController()

// 帖子列表
router.get('/', jwtAuth(), requirePermission('post:read'), (ctx) => controller.list(ctx))

// 帖子详情
router.get('/:id', jwtAuth(), requirePermission('post:read'), (ctx) => controller.detail(ctx))

// 切换置顶
router.put('/:id/top', jwtAuth(), requirePermission('post:pin'), (ctx) => controller.toggleTop(ctx))

// 切换加精
router.put('/:id/essence', jwtAuth(), requirePermission('post:pin'), (ctx) => controller.toggleEssence(ctx))

// 更新帖子状态
router.put('/:id/status', jwtAuth(), requirePermission('post:delete'), (ctx) => controller.updateStatus(ctx))

// 删除帖子
router.delete('/:id', jwtAuth(), requirePermission('post:delete'), (ctx) => controller.remove(ctx))

module.exports = router
