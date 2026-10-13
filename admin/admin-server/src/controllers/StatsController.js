/**
 * StatsController - 统计控制器
 * ------------------------------------------------------------
 * 提供后台首页概览数据与近期趋势统计的 HTTP 接口。
 */

const StatsService = require('../services/StatsService')

class StatsController {
  constructor() {
    // 构造函数中实例化对应的 Service
    this.statsService = new StatsService()
  }

  /**
   * 获取概览统计（总数 + 今日新增 + 待处理举报）
   * @param {Object} ctx Koa 上下文
   */
  async overview(ctx) {
    const result = await this.statsService.getOverview()
    ctx.success(result)
  }

  /**
   * 获取最近 N 天的新增帖子数与用户数趋势
   * @param {Object} ctx Koa 上下文
   */
  async trend(ctx) {
    // 从 query 取天数，缺省或非法值回退到 7
    const days = parseInt(ctx.query.days, 10)
    const safeDays = Number.isFinite(days) && days > 0 ? days : 7
    const result = await this.statsService.getTrend(safeDays)
    ctx.success(result)
  }
}

module.exports = StatsController
