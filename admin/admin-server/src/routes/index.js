/**
 * 路由聚合
 * ------------------------------------------------------------
 * 导入所有子路由，导出一个注册函数 registerRoutes(app)，
 * 将所有路由的 routes() / allowedMethods() 注册到 Koa app。
 *
 * 用法：
 *   const registerRoutes = require('./routes')
 *   registerRoutes(app)
 */

const authRoutes = require('./authRoutes')
const postRoutes = require('./postRoutes')
const commentRoutes = require('./commentRoutes')
const userRoutes = require('./userRoutes')
const reportRoutes = require('./reportRoutes')
const verifyRoutes = require('./verifyRoutes')
const statsRoutes = require('./statsRoutes')
const logRoutes = require('./logRoutes')
const feedbackRoutes = require('./feedbackRoutes')

// 所有子路由列表（顺序不影响匹配，因各路由前缀互不冲突）
const routes = [
  authRoutes,
  postRoutes,
  commentRoutes,
  userRoutes,
  reportRoutes,
  verifyRoutes,
  statsRoutes,
  logRoutes,
  feedbackRoutes
]

/**
 * 将所有路由注册到 Koa 应用
 * @param {Object} app Koa 应用实例
 */
function registerRoutes(app) {
  routes.forEach((router) => {
    app.use(router.routes()).use(router.allowedMethods())
  })
}

module.exports = registerRoutes
