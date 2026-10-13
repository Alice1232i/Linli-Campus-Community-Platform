/**
 * 临里校园 - shared 共享层同步脚本
 * ------------------------------------------------------------
 * 作用：将项目根目录下的 shared/ 文件夹递归同步拷贝到各使用方：
 *   1. miniprogram/utils/shared/        —— 前端小程序使用
 *   2. cloudfunctions/<每个云函数>/shared/ —— 自动扫描 cloudfunctions 目录下所有子目录
 *
 * 用法：
 *   node scripts/sync-shared.js
 *
 * 说明：
 *   - shared/ 为共享层代码的"唯一编辑源"，请勿直接修改各目标目录下的副本。
 *   - 每次修改 shared/ 后需重新运行本脚本，以保持各端代码一致。
 *   - 同步采用"先清空目标目录再拷贝"的策略，确保删除文件也能同步生效。
 *   - 仅拷贝文件，不拷贝 node_modules 等依赖目录。
 */

const fs = require('fs')
const path = require('path')

// 项目根目录（本脚本位于 <根>/scripts/ 下，回退一层即为根目录）
const ROOT = path.join(__dirname, '..')

// 共享层源目录
const SHARED_SRC = path.join(ROOT, 'shared')

// 固定同步目标：前端小程序
const FIXED_TARGETS = [path.join(ROOT, 'miniprogram', 'utils', 'shared')]

/**
 * 扫描 cloudfunctions 目录，收集每个云函数的 shared 目标路径
 * @returns {string[]} 云函数 shared 目标路径列表
 */
function collectCloudTargets() {
  const cloudDir = path.join(ROOT, 'cloudfunctions')
  const targets = []
  if (!fs.existsSync(cloudDir)) {
    return targets
  }
  const entries = fs.readdirSync(cloudDir, { withFileTypes: true })
  entries.forEach((entry) => {
    if (entry.isDirectory()) {
      targets.push(path.join(cloudDir, entry.name, 'shared'))
    }
  })
  return targets
}

/**
 * 递归删除目录（兼容 fs.rmSync 与旧版 fs.rmdirSync）
 * @param {string} dir 待删除目录
 */
function rmrf(dir) {
  if (!fs.existsSync(dir)) return
  try {
    if (typeof fs.rmSync === 'function') {
      fs.rmSync(dir, { recursive: true, force: true })
    } else {
      fs.rmdirSync(dir, { recursive: true })
    }
  } catch (e) {
    console.warn(`[warn] 删除目录失败: ${dir}，错误: ${e.message}`)
  }
}

/**
 * 递归拷贝目录，返回已拷贝文件相对路径列表
 * @param {string} src 源目录
 * @param {string} dest 目标目录
 * @param {string} [base] 源基准目录，用于计算相对路径（默认为 src）
 * @returns {string[]} 已拷贝文件相对路径列表
 */
function copyDir(src, dest, base) {
  const baseDir = base || src
  // 确保目标目录存在
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const copied = []
  const entries = fs.readdirSync(src, { withFileTypes: true })
  entries.forEach((entry) => {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    // 跳过依赖目录与隐藏文件
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      return
    }
    if (entry.isDirectory()) {
      copied.push(...copyDir(srcPath, destPath, baseDir))
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
      copied.push(path.relative(baseDir, srcPath))
    }
  })
  return copied
}

/**
 * 同步 shared/ 到指定目标目录
 * @param {string} target 目标目录路径
 * @returns {string[]} 已拷贝文件相对路径列表
 */
function syncToTarget(target) {
  // 先清空目标目录，保证与源目录完全一致
  rmrf(target)
  const copied = copyDir(SHARED_SRC, target)
  return copied
}

/**
 * 主流程
 */
function main() {
  console.log('========================================')
  console.log(' 临里校园 - shared 共享层同步')
  console.log('========================================')

  // 检查源目录是否存在
  if (!fs.existsSync(SHARED_SRC)) {
    console.error(`[error] 共享层源目录不存在: ${SHARED_SRC}`)
    process.exit(1)
  }

  // 收集所有同步目标
  const cloudTargets = collectCloudTargets()
  const targets = FIXED_TARGETS.concat(cloudTargets)

  console.log(`源目录: ${SHARED_SRC}`)
  console.log(`同步目标数量: ${targets.length}`)
  console.log('----------------------------------------')

  let totalFiles = 0
  targets.forEach((target, index) => {
    // 计算目标相对根目录的展示路径
    const relTarget = path.relative(ROOT, target)
    console.log(`[${index + 1}/${targets.length}] 同步到: ${relTarget}`)
    const copied = syncToTarget(target)
    copied.forEach((file) => {
      console.log(`    - ${file}`)
    })
    console.log(`    完成，共 ${copied.length} 个文件`)
    totalFiles += copied.length
  })

  console.log('----------------------------------------')
  console.log(`同步完成：共 ${targets.length} 个目标，${totalFiles} 个文件`)
  console.log('提示：请勿直接修改各目标目录下的副本，统一在 shared/ 中修改后重新运行本脚本。')
  console.log('========================================')
}

// 执行主流程
main()
