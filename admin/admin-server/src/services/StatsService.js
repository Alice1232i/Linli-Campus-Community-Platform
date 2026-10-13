/**
 * StatsService - 统计服务
 * ------------------------------------------------------------
 * 提供后台首页概览数据与近期趋势统计。
 * 跨集合的 count 查询直接使用 dbAdapter（不经 Repository），
 * 以便在单次统计中灵活组合不同集合的查询条件。
 */

const dbAdapter = require('../adapters')

class StatsService {
  /**
   * 获取概览统计
   * 并行查询各项总数与今日新增，减少串行等待时间。
   * @returns {Promise<{totalUsers: number, totalPosts: number, totalComments: number, totalReports: number, pendingReports: number, todayNewPosts: number, todayNewUsers: number}>}
   */
  async getOverview() {
    // 计算今日 0 点时间戳（毫秒）
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayStartTs = todayStart.getTime()

    // 并行查询：总数 + 今日新增
    const [
      totalUsers,
      totalPosts,
      totalComments,
      totalReports,
      pendingReports,
      todayNewPosts,
      todayNewUsers
    ] = await Promise.all([
      dbAdapter.count('users', {}),                                     // 总用户数
      dbAdapter.count('posts', { status: { $ne: 'deleted' } }),         // 总帖子数（排除已删除）
      dbAdapter.count('comments', { status: { $ne: 'deleted' } }),      // 总评论数（排除已删除，与帖子口径一致）
      dbAdapter.count('reports', {}),                                   // 总举报数
      dbAdapter.count('reports', { status: 'pending' }),                // 待处理举报数
      dbAdapter.count('posts', { created_at: { $gte: todayStartTs } }), // 今日新帖子数
      dbAdapter.count('users', { created_at: { $gte: todayStartTs } })  // 今日新用户数
    ])

    return {
      totalUsers,
      totalPosts,
      totalComments,
      totalReports,
      pendingReports,
      todayNewPosts,
      todayNewUsers
    }
  }

  /**
   * 获取最近 days 天的新增帖子数与用户数趋势
   * 简化实现：循环 days 天，每天分别查询 count。
   * @param {number} [days=7] 统计天数
   * @returns {Promise<Array<{date: string, postCount: number, userCount: number}>>}
   */
  async getTrend(days = 7) {
    // 上限保护：防止 days 传超大值导致逐天查询拖垮数据库/云 API 配额
    days = Math.min(90, Math.max(1, Number(days) || 7))
    const trend = []

    // 以今日 0 点为基准
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    // 从最早的一天开始遍历到今天，保证结果按日期升序
    for (let i = days - 1; i >= 0; i--) {
      // 当天 0 点
      const dayStart = new Date(now)
      dayStart.setDate(now.getDate() - i)
      const dayStartTs = dayStart.getTime()

      // 次日 0 点（即当天结束边界，左闭右开）
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayStart.getDate() + 1)
      const dayEndTs = dayEnd.getTime()

      // 并行查询当天新增帖子数与用户数
      const [postCount, userCount] = await Promise.all([
        dbAdapter.count('posts', {
          created_at: { $gte: dayStartTs, $lt: dayEndTs }
        }),
        dbAdapter.count('users', {
          created_at: { $gte: dayStartTs, $lt: dayEndTs }
        })
      ])

      // 日期格式化为 YYYY-MM-DD
      trend.push({
        date: this._formatDate(dayStart),
        postCount,
        userCount
      })
    }

    return trend
  }

  /**
   * 将 Date 格式化为 YYYY-MM-DD
   * @param {Date} date 日期对象
   * @returns {string} 形如 2024-01-01
   * @private
   */
  _formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

module.exports = StatsService
