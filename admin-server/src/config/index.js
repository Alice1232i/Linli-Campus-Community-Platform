/**
 * 配置加载模块 - 环境变量统一入口
 * ------------------------------------------------------------
 * 所有配置从环境变量读取，代码中零硬编码密钥。
 * 启动时校验必填项，缺失则直接报错终止，避免运行时才发现配置问题。
 */

require('dotenv').config()

/**
 * 读取环境变量，缺失时抛出明确错误
 * @param {string} key 环境变量名
 * @param {string} [desc] 参数用途描述（用于错误提示）
 * @returns {string}
 */
function requireEnv(key, desc) {
  const val = process.env[key]
  if (!val) {
    throw new Error(`环境变量 ${key} 未设置${desc ? '（' + desc + '）' : ''}，请检查 .env 文件`)
  }
  return val
}

/** 读取可选环境变量，带默认值 */
function optionalEnv(key, defaultValue) {
  return process.env[key] || defaultValue
}

/** 数据库类型：cloud 或 mysql */
const DB_TYPE = optionalEnv('DB_TYPE', 'cloud')

/**
 * 根据数据库类型校验对应的必填环境变量
 * 切换数据库只需改 DB_TYPE，无需改业务代码
 */
function validateDbConfig() {
  if (DB_TYPE === 'cloud') {
    requireEnv('WX_APPID', '小程序AppID')
    requireEnv('WX_SECRET', '小程序AppSecret')
    requireEnv('WX_ENV_ID', '云环境ID')
  } else if (DB_TYPE === 'mysql') {
    requireEnv('MYSQL_HOST', 'MySQL主机地址')
    requireEnv('MYSQL_USER', 'MySQL用户名')
    requireEnv('MYSQL_PASSWORD', 'MySQL密码')
    requireEnv('MYSQL_DATABASE', 'MySQL数据库名')
  } else {
    throw new Error(`不支持的 DB_TYPE: ${DB_TYPE}，仅支持 cloud 或 mysql`)
  }
}

// 启动时校验
validateDbConfig()

/** 统一配置对象 */
const config = {
  // 服务
  env: optionalEnv('NODE_ENV', 'development'),
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',

  // JWT
  jwt: {
    secret: requireEnv('JWT_SECRET', 'JWT签名密钥'),
    expiresIn: optionalEnv('JWT_EXPIRES_IN', '7d')
  },

  // 数据库
  db: {
    type: DB_TYPE,
    // 微信云数据库
    cloud: {
      appid: process.env.WX_APPID || '',
      secret: process.env.WX_SECRET || '',
      envId: process.env.WX_ENV_ID || ''
    },
    // MySQL
    mysql: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'linli_admin',
      connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10', 10)
    }
  },

  // 跨域
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim())
  },

  // 日志
  log: {
    retentionDays: parseInt(optionalEnv('LOG_RETENTION_DAYS', '90'), 10)
  }
}

module.exports = config
