/**
 * 临里校园 - 全局常量与枚举定义（单一数据来源）
 * ------------------------------------------------------------
 * 本文件是前端小程序与云函数共同使用的"单一数据来源 (SSOT)"。
 * 任何模块名、状态值、板块列表等枚举都应只在这里定义，
 * 其他地方通过 require 引用，避免硬编码造成的不一致。
 *
 * 注意：所有枚举值统一使用小写字符串，便于数据库存储与比较。
 * 使用方式（CommonJS）：
 *   const { MODULES, POST_STATUS } = require('./shared/constants')
 */

/**
 * 业务模块枚举
 * 对应小程序中的几大主要功能模块
 */
const MODULES = {
  COMMUNITY: 'community', // 社区模块
  LOSTFOUND: 'lostfound', // 失物招领模块
  DELIVERY: 'delivery' // 跑腿代拿模块
}

/**
 * 社区板块列表
 * key   : 板块唯一标识，存入数据库
 * name  : 板块中文名称，用于界面展示
 */
const SECTIONS = [
  { key: 'daily', name: '闲聊吐槽' },
  { key: 'secondhand', name: '二手交易' },
  { key: 'help', name: '求助问答' },
  { key: 'study', name: '学习打卡' },
  { key: 'emotion', name: '表白墙' },
  { key: 'news', name: '校园资讯' },
  { key: 'parttime', name: '兼职信息' },
  { key: 'carpool', name: '拼车搭子' },
  { key: 'activity', name: '活动组队' }
]

/**
 * 帖子状态
 * normal    : 正常显示
 * hidden    : 被隐藏（违规或作者主动隐藏）
 * deleted   : 已删除（软删除）
 * reviewing : 内容安全审核中
 */
const POST_STATUS = {
  NORMAL: 'normal',
  HIDDEN: 'hidden',
  DELETED: 'deleted',
  REVIEWING: 'reviewing'
}

/**
 * 内容安全状态
 * pass      : 内容安全检测通过
 * risk      : 内容存在风险
 * reviewing : 人工审核中
 */
const SEC_STATUS = {
  PASS: 'pass',
  RISK: 'risk',
  REVIEWING: 'reviewing'
}

/**
 * 跑腿代拿任务状态
 * open       : 待接单
 * accepted   : 已接单
 * delivering : 配送中
 * done       : 已完成
 * cancelled  : 已取消
 */
const DELIVERY_STATUS = {
  OPEN: 'open',
  ACCEPTED: 'accepted',
  DELIVERING: 'delivering',
  DONE: 'done',
  CANCELLED: 'cancelled'
}

/**
 * 失物招领类型
 * lost  : 丢失（我丢的东西）
 * found : 拾获（我捡到的东西）
 */
const LOSTFOUND_KIND = {
  LOST: 'lost',
  FOUND: 'found'
}

/**
 * 用户角色
 * user     : 普通用户
 * merchant : 商家
 * admin    : 管理员
 */
const USER_ROLE = {
  USER: 'user',
  MERCHANT: 'merchant',
  ADMIN: 'admin'
}

/**
 * 用户账号状态
 * active : 正常
 * muted  : 禁言
 * banned : 封禁
 */
const USER_STATUS = {
  ACTIVE: 'active',
  MUTED: 'muted',
  BANNED: 'banned'
}

/**
 * 学生认证状态
 * pending  : 待审核
 * approved : 已通过
 * rejected : 已驳回
 */
const VERIFY_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
}

/**
 * 举报原因
 * spam    : 垃圾广告
 * abuse   : 辱骂攻击
 * porn    : 色情低俗
 * fraud   : 欺诈骗钱
 * privacy : 隐私泄露
 * other   : 其他
 */
const REPORT_REASON = {
  SPAM: 'spam',
  ABUSE: 'abuse',
  PORN: 'porn',
  FRAUD: 'fraud',
  PRIVACY: 'privacy',
  OTHER: 'other'
}

/**
 * 举报处理状态
 * pending    : 待处理
 * processing : 处理中
 * resolved   : 已处理（成立）
 * rejected   : 已驳回（不成立）
 */
const REPORT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  RESOLVED: 'resolved',
  REJECTED: 'rejected'
}

/**
 * 通知类型
 * like     : 点赞通知
 * comment  : 评论通知
 * favorite : 收藏通知
 * follow   : 关注通知
 * order    : 订单通知
 * chat     : 聊天消息通知
 * system   : 系统通知
 * report   : 举报处理通知
 */
const NOTIFY_TYPE = {
  LIKE: 'like',
  COMMENT: 'comment',
  FAVORITE: 'favorite',
  FOLLOW: 'follow',
  ORDER: 'order',
  CHAT: 'chat',
  SYSTEM: 'system',
  REPORT: 'report'
}

/**
 * 聊天消息类型
 * text  : 纯文本
 * image : 图片
 */
const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image'
}

/**
 * 通用目标类型
 * 用于点赞、评论、举报等场景标识操作对象类型
 * post      : 帖子
 * comment   : 评论
 * user      : 用户
 * message   : 消息
 * lostfound : 失物招领
 * delivery  : 跑腿代拿
 */
const TARGET_TYPE = {
  POST: 'post',
  COMMENT: 'comment',
  USER: 'user',
  MESSAGE: 'message',
  LOSTFOUND: 'lostfound',
  DELIVERY: 'delivery'
}

/**
 * 点赞目标类型
 * post    : 帖子
 * comment : 评论
 */
const LIKE_TARGET = {
  POST: 'post',
  COMMENT: 'comment'
}

/**
 * 社区板块展示元数据映射
 * 统一定义各板块的中文名、文字色、底色，供 post-card / 详情页 / 首页等共用
 * 配色方案：深色文字 + 同色系浅色底（彩色药丸标签风格）
 * 修改板块配色只需改此处，所有页面自动生效
 */
const SECTION_META = {
  daily:      { name: '闲聊吐槽', color: '#4A90D9', bgColor: '#E8F0FA' },
  secondhand: { name: '二手交易', color: '#E67E22', bgColor: '#FFF3E0' },
  help:       { name: '求助问答', color: '#2ECC71', bgColor: '#E8F5E8' },
  study:      { name: '学习打卡', color: '#9B59B6', bgColor: '#F0E8F5' },
  emotion:    { name: '表白墙',   color: '#E74C8F', bgColor: '#FFEBEE' },
  news:       { name: '校园资讯', color: '#16A085', bgColor: '#E0F5F0' },
  parttime:   { name: '兼职信息', color: '#F39C12', bgColor: '#FFF8E1' },
  carpool:    { name: '拼车搭子', color: '#1ABC9C', bgColor: '#E8F8F5' },
  activity:   { name: '活动组队', color: '#6C5CE7', bgColor: '#EEEAFB' }
}

// 板块元数据默认兜底值（未知板块 / 无板块时使用）
const SECTION_META_DEFAULT = { name: '社区', color: '#9CA3AF', bgColor: '#F5F5F5' }

/**
 * 获取板块展示元数据（名称 + 颜色）
 * 供 post-card / 帖子详情页等调用，确保全站板块标签展示一致
 * @param {string} section 板块 key
 * @returns {{ name: string, color: string }} 板块元数据
 */
function getSectionMeta(section) {
  if (!section) return SECTION_META_DEFAULT
  return SECTION_META[section] || SECTION_META_DEFAULT
}

/**
 * 院系与本科专业清单（杭州电子科技大学信息工程学院，26 个本科专业）
 * ------------------------------------------------------------
 * 用途：
 *   - 「编辑资料」页的 学院 / 专业 联动选择
 *   - user.updateProfile 的参数校验（学院、专业必须匹配）
 *   - 管理后台用户详情展示
 *
 * 注意：特色班（会计学 ACCA 班、金融学 CFA 班、成电联合培养班、杭电拔尖实验班等）
 *      属于「专业内的方向班」，不是独立专业，因此不作为独立选项。
 */
const COLLEGE_MAJORS = [
  {
    name: '电子工程学院',
    majors: ['电子信息工程', '通信工程', '电子信息科学与技术']
  },
  {
    name: '计算机学院',
    majors: ['计算机科学与技术', '软件工程', '网络工程', '物联网工程', '人工智能']
  },
  {
    name: '机械工程学院',
    majors: [
      '机械设计制造及其自动化',
      '电气工程及其自动化',
      '自动化',
      '工业设计',
      '产品设计',
      '智能制造工程'
    ]
  },
  {
    name: '管理学院',
    majors: [
      '信息管理与信息系统',
      '市场营销',
      '财务管理',
      '人力资源管理',
      '物流管理',
      '电子商务',
      '工商管理',
      '会计学'
    ]
  },
  {
    name: '经济学院',
    majors: ['金融学', '国际经济与贸易', '英语', '跨境电子商务']
  }
]

/** 学院名列表（便于下拉与校验） */
const COLLEGE_NAMES = COLLEGE_MAJORS.map(function (c) { return c.name })

/** 全部本科专业（扁平化，26 个） */
const ALL_MAJORS = COLLEGE_MAJORS.reduce(function (acc, c) { return acc.concat(c.majors) }, [])

/**
 * 届数可选年份（毕业年份），覆盖在校生与近年校友。
 * 生成为倒序（新年份在前），便于 picker 直接展示。
 */
const GRADE_YEARS = (function buildGradeYears() {
  const years = []
  for (let y = 2032; y >= 2018; y--) years.push(String(y))
  return years
})()

/**
 * 校验学院名是否合法
 * @param {string} name 学院名
 * @returns {boolean}
 */
function isValidCollege(name) {
  return COLLEGE_NAMES.indexOf(name) !== -1
}

/**
 * 校验专业是否属于指定学院
 * @param {string} college 学院名
 * @param {string} major 专业名
 * @returns {boolean}
 */
function isValidMajor(college, major) {
  for (let i = 0; i < COLLEGE_MAJORS.length; i++) {
    if (COLLEGE_MAJORS[i].name === college) {
      return COLLEGE_MAJORS[i].majors.indexOf(major) !== -1
    }
  }
  return false
}

/**
 * 校验届数（毕业年份）是否合法
 * @param {string|number} grade 届数
 * @returns {boolean}
 */
function isValidGrade(grade) {
  return GRADE_YEARS.indexOf(String(grade)) !== -1
}

module.exports = {
  MODULES,
  SECTIONS,
  POST_STATUS,
  SEC_STATUS,
  DELIVERY_STATUS,
  LOSTFOUND_KIND,
  USER_ROLE,
  USER_STATUS,
  VERIFY_STATUS,
  REPORT_REASON,
  REPORT_STATUS,
  NOTIFY_TYPE,
  MESSAGE_TYPE,
  TARGET_TYPE,
  LIKE_TARGET,
  SECTION_META,
  COLLEGE_MAJORS,
  COLLEGE_NAMES,
  ALL_MAJORS,
  GRADE_YEARS,
  isValidCollege,
  isValidMajor,
  isValidGrade,
  getSectionMeta
}
