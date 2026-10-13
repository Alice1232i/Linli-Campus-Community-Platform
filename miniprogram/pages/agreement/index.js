// pages/agreement/index.js
// 文档展示页：用户协议 / 隐私政策 / 关于我们
// ------------------------------------------------------------
// 三种文档共用一页（纯静态展示，无交互），原因：
//   1. 不为静态文档新增页面与分包（主包体积已接近 2MB 上限）
//   2. 登录页与设置页共用同一路由，文案只维护一份
// 维护提醒：
//   - 文档中的功能范围（社区板块 / 失物招领 / 学生认证）与 app.json 的
//     权限声明（scope.userLocation + chooseLocation、相册相机）保持一致；
//   - 新增业务能力（如支付、后台定位、第三方 SDK）时必须同步更新隐私政策与本页。

// type → 导航栏标题（type 同时是 wxml 的分支条件，勿随意改名）
const TITLES = {
  agreement: '用户协议',
  privacy: '隐私政策',
  about: '关于我们'
}

// 版本与更新日期：三份文档共用，改版时同步更新
const APP_VERSION = '1.0.0'
const UPDATED_AT_TEXT = '2026年10月11日'

// 运营方联系邮箱：填入后「关于我们」与两份协议会自动展示该行；留空则不展示
// TODO: 由运营方补充（邮箱 / 公众号 / 客服企微），并在小程序后台开启客服功能
const CONTACT_EMAIL = ''

Page({
  data: {
    type: 'privacy',
    pageTitle: TITLES.privacy,
    version: APP_VERSION,
    updatedAtText: UPDATED_AT_TEXT,
    contactEmail: CONTACT_EMAIL,
    // 关于页 · 功能概览（与 app.json 已注册页面一一对应，勿写未上线的功能）
    features: [
      '社区板块：闲聊吐槽 / 二手交易 / 求助问答 / 学习打卡 / 表白墙 / 校园资讯 / 兼职信息 / 拼车搭子 / 活动组队',
      '失物招领：发布与查找，支持地点标注与导航',
      '学生认证：校园邮箱验证学生身份',
      '帖子互动：点赞、评论、收藏、举报、拉黑',
      '消息通知：互动提醒与订阅消息'
    ],
    // 关于页 · 公益承诺（纯公益定位的核心表述）
    pledges: [
      '完全免费：不收取任何费用，无会员、充值、付费解锁',
      '不投放商业广告，不做流量变现',
      '不参与交易：不抽成、不担保、不代收款项',
      '数据不商用：不用于广告投放，不对外出售'
    ]
  },

  /**
   * 页面加载
   * @param {object} options 路由参数，options.type: agreement | privacy | about
   */
  onLoad(options) {
    // 白名单校验：防止 type=constructor 之类原型链键名命中
    const type = Object.prototype.hasOwnProperty.call(TITLES, options.type || '')
      ? options.type
      : 'privacy'
    this.setData({ type, pageTitle: TITLES[type] })
  }
})
