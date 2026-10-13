/**
 * 格式化工具函数
 */
import dayjs from 'dayjs'

/**
 * 毫秒时间戳格式化为 'YYYY-MM-DD HH:mm:ss'
 * @param {number|string|Date} ts - 时间戳（毫秒）/ 字符串 / Date 对象
 * @returns {string}
 */
export function formatTimestamp(ts) {
  if (!ts) return ''
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 毫秒时间戳格式化为日期 'YYYY-MM-DD'
 * @param {number|string|Date} ts - 时间戳（毫秒）/ 字符串 / Date 对象
 * @returns {string}
 */
export function formatDate(ts) {
  if (!ts) return ''
  return dayjs(ts).format('YYYY-MM-DD')
}

/**
 * 截断字符串到指定长度，超出部分用 '...' 补全
 * @param {string} str - 原始字符串
 * @param {number} len - 最大长度
 * @returns {string}
 */
export function truncate(str, len = 20) {
  if (!str) return ''
  if (str.length <= len) return str
  return str.slice(0, len) + '...'
}

// 角色值到中文的映射表
const ROLE_MAP = {
  super_admin: '超级管理员',
  admin: '管理员',
  operator: '操作员',
  user: '普通用户',
  merchant: '商家'
}

/**
 * 角色值转中文
 * @param {string} role - 角色值
 * @returns {string}
 */
export function formatRole(role) {
  return ROLE_MAP[role] || role || ''
}

/**
 * 格式化禁言/封禁到期时间
 * @param {number} expire - 到期时间戳（毫秒，0=永久）
 * @param {string} status - 用户状态（muted/banned）
 * @returns {string} 格式化后的描述，如 "2026-07-28 18:00 到期" 或 "永久封禁"
 */
export function formatBanExpire(expire, status) {
  if (!expire || expire === 0) {
    if (status === 'banned') return '永久封禁'
    if (status === 'muted') return '永久禁言'
    return '-'
  }
  // 已过期
  if (expire <= Date.now()) {
    return '已过期'
  }
  return dayjs(expire).format('YYYY-MM-DD HH:mm') + ' 到期'
}

/**
 * 计算剩余禁言/封禁时间
 * @param {number} expire - 到期时间戳（毫秒，0=永久）
 * @returns {string} 如 "剩余 2天3小时" 或 "永久" 或 "已过期"
 */
export function formatRemainingTime(expire) {
  if (!expire || expire === 0) return '永久'
  const now = Date.now()
  if (expire <= now) return '已过期'
  const diff = expire - now
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `剩余 ${days}天${hours}小时`
  if (hours > 0) return `剩余 ${hours}小时${minutes}分钟`
  return `剩余 ${minutes}分钟`
}
