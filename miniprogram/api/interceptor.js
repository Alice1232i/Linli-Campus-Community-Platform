// api/interceptor.js
// 请求拦截器
// 统一处理：loading 展示、鉴权 token 注入、错误提示、限流去重、登录态失效自动恢复
// 所有适配器的 request / upload 都会经由 intercept 包装后再对外暴露

const { TIMEOUT } = require('./config')

// 进行中的请求集合，用于「限流去重」
// key 相同且仍在进行中的请求会复用同一个 Promise，避免重复发起
const pending = {}

// ---- 登录态失效自动恢复（P1）----
// 服务端在会话被撤销 / 过期 / 不匹配时返回 2001(UNAUTHORIZED) 或 2003(TOKEN_EXPIRED)，
// 此前前端收到后只会反复提示「请求失败」，用户必须杀掉小程序重启才能恢复。
// 这里识别这两个错误码 → 清除失效会话 → 静默重登 → 重放一次原请求。
const AUTH_ERROR_CODES = [2001, 2003]
// 重入锁：防止恢复过程本身触发的请求再次进入恢复逻辑，形成死循环
let recovering = false

/**
 * 尝试从「登录态失效」中恢复：静默重登成功后重放原请求一次
 * 恢复失败时抛回原始错误，保证用户看到的仍是有意义的提示
 * @param {Function} exec 请求执行函数，签名 (token) => Promise
 * @param {*} err 原始错误
 * @returns {Promise}
 */
function recoverAuth(exec, err) {
  const code = err && err.code
  if (AUTH_ERROR_CODES.indexOf(code) === -1 || recovering) {
    return Promise.reject(err)
  }
  // 惰性 require：interceptor ↔ utils/auth ↔ api/index 之间存在循环依赖，
  // 在函数内部按需加载可规避模块初始化顺序问题
  let auth
  try {
    auth = require('../utils/auth')
  } catch (e) {
    return Promise.reject(err)
  }
  // 用户主动退出登录后不应被自动登回
  if (auth.isLoggedOut && auth.isLoggedOut()) {
    return Promise.reject(err)
  }

  recovering = true
  console.warn('[interceptor] 登录态失效（code=' + code + '），尝试静默重登')
  // 清除失效会话，避免用旧 token 重放；随后重新登录（auth.login 会写入新 token）
  auth.clearSession()

  return auth.login()
    .then(function () {
      return exec(wx.getStorageSync('token') || '')
    })
    .then(
      function (res) {
        recovering = false
        return res
      },
      function (e) {
        recovering = false
        console.warn('[interceptor] 静默重登或重放失败:', (e && e.message) || '')
        // 保留原始错误，便于页面展示「登录状态已失效，请重新登录」而非泛化提示
        return Promise.reject(err)
      }
    )
}

/**
 * 请求拦截器
 * @param {Function} fn 原始请求执行函数，签名：(token) => Promise
 *   拦截器会从本地缓存读取 token 并作为参数传入，由调用方决定是否使用
 * @param {Object} [opts] 拦截选项
 * @param {boolean|string} [opts.loading=true] 是否显示 loading，传字符串则作为 loading 文案
 * @param {boolean} [opts.silent=false] 是否静默模式，静默时请求失败不弹 toast
 * @param {boolean} [opts.dedup=true] 是否开启限流去重（相同 key 的并发请求只发一次）
 * @param {string} [opts.key] 限流去重键，一般由「模块名 + action + 关键参数」生成
 * @returns {Promise} 归一化后的请求结果
 */
function intercept(fn, opts = {}) {
  const {
    loading = true,
    silent = false,
    dedup = true,
    key
  } = opts

  // 限流去重：相同 key 的请求进行中，则直接复用同一个 Promise
  // 注意：去重时不再 showLoading，避免与原请求的 hideLoading 不配对
  if (dedup && key && pending[key]) {
    return pending[key]
  }

  // 显示 loading（仅在非去重请求时调用，确保与 hideLoading 严格配对）
  if (loading) {
    wx.showLoading({
      title: typeof loading === 'string' ? loading : '加载中',
      mask: true
    })
  }

  // 鉴权 token 注入：请求前从本地缓存读取 token
  const token = wx.getStorageSync('token') || ''

  // 单次请求执行：token 由参数传入，便于鉴权失效后携带新 token 重放
  const exec = (tk) => {
    return Promise.resolve()
      .then(() => fn(tk))
      .then(res => {
        // 业务错误码统一处理
        // 约定 code 为 0 或 200 表示成功，其它视为业务错误
        // 注意：此处不弹 toast，统一由下方失败分支处理，避免重复提示
        if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
          return Promise.reject(res)
        }
        return res
      })
  }

  // 构建请求 Promise：失败时先尝试登录态恢复，再决定是否提示
  const task = exec(token)
    .catch(err => recoverAuth(exec, err))
    .then(
      // 成功分支：关闭 loading
      res => {
        if (loading) wx.hideLoading()
        return res
      },
      // 失败分支：先关闭 loading 再弹 toast，避免 showLoading / hideLoading 不配对
      err => {
        if (loading) wx.hideLoading()
        if (!silent) {
          const msg = (err && err.message) || '请求失败，请稍后重试'
          wx.showToast({ title: msg, icon: 'none' })
        }
        return Promise.reject(err)
      }
    )

  // 登记进行中的请求，完成后清理
  if (dedup && key) {
    pending[key] = task
    task.then(
      () => cleanup(key, task),
      () => cleanup(key, task)
    )
  }

  return task
}

/**
 * 清理进行中的请求记录
 */
function cleanup(key, task) {
  if (pending[key] === task) {
    delete pending[key]
  }
}

module.exports = {
  intercept
}
