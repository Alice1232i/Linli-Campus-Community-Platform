/**
 * 登录暴力破解防护（内存滑动窗口限流）
 * ------------------------------------------------------------
 * 按「IP + 用户名」维度统计登录失败次数：
 *   - 15 分钟窗口内失败达到 MAX_FAILURES（5 次）→ 临时锁定 15 分钟
 *   - 锁定期内任何登录尝试直接拒绝，返回 3003（操作过于频繁）
 *   - 登录成功即清除该维度的计数
 *
 * 说明：
 *   - 使用进程内存存储，单实例部署有效；多实例部署时应替换为 Redis 等共享存储。
 *   - 定期清理过期条目，防止内存膨胀。
 */

/** 滑动窗口长度（毫秒）：15 分钟 */
const WINDOW_MS = 15 * 60 * 1000

/** 窗口内最大失败次数 */
const MAX_FAILURES = 5

/** 锁定时长（毫秒）：15 分钟 */
const LOCK_MS = 15 * 60 * 1000

/** 清理过期条目的周期（毫秒）：每 10 分钟 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

/**
 * 存储结构：
 *   key: `${ip}|${username}`
 *   value: { failures: number[], lockUntil: number }
 */
const store = new Map()

/**
 * 生成维度 key
 * @param {string} ip 客户端 IP
 * @param {string} username 用户名
 * @returns {string}
 */
function keyOf(ip, username) {
  return `${ip}|${username}`
}

/**
 * 清理过期条目（锁定已过期且窗口内无失败记录的条目）
 */
function cleanup() {
  const now = Date.now()
  for (const [k, v] of store) {
    const recentFailures = (v.failures || []).filter((t) => now - t < WINDOW_MS)
    if (v.lockUntil <= now && recentFailures.length === 0) {
      store.delete(k)
    } else {
      v.failures = recentFailures
    }
  }
}

// 定时清理
setInterval(cleanup, CLEANUP_INTERVAL_MS).unref()

/**
 * 是否处于锁定状态
 * @param {string} ip 客户端 IP
 * @param {string} username 用户名
 * @returns {boolean}
 */
function isLocked(ip, username) {
  const entry = store.get(keyOf(ip, username))
  return !!(entry && entry.lockUntil > Date.now())
}

/**
 * 获取剩余锁定毫秒数（未锁定返回 0）
 * @param {string} ip 客户端 IP
 * @param {string} username 用户名
 * @returns {number}
 */
function getRemainingLockMs(ip, username) {
  const entry = store.get(keyOf(ip, username))
  if (!entry || entry.lockUntil <= Date.now()) return 0
  return entry.lockUntil - Date.now()
}

/**
 * 记录一次登录失败，达到阈值时触发锁定
 * @param {string} ip 客户端 IP
 * @param {string} username 用户名
 */
function recordFailure(ip, username) {
  const now = Date.now()
  const k = keyOf(ip, username)
  const entry = store.get(k) || { failures: [], lockUntil: 0 }

  // 锁定已过期则重新开始计数
  if (entry.lockUntil <= now) {
    entry.lockUntil = 0
  }

  // 仅保留窗口内的失败记录
  entry.failures = (entry.failures || []).filter((t) => now - t < WINDOW_MS)
  entry.failures.push(now)

  // 达到阈值 → 锁定并清空计数（下次窗口重新累计）
  if (entry.failures.length >= MAX_FAILURES) {
    entry.lockUntil = now + LOCK_MS
    entry.failures = []
    console.warn(`[loginRateLimit] 登录失败次数过多，已临时锁定: ip=${ip}, username=${username}, 锁定至 ${new Date(entry.lockUntil).toISOString()}`)
  }

  store.set(k, entry)
}

/**
 * 登录成功时清除计数
 * @param {string} ip 客户端 IP
 * @param {string} username 用户名
 */
function clear(ip, username) {
  store.delete(keyOf(ip, username))
}

module.exports = {
  isLocked,
  getRemainingLockMs,
  recordFailure,
  clear,
  // 导出常量便于测试
  WINDOW_MS,
  MAX_FAILURES,
  LOCK_MS
}
