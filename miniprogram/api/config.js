/**
 * api/config.js
 * 后端适配器全局配置
 * - CLOUD_ENV：微信云开发环境 ID（在开发者工具「云开发」面板获取）
 * - USE_CLOUD：是否使用云开发适配器（false 则切到 HTTP 适配器，预留独立服务器）
 * - HTTP_BASE：HTTP 适配器基础地址（预留）
 * - TIMEOUT：请求超时时间（毫秒）
 *
 * 切换后端只需修改本文件，页面无需改动。
 */

// 微信云开发环境 ID
// 已绑定真实环境，上线前如需切换生产环境可在此修改
const CLOUD_ENV = 'cloudbase-d3gavr3qt88b7c734'

// 是否使用云开发（true=云开发适配器，false=HTTP 适配器）
const USE_CLOUD = true

// HTTP 适配器基础地址（预留独立服务器）
const HTTP_BASE = 'https://api.example.com'

// 请求超时时间（毫秒）
// 设为 35 秒：post 云函数含图片同步审核（先审后发），云函数自身超时 30 秒，
// 前端需略大于云函数超时，避免前端先超时误判失败（曾导致 9 图帖子图片被误删）
// 简单云函数（like 等）自身 10 秒超时会先返回，前端 35 秒仅作兜底
const TIMEOUT = 35000

// 单次最大上传图片数量
const UPLOAD_MAX_COUNT = 9

// 单张图片最大体积（字节），默认 10MB
const UPLOAD_MAX_SIZE = 10 * 1024 * 1024

module.exports = {
  CLOUD_ENV,
  USE_CLOUD,
  HTTP_BASE,
  TIMEOUT,
  UPLOAD_MAX_COUNT,
  UPLOAD_MAX_SIZE
}
