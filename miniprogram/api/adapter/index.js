// api/adapter/index.js
// 适配器选择器
// 根据 config.USE_CLOUD 选择 cloudAdapter 或 httpAdapter
// 对外暴露统一的 { request, upload }，其中 request 经 interceptor 包装

const { USE_CLOUD } = require('../config')
const { intercept } = require('../interceptor')
const cloudAdapter = require('./cloudAdapter')
const httpAdapter = require('./httpAdapter')

// 当前启用的适配器
const adapter = USE_CLOUD ? cloudAdapter : httpAdapter

// 读取类 action 白名单：仅这些动作开启「限流去重」
// 写入 / 切换类动作（create/update/delete/toggle 等）不去重，避免误吞用户连续操作
const READ_ACTIONS = [
  'feed', 'detail', 'list', 'get', 'getProfile', 'myPosts', 'userPosts',
  'search', 'searchByTag', 'searchUser',
  'check', 'batchCheck', 'getStatus', 'getConfig',
  'shopList', 'shopDetail', 'menuList', 'menuDetail',
  'listConversations', 'listMessages'
]

/**
 * 判断某个 action 是否为读取类（可安全去重）
 */
function isReadAction(action) {
  return READ_ACTIONS.indexOf(action) !== -1
}

/**
 * 生成限流去重键
 * 由「模块名 + action + 关键参数」组成，相同键的并发请求只发一次
 */
function buildKey(params) {
  const { name, data } = params
  const action = (data && data.action) || ''
  // 只对读取类 action 生成去重键
  if (!isReadAction(action)) return ''
  // 参数签名（截断，防止过大）
  const signature = JSON.stringify(data || {}).slice(0, 200)
  return `${name}:${action}:${signature}`
}

/**
 * 统一请求入口（经拦截器包装）
 * @param {Object} params 请求参数 { name, data, method? }
 * @param {Object} [opts] 拦截选项，透传给 intercept（silent/loading/dedup 等）
 * @returns {Promise<{ code: number, data: any, message: string }>}
 */
function request(params, opts) {
  const key = buildKey(params)
  return intercept((token) => {
    // 注入 token 给适配器
    params.token = token
    return adapter.request(params)
  }, Object.assign({ key }, opts))
}

/**
 * 统一上传入口（经拦截器包装）
 * @param {Object} params 上传参数 { filePath, cloudPath? }
 * @param {Object} [opts] 拦截选项
 * @returns {Promise<{ code: number, data: { url: string }, message: string }>}
 */
function upload(params, opts) {
  return intercept((token) => {
    params.token = token
    return adapter.upload(params)
  }, Object.assign({ loading: '上传中', dedup: false }, opts))
}

module.exports = {
  request,
  upload,
  // 暴露当前适配器，便于特殊场景直接调用
  adapter
}
