/**
 * 临里校园 - 错误码定义（前端与云函数共用）
 * ------------------------------------------------------------
 * 统一的业务错误码体系，分为以下几段：
 *   0       : 成功
 *   1xxx    : 参数校验错误
 *   2xxx    : 鉴权错误
 *   3xxx    : 业务错误
 *   4xxx    : 内容安全错误
 *   5xxx    : 权限错误
 *   9xxx    : 系统错误
 *
 * 使用方式（CommonJS）：
 *   const { ERRORS, getError } = require('./shared/errors')
 */

/** 成功码 */
const SUCCESS = 0

/** 错误码常量集合 */
const ERRORS = {
  // -------- 参数校验错误 1xxx --------
  PARAM_MISSING: 1001, // 参数缺失
  PARAM_INVALID: 1002, // 参数不合法

  // -------- 鉴权错误 2xxx --------
  UNAUTHORIZED: 2001, // 未登录或登录态失效
  FORBIDDEN: 2002, // 无权限访问
  TOKEN_EXPIRED: 2003, // 登录态已过期

  // -------- 业务错误 3xxx --------
  NOT_FOUND: 3001, // 资源不存在
  ALREADY_EXISTS: 3002, // 资源已存在
  LIMIT_EXCEEDED: 3003, // 操作频率或数量超限
  OPERATION_FAILED: 3004, // 通用操作失败

  // -------- 内容安全错误 4xxx --------
  CONTENT_RISK: 4001, // 内容包含违规信息
  CONTENT_REVIEWING: 4002, // 内容审核中

  // -------- 权限错误 5xxx --------
  ROLE_DENIED: 5001, // 当前角色无权限
  NOT_VERIFIED: 5002, // 未完成学生认证
  BLOCKED: 5003, // 账号已被封禁

  // -------- 系统错误 9xxx --------
  INTERNAL_ERROR: 9001, // 服务器内部错误
  DB_ERROR: 9002, // 数据库操作失败
  NETWORK_ERROR: 9003 // 网络异常
}

/**
 * 错误码 -> 中文描述 映射表
 * 作为 getError 的数据来源，新增错误码时务必同步补充
 */
const ERROR_MESSAGES = {
  // 参数校验错误
  1001: '参数缺失',
  1002: '参数不合法',
  // 鉴权错误
  2001: '未登录或登录态已失效',
  2002: '无权限访问该资源',
  2003: '登录态已过期，请重新登录',
  // 业务错误
  3001: '资源不存在',
  3002: '资源已存在',
  3003: '操作过于频繁，已达上限',
  3004: '操作失败',
  // 内容安全错误
  4001: '内容包含违规信息',
  4002: '内容正在审核中',
  // 权限错误
  5001: '当前角色无权执行此操作',
  5002: '尚未完成学生认证',
  5003: '账号已被封禁',
  // 系统错误
  9001: '服务器内部错误',
  9002: '数据库操作失败',
  9003: '网络异常，请稍后重试'
}

/**
 * 根据错误码获取 { code, message } 结构
 * @param {number} code 错误码
 * @returns {{ code: number, message: string }}
 */
function getError(code) {
  return {
    code,
    message: ERROR_MESSAGES[code] || '未知错误'
  }
}

module.exports = {
  SUCCESS,
  ERRORS,
  ERROR_MESSAGES,
  getError
}
