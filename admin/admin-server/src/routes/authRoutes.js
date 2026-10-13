/**
 * 认证路由
 * ------------------------------------------------------------
 * 前缀：/api/auth
 *   POST /login   登录（无需认证）
 *   GET  /profile 获取个人信息（需认证）
 */

const Router = require('koa-router')
const jwtAuth = require('../middleware/jwtAuth')
const { validate } = require('../middleware/validator')
const AuthController = require('../controllers/AuthController')

const router = new Router({ prefix: '/api/auth' })
// 实例化控制器
const controller = new AuthController()

// 登录（无需认证，需参数校验）
router.post(
  '/login',
  validate({
    username: { required: true, type: 'string', min: 2, max: 50 },
    password: { required: true, type: 'string', min: 6, max: 100 }
  }, 'body'),
  (ctx) => controller.login(ctx)
)

// 获取个人信息（需认证，无额外权限要求）
router.get('/profile', jwtAuth(), (ctx) => controller.profile(ctx))

// 修改密码（需认证，无额外权限要求）
router.post(
  '/change-password',
  jwtAuth(),
  validate({
    oldPassword: { required: true, type: 'string', min: 6, max: 100 },
    newPassword: { required: true, type: 'string', min: 8, max: 100 },
    confirmPassword: { required: true, type: 'string', min: 8, max: 100 }
  }, 'body'),
  (ctx) => controller.changePassword(ctx)
)

module.exports = router
