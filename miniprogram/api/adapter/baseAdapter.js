// api/adapter/baseAdapter.js
// 基础适配器契约
// 定义所有适配器（云开发 / HTTP）必须实现的 request 与 upload 接口规范
// 同时导出统一的响应归一化函数 normalizeResponse，保证不同后端返回结构一致

/**
 * 适配器接口契约（文档说明，子适配器需遵循以下签名）：
 *
 * request({ name, data }) -> Promise<{ code, data, message }>
 *   - name:  云函数名 / 接口路径（即模块名，如 'post'）
 *   - data:  请求参数（其中 action 字段用于子路由）
 *
 * upload({ filePath, cloudPath }) -> Promise<{ code, data: { url }, message }>
 *   - filePath:   本地临时文件路径
 *   - cloudPath:  云存储路径（云适配器使用）；HTTP 适配器可忽略
 *   - 返回的 data.url 即可直接使用的资源地址
 */

/**
 * 统一响应归一化函数
 * 将各类后端的原始返回结构统一为 { code, data, message }
 *
 * 约定：
 *   - code 为 0 或 200 表示成功
 *   - data  为业务数据
 *   - message 为提示信息
 *
 * @param {Object} res 原始响应
 * @returns {{ code: number, data: any, message: string }}
 */
function normalizeResponse(res) {
  // 兜底：res 为空时返回失败
  if (!res) {
    return { code: -1, data: null, message: '无响应' }
  }

  // 已是标准结构 { code, data, message }
  if (res.code !== undefined) {
    return {
      code: Number(res.code),
      data: res.data !== undefined ? res.data : null,
      message: res.message || ''
    }
  }

  // 兼容 { errno, errmsg } 风格（云开发部分接口）
  if (res.errno !== undefined) {
    return {
      code: Number(res.errno),
      data: res.data !== undefined ? res.data : null,
      message: res.errmsg || '请求失败'
    }
  }

  // 兼容直接返回业务数据的情况（无 code 字段），视为成功
  return { code: 0, data: res, message: '' }
}

module.exports = {
  normalizeResponse
}
