// utils/storage.js
// 本地缓存封装
// 对 wx.*StorageSync 做统一封装，提供默认值与异常兜底

/**
 * 读取本地缓存
 * @param {string} key 缓存键
 * @param {*} [defaultValue] 默认值（读取为空时返回）
 * @returns {*} 缓存值或默认值
 */
function get(key, defaultValue) {
  try {
    const value = wx.getStorageSync(key)
    if (value === '' || value === null || value === undefined) {
      return defaultValue
    }
    return value
  } catch (e) {
    return defaultValue
  }
}

/**
 * 写入本地缓存
 * @param {string} key 缓存键
 * @param {*} value 缓存值
 */
function set(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    // 忽略写入异常（如存储空间不足）
  }
}

/**
 * 移除指定缓存
 * @param {string} key 缓存键
 */
function remove(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    // 忽略
  }
}

/**
 * 清空所有本地缓存
 */
function clear() {
  try {
    wx.clearStorageSync()
  } catch (e) {
    // 忽略
  }
}

module.exports = {
  get,
  set,
  remove,
  clear
}
