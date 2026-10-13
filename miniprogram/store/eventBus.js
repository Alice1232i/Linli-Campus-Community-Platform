// store/eventBus.js
// 跨页事件总线
// 提供全局事件的注册、触发与解绑，解决小程序跨页面 / 跨组件通信问题
// 典型场景：发帖后通知列表页刷新、点赞后通知详情页更新

// 事件表：{ eventName: [cb, cb, ...] }
const events = {}

/**
 * 注册事件监听
 * @param {string} event 事件名
 * @param {Function} cb 回调函数，参数为 emit 传入的 data
 * @returns {Function} 取消监听函数
 */
function on(event, cb) {
  if (typeof cb !== 'function') return function () {}
  if (!events[event]) events[event] = []
  events[event].push(cb)
  return function () {
    off(event, cb)
  }
}

/**
 * 注册一次性事件监听（触发一次后自动解绑）
 * @param {string} event 事件名
 * @param {Function} cb 回调函数
 */
function once(event, cb) {
  if (typeof cb !== 'function') return
  const wrapper = function (data) {
    off(event, wrapper)
    cb(data)
  }
  on(event, wrapper)
}

/**
 * 解除事件监听
 * @param {string} event 事件名
 * @param {Function} cb 需解绑的回调；不传则移除该事件全部监听
 */
function off(event, cb) {
  if (!events[event]) return
  if (!cb) {
    delete events[event]
    return
  }
  const idx = events[event].indexOf(cb)
  if (idx !== -1) events[event].splice(idx, 1)
  // 无监听者时清理
  if (events[event].length === 0) delete events[event]
}

/**
 * 触发事件
 * @param {string} event 事件名
 * @param {*} data 透传给回调的数据
 */
function emit(event, data) {
  const list = events[event]
  if (!list || !list.length) return
  // 拷贝一份，避免回调中 off 导致索引错乱
  const cbs = list.slice()
  for (let i = 0; i < cbs.length; i++) {
    try {
      cbs[i](data)
    } catch (e) {
      console.error('[eventBus] 回调执行异常:', event, e)
    }
  }
}

/**
 * 清空事件监听
 * @param {string} [event] 指定事件名；不传则清空全部
 */
function clear(event) {
  if (event) {
    delete events[event]
  } else {
    Object.keys(events).forEach(function (k) { delete events[k] })
  }
}

module.exports = {
  on,
  once,
  off,
  emit,
  clear
}
