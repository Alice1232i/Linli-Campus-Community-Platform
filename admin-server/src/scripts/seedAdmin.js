/**
 * 初始化管理员账户脚本
 * ------------------------------------------------------------
 * 在云数据库中创建 admin_users 集合并插入初始管理员账户。
 * 使用方式：node src/scripts/seedAdmin.js
 * 安全说明：初始密码为随机生成的强口令，仅打印一次；登录后请立即通过
 *           POST /api/auth/change-password 修改。
 */

const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const config = require('../config')
const CloudDbAdapter = require('../adapters/CloudDbAdapter')
const axios = require('axios')
const https = require('https')

const httpsAgent = config.isDev
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined

const BASE_URL = 'https://api.weixin.qq.com/tcb'
const adapter = new CloudDbAdapter()

/**
 * 获取 access_token
 */
async function getAccessToken() {
  const { appid, secret } = config.db.cloud
  const url = 'https://api.weixin.qq.com/cgi-bin/token'
  const res = await axios.get(url, {
    params: { grant_type: 'client_credential', appid, secret },
    timeout: 10000,
    httpsAgent
  })
  if (res.data.errcode) {
    throw new Error(`获取 token 失败: [${res.data.errcode}] ${res.data.errmsg}`)
  }
  return res.data.access_token
}

/**
 * 调用云数据库 API
 */
async function callApi(token, endpoint, body) {
  const url = `${BASE_URL}/${endpoint}?access_token=${token}`
  const res = await axios.post(url, { env: config.db.cloud.envId, ...body }, {
    timeout: 15000,
    httpsAgent
  })
  if (res.data.errcode) {
    throw new Error(`API错误 [${endpoint}]: [${res.data.errcode}] ${res.data.errmsg}`)
  }
  return res.data
}

/**
 * 创建集合（已存在则跳过）
 */
async function createCollection(token, name) {
  try {
    // 微信云数据库 HTTP API：POST /tcb/databasecollectionadd
    // 参数：env, collection_name
    await callApi(token, 'databasecollectionadd', { collection_name: name })
    console.log(`[OK] 集合 ${name} 创建成功`)
  } catch (e) {
    // 集合已存在时报 -501001 错误，忽略即可
    if (e.message.includes('-501001') || e.message.includes('already exists')) {
      console.log(`[SKIP] 集合 ${name} 已存在`)
    } else {
      throw e
    }
  }
}

async function main() {
  console.log('开始初始化管理员账户...')

  const token = await getAccessToken()
  console.log('[OK] 获取 access_token 成功')

  // 第一步：创建所需的集合
  console.log('\n--- 创建数据库集合 ---')
  await createCollection(token, 'admin_users')
  await createCollection(token, 'operation_logs')

  // 第二步：插入管理员账户
  console.log('\n--- 创建管理员账户 ---')
  const now = Date.now()
  // ---- 随机生成初始密码（不再硬编码 password123）----
  // 12 位：大写 + 小写 + 数字，确保强口令
  const tempPassword = Array.from({ length: 12 }, () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    return chars.charAt(crypto.randomInt(0, chars.length))
  }).join('')
  const passwordHash = bcrypt.hashSync(tempPassword, 10)

  const adminUser = {
    username: 'admin',
    password_hash: passwordHash,
    real_name: '超级管理员',
    role: 'super_admin',
    status: 'active',
    last_login_at: null,
    last_login_ip: null,
    created_at: now,
    updated_at: now
  }

  try {
    const res = await callApi(token, 'databaseadd', {
      query: `db.collection("admin_users").add({ data: ${JSON.stringify(adminUser)} })`
    })
    console.log('[OK] 管理员账户创建成功，ID:', res.id_list?.[0] || res.id)
  } catch (e) {
    if (e.message.includes('already exist') || e.message.includes('duplicate')) {
      console.log('[SKIP] 管理员账户已存在，跳过')
    } else {
      throw e
    }
  }

  // 验证查询
  const queryRes = await callApi(token, 'databasequery', {
    query: `db.collection("admin_users").where({"username":"admin"}).limit(1).get()`
  })

  if (queryRes.data && queryRes.data.length > 0) {
    const admin = JSON.parse(queryRes.data[0])
    console.log('[OK] 验证成功：', {
      username: admin.username,
      role: admin.role,
      status: admin.status
    })
  }

  console.log('')
  console.log('========================================')
  console.log('管理员账户初始化完成！')
  console.log('用户名: admin')
  console.log('初始密码（仅此一次展示，请立即保存）: ' + tempPassword)
  console.log('安全提示：请登录后通过「修改密码」功能立即更换，此密码不会再次展示！')
  console.log('========================================')
}

main().catch(e => {
  console.error('[ERROR]', e.message)
  process.exit(1)
})
