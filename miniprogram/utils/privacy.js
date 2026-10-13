// utils/privacy.js
// 用户隐私协议授权统一封装
// 背景：app.json 开启 __usePrivacyCheck__ 后，微信要求用户先同意《隐私政策》
// 才允许调用相册/相机等隐私接口。未授权时 wx.chooseMedia 会直接失败（errno 104），
// 若调用方又静默吞掉 fail，用户看到的就是「点了没反应」。
// 因此所有涉及隐私接口的入口，都必须先 await ensurePrivacy()。

/**
 * 确保已获得用户隐私授权
 * - 基础库不支持该接口或未配置隐私政策时直接放行（降级不阻断）
 * - 已授权时直接返回 true，不会重复弹窗
 * @returns {Promise<boolean>} 是否已获得授权
 */
function ensurePrivacy() {
  return new Promise((resolve) => {
    if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
      resolve(true)
      return
    }
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) {
          resolve(true)
          return
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(true)
    })
  })
}

/**
 * 判断 chooseMedia 的失败是否为「用户主动取消」
 * 用户取消属正常操作，应静默；其余失败需提示用户，避免无反馈
 * @param {Object} err 失败回调参数
 * @returns {boolean}
 */
function isUserCancel(err) {
  const msg = (err && err.errMsg) || ''
  return msg.indexOf('cancel') !== -1
}

// chooseMedia 常见失败码 → 可执行的排查方向
const CHOOSE_FAIL_HINT = {
  104: '用户尚未同意隐私政策：请在弹窗中点击「同意」后重试',
  112: '当前生效的隐私指引未声明【收集你选中的照片或视频信息】。'
    + '注意：「账号设置」里改的是现网版本，小程序未发布过则不生效；开发版/体验版与现网版本是两份指引，互不同步；'
    + '补充声明约 5 分钟后生效，现网版本还需重新提审并发布',
  101100: '小程序后台「用户隐私保护指引」未声明该接口',
  1025: '小程序隐私接口被平台封禁，需到小程序后台处理'
}

/**
 * 选择图片失败时的提示：直接展示原始错误，便于区分「未授权」与「后台未声明」
 * @param {Object} err chooseMedia 失败回调参数
 */
function showChooseFailDialog(err) {
  const errMsg = (err && err.errMsg) || '未知错误'
  const errno = err && err.errno !== undefined ? err.errno : '无'
  const hint = CHOOSE_FAIL_HINT[errno]
  const content = `错误信息：${errMsg}\n错误码：${errno}${hint ? '\n\n' + hint : ''}`
  wx.showModal({
    title: '无法打开相册/相机',
    content,
    showCancel: false,
    confirmText: '知道了'
  })
}

module.exports = { ensurePrivacy, isUserCancel, showChooseFailDialog }
