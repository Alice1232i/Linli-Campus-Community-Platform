// utils/permission.js
// 权限工具
// 统一封装相册、相机、地理位置等授权流程
// 流程：查询授权状态 -> 已授权直接 resolve -> 未授权则发起 authorize -> 被拒绝则引导 openSetting

/**
 * 通用授权检查
 * @param {string} scope 权限 scope，如 'scope.album'
 * @returns {Promise<boolean>} 是否已授权
 */
function checkScope(scope) {
  return new Promise((resolve) => {
    wx.getSetting({
      success(res) {
        // 已授权
        if (res.authSetting[scope]) {
          resolve(true)
          return
        }
        // 从未询问过 / 可发起授权
        if (res.authSetting[scope] === false) {
          // 之前拒绝过，需引导用户去设置页开启
          openSetting(scope, resolve)
        } else {
          // 首次发起授权
          wx.authorize({
            scope,
            success() { resolve(true) },
            fail() { resolve(false) }
          })
        }
      },
      fail() {
        resolve(false)
      }
    })
  })
}

/**
 * 引导用户前往设置页开启权限
 */
function openSetting(scope, resolve) {
  wx.showModal({
    title: '需要授权',
    content: '该功能需要您授权后才能使用，是否前往设置开启？',
    confirmText: '去设置',
    success(res) {
      if (res.confirm) {
        wx.openSetting({
          success(s) {
            resolve(!!s.authSetting[scope])
          },
          fail() { resolve(false) }
        })
      } else {
        resolve(false)
      }
    },
    fail() { resolve(false) }
  })
}

/**
 * 检查相册权限
 */
function checkAlbum() {
  return checkScope('scope.writePhotosAlbum')
}

/**
 * 检查相机权限
 */
function checkCamera() {
  return checkScope('scope.camera')
}

/**
 * 检查地理位置权限
 */
function checkLocation() {
  return checkScope('scope.userLocation')
}

module.exports = {
  checkScope,
  checkAlbum,
  checkCamera,
  checkLocation
}
