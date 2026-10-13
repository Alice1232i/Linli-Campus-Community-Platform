// utils/cloud.js
// 云开发封装
// 提供环境初始化与实时数据监听的统一封装

const { CLOUD_ENV } = require('../api/config')

/**
 * 初始化云开发
 * @param {string} [env] 云开发环境 ID，未传则使用 config.CLOUD_ENV
 * @param {boolean} [traceUser=true] 是否记录用户访问
 */
function initCloud(env, traceUser) {
  if (!wx.cloud) {
    console.error('[cloud] 当前基础库不支持云开发，请升级微信开发者工具')
    return false
  }
  wx.cloud.init({
    env: env || CLOUD_ENV,
    traceUser: traceUser !== false
  })
  return true
}

/**
 * 实时监听集合数据变化
 * 封装 db.collection().where().watch()
 * @param {string} collection 集合名
 * @param {Object} where 查询条件
 * @param {Function} onChange 数据变化回调，参数为 snapshot
 * @param {Function} [onError] 错误回调
 * @returns {Object} watcher 监听器，调用 .close() 可关闭监听
 */
function watch(collection, where, onChange, onError) {
  const db = wx.cloud.database()
  const watcher = db.collection(collection)
    .where(where || {})
    .watch({
      onChange(snapshot) {
        if (typeof onChange === 'function') onChange(snapshot)
      },
      onError(err) {
        console.error('[cloud watch] 监听异常:', collection, err)
        if (typeof onError === 'function') onError(err)
      }
    })
  return watcher
}

module.exports = {
  initCloud,
  watch
}
