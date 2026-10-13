// api/modules/report.js
// 举报模块 API
// 云函数名：report，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 提交举报
   * @param {string} targetType 举报目标类型，如 'post' / 'comment' / 'user'
   * @param {string} targetId 目标 ID
   * @param {string} reason 举报理由分类
   * @param {string} [detail] 详细描述
   * @param {string[]} [evidence] 证据图片地址列表
   */
  submit(targetType, targetId, reason, detail, evidence) {
    return request({
      name: 'report',
      data: { action: 'submit', targetType, targetId, reason, detail, evidence }
    }, { dedup: false })
  }
}
