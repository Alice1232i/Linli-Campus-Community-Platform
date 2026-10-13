/**
 * 参数校验中间件
 * ------------------------------------------------------------
 * 基于 rules 规则对象校验请求参数，校验来源支持 body / query / params。
 *
 * 支持的校验项：
 *   required : 是否必填（true 时字段必须存在且非空）
 *   type     : 类型校验，支持 'string' | 'number' | 'boolean' | 'array' | 'object'
 *   min      : 最小值（number 为数值下限，string / array 为长度下限）
 *   max      : 最大值（number 为数值上限，string / array 为长度上限）
 *   enum     : 枚举校验，值必须在给定数组中
 *
 * 校验失败返回：
 *   - 必填缺失 → 1001 (PARAM_MISSING)
 *   - 类型 / 范围 / 枚举不合法 → 1002 (PARAM_INVALID)
 *
 * 用法：
 *   router.post('/users',
 *     validate({ username: { required: true, type: 'string', min: 3, max: 20 } }, 'body'),
 *     validate({ page: { type: 'number', min: 1 } }, 'query'),
 *     userController.create)
 */
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

/**
 * 类型判断
 * @param {*} value 字段值
 * @param {string} type 期望类型
 * @returns {boolean}
 */
function checkType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      // 未知类型不做校验
      return true
  }
}

/**
 * 获取用于范围比较的数值
 * - number：比较数值本身
 * - string / array：比较长度
 * @param {*} value 字段值
 * @param {string} type 字段类型
 * @returns {number|null}
 */
function getComparable(value, type) {
  if (type === 'number') {
    return typeof value === 'number' && !Number.isNaN(value) ? value : null
  }
  if (type === 'string') {
    return typeof value === 'string' ? value.length : null
  }
  if (type === 'array') {
    return Array.isArray(value) ? value.length : null
  }
  return null
}

/**
 * 校验单个字段
 * @param {*} value 字段值
 * @param {Object} rule 校验规则
 * @returns {{ valid: boolean, missing: boolean, message?: string }}
 */
function validateField(value, rule) {
  // 1. 必填校验：undefined / null / 空字符串 / 空数组视为缺失
  const isEmpty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)

  if (rule.required && isEmpty) {
    return { valid: false, missing: true, message: '参数缺失' }
  }

  // 非必填且为空，跳过后续校验
  if (isEmpty) {
    return { valid: true }
  }

  // 2. 类型校验
  if (rule.type && !checkType(value, rule.type)) {
    return { valid: false, missing: false, message: `类型应为 ${rule.type}` }
  }

  // 3. 数值或长度范围校验
  if (rule.min !== undefined || rule.max !== undefined) {
    const cmp = getComparable(value, rule.type)
    if (cmp !== null) {
      if (rule.min !== undefined && cmp < rule.min) {
        return { valid: false, missing: false, message: `不能小于 ${rule.min}` }
      }
      if (rule.max !== undefined && cmp > rule.max) {
        return { valid: false, missing: false, message: `不能大于 ${rule.max}` }
      }
    }
  }

  // 4. 枚举校验
  if (Array.isArray(rule.enum) && rule.enum.length > 0) {
    if (!rule.enum.includes(value)) {
      return {
        valid: false,
        missing: false,
        message: `取值必须为 ${rule.enum.join(',')} 之一`
      }
    }
  }

  return { valid: true }
}

/**
 * 参数校验中间件工厂
 * @param {Object} rules 校验规则对象，key 为字段名，value 为规则
 * @param {string} [source='body'] 校验来源：'body' | 'query' | 'params'
 * @returns {Function} Koa 中间件
 */
function validate(rules, source = 'body') {
  return async (ctx, next) => {
    // 根据来源取出待校验数据
    let data
    switch (source) {
      case 'query':
        data = ctx.query || {}
        break
      case 'params':
        data = ctx.params || {}
        break
      case 'body':
      default:
        data = (ctx.request && ctx.request.body) || {}
        break
    }

    // 逐字段校验，遇到第一个错误即返回
    for (const field of Object.keys(rules)) {
      const rule = rules[field]
      const result = validateField(data[field], rule)
      if (!result.valid) {
        // 区分参数缺失与参数不合法
        const code = result.missing ? ERRORS.PARAM_MISSING : ERRORS.PARAM_INVALID
        ctx.body = {
          code,
          data: null,
          message: `[${field}] ${result.message}`
        }
        ctx.status = 200
        return
      }
    }

    // 全部校验通过，继续执行后续中间件 / 控制器
    await next()
  }
}

module.exports = {
  validate,
  validateField
}
