/**
 * 管理员后台 Koa2 应用入口
 * ------------------------------------------------------------
 * 创建 Koa 应用并按以下顺序注册中间件：
 *   1. koa-logger       开发环境请求日志
 *   2. @koa/cors         跨域处理（origin 从 config.cors.origin 读取）
 *   3. koa-bodyparser    请求体解析（支持 json）
 *   4. response          统一响应方法（挂载 ctx.success / ctx.fail）
 *   5. errorHandler      全局错误捕获（需在路由前注册）
 *   6. 路由              所有业务路由
 *   7. 启动监听          config.port
 *
 * 注：
 *   - response.js 直接导出中间件函数（非工厂），使用时不调用，即 app.use(response)
 *   - errorHandler.js 同样直接导出中间件函数，使用时不调用
 *   - 启动前会执行 config 模块顶部的必填环境变量校验，缺失即抛错终止
 */

const Koa = require('koa')
const logger = require('koa-logger')
const cors = require('@koa/cors')
const bodyParser = require('koa-bodyparser')

const config = require('./config')
// response / errorHandler 均为直接导出的中间件函数（非工厂），无需调用
const responseMiddleware = require('./middleware/response')
const errorHandler = require('./middleware/errorHandler')
// operationLogger 为工厂函数，需调用后使用
const operationLogger = require('./middleware/operationLogger')
const registerRoutes = require('./routes')

const app = new Koa()

// V08 修复：配置可信代理，使 ctx.ip 正确解析 X-Forwarded-For 中的真实客户端 IP
// 管理后台通常部署在 Nginx/反向代理之后，不开启此项会导致所有日志 IP 记录为 127.0.0.1
app.proxy = true

// 1. 开发环境请求日志
app.use(logger())

// 2. 跨域处理，origin 从配置读取（支持逗号分隔的多个来源）
app.use(cors({ origin: config.cors.origin }))

// 3. 全局错误捕获，捕获下游所有抛出的错误并统一返回
//    必须注册在 bodyParser 之前，畸形 JSON 等解析错误才能被统一处理（而非 Koa 默认错误页）
app.use(errorHandler)

// 4. 请求体解析，支持 application/json
app.use(bodyParser())

// 5. 统一响应方法，为每个 ctx 挂载 success / fail
app.use(responseMiddleware)

// 6. 操作日志记录（仅在 POST/PUT/DELETE 成功响应后记录）
//    放在路由前，利用 await next() 等路由执行完毕后再记录
app.use(operationLogger())

// 7. 路由注册
registerRoutes(app)

// 7. 启动 HTTP 服务
app.listen(config.port, () => {
  console.log(`管理后台服务已启动: http://localhost:${config.port}`)
})

// 导出 app 便于测试场景使用
module.exports = app
