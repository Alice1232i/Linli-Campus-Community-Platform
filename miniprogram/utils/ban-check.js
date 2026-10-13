// utils/ban-check.js
// 封禁用户统一拦截工具
// 提供导航前预检和页面加载时检查，确保封禁用户无法浏览社区内容
// 用于：主页宫格导航、发现页导航、板块热度、板块专区页、失物招领页等入口

const userStore = require('../store/user')

/**
 * 导航前封禁检查
 * 在 navigateTo 前调用，封禁用户弹出提示并返回 false 阻止导航
 * @returns {boolean} true=允许导航，false=已拦截
 */
function checkBanBeforeNavigate() {
  if (userStore.isBanned()) {
    wx.showToast({ title: '账号已被封禁，无法浏览内容', icon: 'none' })
    return false
  }
  return true
}

module.exports = {
  checkBanBeforeNavigate
}
