// api/modules/verify.js
// 学生认证模块 API
// 云函数名：verify，通过 data.action 字段做子路由

const { request } = require('../adapter/index.js')

module.exports = {
  /**
   * 发送验证码到校园邮箱
   * @param {string} email 校园邮箱
   */
  sendCode(email) {
    return request({ name: 'verify', data: { action: 'sendCode', email } }, { dedup: false })
  },

  /**
   * 提交认证
   * @param {string} email 校园邮箱
   * @param {string} code 验证码
   * @param {string[]} [evidence] 辅助证明材料（如学生证图片）
   */
  submit(email, code, evidence) {
    return request({
      name: 'verify',
      data: { action: 'submit', email, code, evidence }
    }, { dedup: false })
  },

  /**
   * 获取认证状态
   */
  getStatus() {
    return request({ name: 'verify', data: { action: 'getStatus' } })
  }
}
