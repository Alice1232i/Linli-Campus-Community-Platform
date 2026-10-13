// utils/auth.js
// 登录态与会话管理
// 提供静默登录、会话标识读写、登录态判断、退出登录等能力
//
// 安全模型说明（重要）：
//   1. 真正的身份鉴权由云函数侧的 cloud.getWXContext().OPENID 完成 —— 该值由微信在
//      调用链路上注入，客户端既拿不到也伪造不了。
//   2. 因此前端**不再持有 openid**。本地保存的三样东西都来自服务端签发、不含身份信息：
//        token     —— 随机会话标识，退出登录时服务端会将其撤销
//        uploadKey —— 随机上传归属键，用于生成云存储路径 upload/{uploadKey}/...
//        userInfo  —— 脱敏后的用户公开资料
//   3. loggedOut 为持久标记：用户主动退出后一直保持退出态，直到再次点击登录，
//      避免被下一次静默登录立刻顶回登录状态（此前用 30 秒时间窗打补丁）。

const storage = require('./storage')
const { user } = require('../api/index.js')

const TOKEN_KEY = 'token'          // 会话标识（服务端签发的随机串）
const UPLOAD_KEY = 'uploadKey'     // 上传归属键
const USER_KEY = 'userInfo'        // 用户公开资料
const LOGGED_OUT_KEY = 'loggedOut' // 是否已主动退出登录（持久标记）

// 在途登录任务（并发去重）：同一时刻只允许一个 login 在途
let _loginTask = null

/**
 * 静默登录
 * 调用 user 云函数 login action，获取并保存会话标识、上传归属键与用户信息
 *
 * ⚠️ 并发去重（重要）：
 * onLaunch 的 silentLogin 与 onShow 的 checkLoginStatus 可能同时触发登录。
 * 此前两次登录各自签发不同 token，后到的响应会把「较旧的 token」写回本地，
 * 造成本地 token 与服务端不一致 → 任意页面随时提示「登录状态已失效，请重新登录」。
 * 现保证同一时刻只有一个 login 在途，后续调用复用同一个 Promise。
 *
 * @param {Object} [opts] 选项
 * @param {boolean} [opts.silent=true] 是否静默（不弹 loading）
 * @returns {Promise<Object>} 登录返回数据 { token, uploadKey, userInfo }
 */
function login(opts) {
  const { silent = true } = opts || {}
  // 在途登录复用：避免并发登录互相覆盖本地会话凭证
  if (_loginTask) return _loginTask

  const task = user.login({ silent })
    .then(res => {
      const data = (res && res.data) || {}
      if (data.token) setToken(data.token)
      if (data.uploadKey) storage.set(UPLOAD_KEY, data.uploadKey)
      if (data.userInfo) storage.set(USER_KEY, data.userInfo)
      // 登录成功即视为重新建立会话，清除「已主动退出」标记
      clearLoggedOut()
      return data
    })

  _loginTask = task
  // 无论成功或失败都释放锁，允许后续重新登录
  task.then(
    () => { _loginTask = null },
    () => { _loginTask = null }
  )
  return task
}

/**
 * 获取会话标识
 * @returns {string}
 */
function getToken() {
  return storage.get(TOKEN_KEY, '')
}

/**
 * 设置会话标识
 * @param {string} token
 */
function setToken(token) {
  storage.set(TOKEN_KEY, token)
}

/**
 * 获取上传归属键（用于生成云存储路径）
 * @returns {string}
 */
function getUploadKey() {
  return storage.get(UPLOAD_KEY, '')
}

/**
 * 是否已登录
 * @returns {boolean}
 */
function isLoggedIn() {
  return !!getToken()
}

/**
 * 是否处于「主动退出登录」状态
 * @returns {boolean}
 */
function isLoggedOut() {
  return !!storage.get(LOGGED_OUT_KEY, 0)
}

/**
 * 清除「主动退出登录」标记
 */
function clearLoggedOut() {
  storage.remove(LOGGED_OUT_KEY)
}

/**
 * 检查登录态，未登录则自动静默登录
 * 已主动退出登录时不再自动重登，需用户显式点击登录
 * @returns {Promise<boolean>} 是否处于登录态
 */
function checkLogin() {
  if (isLoggedIn()) return Promise.resolve(true)
  if (isLoggedOut()) return Promise.resolve(false)
  return login().then(() => true).catch(() => false)
}

/**
 * 仅清除本地会话与用户缓存，**不**标记为「主动退出」
 * 用于「清除缓存」等场景：清完缓存后仍可被静默登录恢复登录态
 */
function clearSession() {
  storage.remove(TOKEN_KEY)
  storage.remove(UPLOAD_KEY)
  storage.remove(USER_KEY)
}

/**
 * 退出登录
 * 1. 通知服务端撤销当前会话（失败不阻断本地退出）
 * 2. 清除本地会话标识、上传归属键与用户信息
 * 3. 置「已主动退出」标记，避免被静默登录自动登回
 * @returns {Promise<void>}
 */
function logout() {
  // 先进入退出态再清缓存，确保即便接口失败也已是未登录状态
  clearSession()
  storage.set(LOGGED_OUT_KEY, 1)
  return user.logout().catch(err => {
    console.warn('[auth.logout] 服务端撤销会话失败，仅本地退出:', err && err.message)
  })
}

module.exports = {
  login,
  logout,
  clearSession,
  getToken,
  setToken,
  getUploadKey,
  isLoggedIn,
  isLoggedOut,
  clearLoggedOut,
  checkLogin
}
