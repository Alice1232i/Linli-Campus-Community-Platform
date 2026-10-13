// api/modules/feedback.js
// 意见箱模块 API
// 云函数名：feedback，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 提交反馈（意见箱）
   * @param {Object} data 反馈内容
   * @param {string} [data.type] 反馈类型：suggestion 建议 / bug 问题 / other 其他
   * @param {string} data.content 反馈内容（5-500 字）
   * @param {string} [data.contact] 联系方式（选填，手机号 / 微信号）
   * @param {string} [data.appVersion] 小程序版本号（便于定位测试版本）
   */
  submit(data) {
    return request({
      name: 'feedback',
      data: { action: 'submit', type: data.type, content: data.content, contact: data.contact, appVersion: data.appVersion }
    }, { dedup: false })
  },

  /**
   * 我的反馈列表（含处理状态）
   * @param {number} [page] 页码，默认 1
   */
  listMine(page) {
    return request({
      name: 'feedback',
      data: { action: 'listMine', page: page || 1 }
    })
  }
}
