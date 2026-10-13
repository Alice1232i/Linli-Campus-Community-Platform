/**
 * 密码加密与验证工具
 * ------------------------------------------------------------
 * 基于 bcryptjs 实现管理员密码的哈希加密与比对。
 * 密码一律不以明文入库：注册 / 重置时调用 hashPassword 加密，
 * 登录时调用 verifyPassword 比对。
 *
 * bcrypt 的哈希结果中已内嵌盐值，无需单独存储盐。
 */
const bcrypt = require('bcryptjs')

/** bcrypt 加盐轮数，数值越大越安全但越慢，10 是安全性与性能的常用平衡值 */
const SALT_ROUNDS = 10

/**
 * 对明文密码进行加密
 * @param {string} plainText 明文密码
 * @returns {Promise<string>} 加密后的哈希字符串（含盐）
 */
async function hashPassword(plainText) {
  // bcrypt.hash 内部会自动生成随机盐并嵌入到返回的哈希中
  const hash = await bcrypt.hash(plainText, SALT_ROUNDS)
  return hash
}

/**
 * 校验明文密码与哈希是否匹配
 * @param {string} plainText 用户输入的明文密码
 * @param {string} hash 数据库中存储的哈希
 * @returns {Promise<boolean>} 匹配返回 true，否则返回 false
 */
async function verifyPassword(plainText, hash) {
  // bcrypt.compare 会从 hash 中提取盐值，再对明文进行同样加密后比对
  const isMatch = await bcrypt.compare(plainText, hash)
  return isMatch
}

module.exports = {
  hashPassword,
  verifyPassword,
  SALT_ROUNDS
}
