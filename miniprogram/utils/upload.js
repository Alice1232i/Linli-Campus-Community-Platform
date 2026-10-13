// utils/upload.js
// 上传编排
// 负责：数量/体积校验 -> 压缩 -> 经适配器上传 -> 返回 fileID 数组

const { upload } = require('../api/adapter/index.js')
const { UPLOAD_MAX_COUNT, UPLOAD_MAX_SIZE } = require('../api/config')

/**
 * 压缩单张图片（自适应质量）
 * 根据原图体积自适应调整压缩质量：大图低质量、小图高质量
 * 避免双重压缩导致画质过度损失
 * @param {string} filePath 本地图片路径
 * @param {number} [fileSize] 已知文件大小（字节），未传则自动获取
 * @returns {Promise<string>} 压缩后的临时路径
 */
function compressImage(filePath, fileSize) {
  return new Promise(async (resolve) => {
    // 自适应质量：>5MB 用 60，>2MB 用 75，否则 85
    let quality = 85
    if (fileSize && fileSize > 0) {
      if (fileSize > 5 * 1024 * 1024) quality = 60
      else if (fileSize > 2 * 1024 * 1024) quality = 75
    }
    wx.compressImage({
      src: filePath,
      quality,
      success(res) { resolve(res.tempFilePath) },
      fail() { resolve(filePath) } // 压缩失败用原图
    })
  })
}

// 允许上传的图片扩展名白名单，防止上传 html/svg/js 等可执行或非图片文件
const ALLOW_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

// ============ 已上传结果缓存（P1）============
// 一次提交中前 N 张已成功上传，重试时直接复用，避免「第 7 张失败 → 前 6 张白传」。
// 键为本地临时路径：用户替换图片会得到新的临时路径，因此不存在过期命中问题。
const _uploadedByPath = {}
const UPLOAD_CACHE_MAX = 200

/**
 * 读取已上传缓存
 * @param {string} filePath 本地临时路径
 * @returns {string} 已上传的 fileID，未命中返回 ''
 */
function getCachedFileID(filePath) {
  return _uploadedByPath[filePath] || ''
}

/**
 * 写入已上传缓存（带简单容量控制，避免长时间使用后无限增长）
 * @param {string} filePath 本地临时路径
 * @param {string} fileID 云存储 fileID
 */
function setCachedFileID(filePath, fileID) {
  const keys = Object.keys(_uploadedByPath)
  if (keys.length >= UPLOAD_CACHE_MAX) {
    delete _uploadedByPath[keys[0]]
  }
  _uploadedByPath[filePath] = fileID
}

/**
 * 清空上传缓存
 * 供「移除图片 / 放弃提交」等场景主动失效，避免缓存残留占用内存
 */
function clearUploadCache() {
  Object.keys(_uploadedByPath).forEach((k) => { delete _uploadedByPath[k] })
}

/**
 * 获取文件大小（字节）
 * 获取失败返回 -1（而非 0），避免 0 被误判为"通过体积校验"
 * @param {string} filePath 本地文件路径
 * @returns {Promise<number>}
 */
function getFileSize(filePath) {
  return new Promise((resolve) => {
    wx.getFileInfo({
      filePath,
      success(res) { resolve(res.size || 0) },
      fail() { resolve(-1) }
    })
  })
}

/**
 * 生成云存储路径，避免命名冲突
 * 路径中嵌入 uploadKey（服务端签发的随机上传归属键）作为归属标识，
 * 服务端据此校验图片归属。注意：此处**不使用 openid**，
 * 避免身份标识明文写入存储路径；历史 upload/{openid}/... 图片服务端仍接受。
 * 仅允许白名单扩展名，非白名单统一使用 .png
 * @param {string} filePath 本地文件路径
 * @param {string} uploadKey 当前用户的上传归属键
 * @returns {string}
 */
function genCloudPath(filePath, uploadKey) {
  const rawExt = (filePath.match(/\.\w+$/) || ['.png'])[0].toLowerCase()
  // 扩展名白名单校验：非白名单统一改为 .png，避免伪造扩展名上传可执行文件
  const ext = ALLOW_EXTS.indexOf(rawExt) !== -1 ? rawExt : '.png'
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 10)
  // 路径格式：upload/{uploadKey}/{年}/{月}/{时间戳}_{随机串}.ext
  return `upload/${uploadKey}/${y}/${m}/${Date.now()}_${rand}${ext}`
}

/**
 * 上传单张图片（含缓存命中 + 体积校验 + 压缩 + 上传 + 结果校验）
 * 抽取为独立函数以便并发调用
 * @param {string} filePath 本地图片路径
 * @param {number} index 图片序号（用于错误提示）
 * @param {string} uploadKey 当前用户的上传归属键
 * @param {Function} [onProgress] 单张进度回调 (percent: 0-100) => void
 * @returns {Promise<string>} fileID
 */
async function uploadSingleImage(filePath, index, uploadKey, onProgress) {
  // ---- 缓存命中：该图此前已上传成功，直接复用（P1：重试不再重传已成功的图）----
  const cached = getCachedFileID(filePath)
  if (cached) {
    if (typeof onProgress === 'function') onProgress(100)
    return cached
  }

  // 单图体积校验：size 为 -1 表示获取失败，拒绝上传避免绕过体积限制
  const size = await getFileSize(filePath)
  if (size < 0) {
    throw new Error(`第 ${index + 1} 张图片读取失败，请重试`)
  }
  if (size > UPLOAD_MAX_SIZE) {
    throw new Error(`第 ${index + 1} 张图片超过 ${UPLOAD_MAX_SIZE / 1024 / 1024}MB 限制`)
  }

  // 压缩
  const compressed = await compressImage(filePath, size)

  // 经适配器上传（透传进度回调，P1：此前 9 图场景全程只有转圈、无任何反馈）
  const res = await upload({
    filePath: compressed,
    cloudPath: genCloudPath(filePath, uploadKey),
    onProgress: (percent) => {
      if (typeof onProgress === 'function') onProgress(percent)
    }
  }, { dedup: false, loading: false })

  // 严格校验返回值：必须有 fileID，否则视为上传失败
  const fileID = res && res.data && res.data.url
  if (!fileID || typeof fileID !== 'string') {
    throw new Error(`第 ${index + 1} 张图片上传失败，未获取到文件地址`)
  }
  // 确保是云存储 fileID（cloud:// 开头），而非本地临时路径
  if (fileID.indexOf('cloud://') !== 0 && fileID.indexOf('http') !== 0) {
    console.warn('[upload] 返回的不是云存储地址:', fileID)
    throw new Error(`第 ${index + 1} 张图片上传异常，请重试`)
  }
  // 记录缓存，供后续重试复用
  setCachedFileID(filePath, fileID)
  return fileID
}

/**
 * 受控并发：限制同时执行的 Promise 数量
 * @param {Array} items 待处理数组
 * @param {number} concurrency 并发数上限
 * @param {Function} fn 处理函数 (item, index) => Promise
 * @returns {Promise<Array>} 按原始顺序排列的结果数组
 */
async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i], i)
    }
  }

  const workers = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

/**
 * 批量上传图片（受控并发上传，并发数 3）
 * 流程：数量校验 -> 受控并发（缓存命中/体积校验/压缩/上传） -> 按序收集 fileID
 * 失败重试时：已成功的图片命中缓存不再重传，仅失败项会真正重传
 * @param {string[]} filePaths 本地图片路径数组
 * @param {string} uploadKey 当前用户的上传归属键（嵌入云存储路径用于归属校验）
 * @param {Object} [opts] 选项
 * @param {Function} [opts.onProgress] 总进度回调 (percent: 0-100, total: number) => void
 * @returns {Promise<string[]>} fileID / 资源地址数组
 */
async function uploadImages(filePaths, uploadKey, opts) {
  const onProgress = opts && opts.onProgress
  if (!filePaths || !filePaths.length) return []

  // 数量校验
  if (filePaths.length > UPLOAD_MAX_COUNT) {
    return Promise.reject(new Error(`最多上传 ${UPLOAD_MAX_COUNT} 张图片`))
  }

  // 归属键缺失时拒绝上传：否则会落到服务端无法校验的路径，图片最终会被判为「不属于你」
  if (!uploadKey) {
    return Promise.reject(new Error('登录状态异常，请重新登录后再试'))
  }

  const total = filePaths.length
  // 每张图的进度（0-100），用于合成整体百分比，避免进度长时间不动
  const percents = new Array(total).fill(0)
  const emitOverall = () => {
    if (typeof onProgress !== 'function') return
    let sum = 0
    for (let i = 0; i < total; i++) sum += percents[i]
    onProgress(Math.min(100, Math.floor(sum / total)), total)
  }

  // 受控并发上传：并发数 3，兼顾速度与稳定性
  // 9 张图从串行 9 倍耗时降至 3 批并发，约 3 倍耗时
  const results = await mapLimit(filePaths, 3, (filePath, index) => {
    return uploadSingleImage(filePath, index, uploadKey, (percent) => {
      percents[index] = percent
      emitOverall()
    })
  })
  // 全部完成后校准到 100%，避免浮点取整导致停在 99%
  if (typeof onProgress === 'function') onProgress(100, total)
  return results
}

module.exports = {
  compressImage,
  getFileSize,
  genCloudPath,
  uploadImages,
  clearUploadCache
}
