/**
 * 临里校园 - 管理后台初始化云函数
 * ------------------------------------------------------------
 * 创建管理后台所需的集合并插入初始管理员账户。
 *
 * 使用方式：
 * 1. 在微信开发者工具中部署此云函数
 * 2. 云函数配置环境变量 ADMIN_INIT_KEY（安装密钥，必填）
 * 3. 通过 HTTP API 调用：POST /tcb/invokecloudfunction?name=initAdmin
 *    传参：{ key: "你的安装密钥", password?: "自定义初始密码（可选）" }
 *
 * 安全说明：
 * - 安装密钥从环境变量 ADMIN_INIT_KEY 读取，不再硬编码到源码
 * - 初始密码默认随机生成（仅返回一次），可传入自定义密码
 * - 此函数仅用于一次性初始化，部署并调用后建议删除
 */

const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 安装密钥从环境变量读取（必填，未配置则拒绝调用）
const INSTALL_KEY = process.env.ADMIN_INIT_KEY || ''

exports.main = async (event, context) => {
  // 未配置安装密钥：拒绝（防止无密钥保护下被未授权调用）
  if (!INSTALL_KEY) {
    return { code: 500, message: '未配置 ADMIN_INIT_KEY 环境变量，请先配置安装密钥' }
  }
  // 校验调用密钥（防时序对比：使用长度一致比较）
  if (!event.key || event.key.length !== INSTALL_KEY.length || !crypto.timingSafeEqual(Buffer.from(event.key), Buffer.from(INSTALL_KEY))) {
    return { code: 403, message: '密钥错误' }
  }

  const results = []

  // 1. 创建 admin_users 集合
  try {
    await db.createCollection('admin_users')
    results.push({ collection: 'admin_users', status: 'created' })
  } catch (e) {
    if (e.errCode === -501001 || (e.message && e.message.includes('already exists'))) {
      results.push({ collection: 'admin_users', status: 'exists' })
    } else {
      results.push({ collection: 'admin_users', status: 'error', message: e.message })
    }
  }

  // 2. 创建 operation_logs 集合
  try {
    await db.createCollection('operation_logs')
    results.push({ collection: 'operation_logs', status: 'created' })
  } catch (e) {
    if (e.errCode === -501001 || (e.message && e.message.includes('already exists'))) {
      results.push({ collection: 'operation_logs', status: 'exists' })
    } else {
      results.push({ collection: 'operation_logs', status: 'error', message: e.message })
    }
  }

  // 3. 检查是否已有管理员账户
  const { data: existing } = await db
    .collection('admin_users')
    .where({ username: 'admin' })
    .limit(1)
    .get()

  if (existing.length > 0) {
    results.push({ admin_user: 'already exists, skipped' })
  } else {
    const bcrypt = require('bcryptjs')
    const now = Date.now()

    // 初始密码：优先使用调用方传入的自定义密码；否则随机生成 12 位强口令（仅返回一次）
    const password = (typeof event.password === 'string' && event.password.length >= 8)
      ? event.password
      : Array.from({ length: 12 }, () => {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
          return chars.charAt(crypto.randomInt(0, chars.length))
        }).join('')

    await db.collection('admin_users').add({
      data: {
        username: 'admin',
        password_hash: bcrypt.hashSync(password, 10),
        real_name: '超级管理员',
        role: 'super_admin',
        status: 'active',
        last_login_at: null,
        last_login_ip: null,
        created_at: now,
        updated_at: now
      }
    })
    results.push({
      admin_user: 'created',
      username: 'admin',
      // 仅创建时返回一次密码；随机密码不会再次展示，请立即登录并修改
      password: (typeof event.password === 'string' && event.password.length >= 8) ? undefined : password
    })
  }

  return {
    code: 0,
    message: '初始化完成',
    data: results
  }
}
