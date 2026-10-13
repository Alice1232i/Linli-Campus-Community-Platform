// utils/format.js
// 格式化工具集
// 提供时间、金额、手机号、数字等常用格式化方法

/**
 * 相对时间格式化
 * @param {number} timestamp 时间戳（毫秒）
 * @returns {string} 如「刚刚」「3 分钟前」「2 小时前」「昨天 12:30」「2024-01-01」
 */
function formatTime(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  // 1 分钟内
  if (diff < minute) return '刚刚'
  // 1 小时内
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前'
  // 24 小时内
  if (diff < day) return Math.floor(diff / hour) + ' 小时前'
  // 昨天前天
  if (diff < 2 * day) return '昨天 ' + padTime(timestamp)
  if (diff < 3 * day) return '前天 ' + padTime(timestamp)
  // 7 天内
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'
  // 超过 7 天显示完整日期
  return formatDate(timestamp)
}

/**
 * 信息流列表精简时间：超 7 天的旧帖只显示 MM-DD（当年）或 YYYY-MM-DD（跨年）
 * 相比 formatTime 去掉了年份与时分，适合信息流紧凑展示
 * @param {number} timestamp 时间戳（毫秒）
 * @returns {string}
 */
function formatListTime(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  // 7 天内与 formatTime 一致
  if (diff < 7 * day) return formatTime(timestamp)

  const d = new Date(timestamp)
  const nowYear = new Date().getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day2 = String(d.getDate()).padStart(2, '0')
  // 跨年才带年份
  if (d.getFullYear() !== nowYear) {
    return d.getFullYear() + '-' + m + '-' + day2
  }
  return m + '-' + day2
}

/**
 * 补全 HH:mm
 */
function padTime(timestamp) {
  const d = new Date(timestamp)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/**
 * 完整日期格式化
 * @param {number} timestamp 时间戳（毫秒）
 * @returns {string} YYYY-MM-DD HH:mm
 */
function formatDate(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

/**
 * 金额：分转元
 * @param {number} fen 金额（分）
 * @returns {string} 如 1999 -> '19.99'
 */
function formatMoney(fen) {
  if (fen === null || fen === undefined || fen === '') return '0.00'
  const yuan = Number(fen) / 100
  if (isNaN(yuan)) return '0.00'
  return yuan.toFixed(2)
}

/**
 * 手机号脱敏
 * @param {string} phone 11 位手机号
 * @returns {string} 如 '138****1234'
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || ''
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

/**
 * 数字格式化（万 / 亿）
 * @param {number} num 数字
 * @returns {string} 如 12345 -> '1.2万'
 */
function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '0'
  const n = Number(num)
  if (isNaN(n)) return '0'
  if (n < 10000) return String(n)
  if (n < 100000000) {
    // 万级，保留 1 位小数并去除多余 .0
    const w = (n / 10000).toFixed(1)
    return (w.endsWith('.0') ? w.slice(0, -2) : w) + '万'
  }
  // 亿级
  const y = (n / 100000000).toFixed(1)
  return (y.endsWith('.0') ? y.slice(0, -2) : y) + '亿'
}

/**
 * 头像/图片 URL 净化
 * 检测无效的临时文件路径（wxfile:// / tmp_ 前缀），替换为默认占位图
 * 防止历史脏数据（曾以临时路径入库的头像）导致图片加载 500 错误
 * @param {string} url 原始图片地址
 * @param {string} [defaultUrl] 无效时的默认图，默认为空字符串
 * @returns {string} 净化后的有效地址
 */
function sanitizeImageUrl(url, defaultUrl) {
  if (!url || typeof url !== 'string') return defaultUrl || ''
  // 微信临时文件路径前缀（wxfile:// / http://tmp/ / wttmp_ 等），重启后即失效
  if (url.indexOf('wxfile://') === 0) return defaultUrl || ''
  if (url.indexOf('http://tmp') === 0) return defaultUrl || ''
  // 有效的云存储 / 网络 / 本地资源路径直接放行
  return url
}

module.exports = {
  formatTime,
  formatListTime,
  formatDate,
  formatMoney,
  maskPhone,
  formatNumber,
  sanitizeImageUrl
}
