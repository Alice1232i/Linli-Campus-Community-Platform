// pages/discover/index.js
// 发现页 - 板块导航 + 社区热度 + 跨板块内容聚合
// 页面结构（自上而下）：
//   1. 页头：探索板块 + 副标题
//   2. 横向滚动板块标签栏（8 个板块，点击进入对应板块帖子列表 / 模块页）
//   3. 板块热度榜单（排名 / 板块标签 / 帖子总数 / 本周活跃人数 / 最新帖子动态，最多 6 条）
//   4. 精选内容（每个热门板块取 2 条最热帖子预览，点击进入帖子详情）
// 页面定位：板块导航 + 社区热度 + 跨板块内容聚合，与首页信息流（Banner / 宫格 / 排序流）区分，不重复
// 约束：无轮播、无八宫格；配色 / 圆角 / 字体 / 间距统一走设计 token

const api = require('../../api/index.js')
const { getSectionMeta } = require('../../utils/shared/constants.js')
const { formatListTime, sanitizeImageUrl } = require('../../utils/format.js')
const { checkBanBeforeNavigate } = require('../../utils/ban-check.js')

// 默认头像（作者头像缺失 / 为临时路径时占位）
const DEFAULT_AVATAR = '/images/icons/user.png'

// 失物招领为独立业务模块（posts 中以 module=lostfound 存储、无 section 字段），单独配置展示元数据
const LOSTFOUND_META = { color: '#3498DB', bgColor: '#E8F1FB' }

// 板块标签栏（横向滚动）：8 个板块，点击跳转对应板块帖子列表 / 模块页
// 顺序与产品需求一致：求助问答、闲聊吐槽、二手交易、表白墙、失物招领、兼职信息、拼车搭子、活动组队
const TAGS = [
  { key: 'help',       name: '求助问答', navUrl: '/pages/section/list/index?section=help' },
  { key: 'daily',      name: '闲聊吐槽', navUrl: '/pages/section/list/index?section=daily' },
  { key: 'secondhand', name: '二手交易', navUrl: '/pages/section/list/index?section=secondhand' },
  { key: 'emotion',    name: '表白墙',   navUrl: '/pages/section/list/index?section=emotion' },
  { key: 'lostfound',  name: '失物招领', navUrl: '/pages/lostfound/index/index' },
  { key: 'parttime',   name: '兼职信息', navUrl: '/pages/section/list/index?section=parttime' },
  { key: 'carpool',    name: '拼车搭子', navUrl: '/pages/section/list/index?section=carpool' },
  { key: 'activity',   name: '活动组队', navUrl: '/pages/section/list/index?section=activity' }
]

// 板块热度统计范围：社区 7 个板块 + 失物招领模块
// module 用于拉取帖子，section 为空表示该模块帖子无板块字段（如失物招领）
const BOARDS = [
  { key: 'help',       name: '求助问答', module: 'community', section: 'help',       navUrl: '/pages/section/list/index?section=help' },
  { key: 'daily',      name: '闲聊吐槽', module: 'community', section: 'daily',      navUrl: '/pages/section/list/index?section=daily' },
  { key: 'secondhand', name: '二手交易', module: 'community', section: 'secondhand', navUrl: '/pages/section/list/index?section=secondhand' },
  { key: 'emotion',    name: '表白墙',   module: 'community', section: 'emotion',    navUrl: '/pages/section/list/index?section=emotion' },
  { key: 'parttime',   name: '兼职信息', module: 'community', section: 'parttime',   navUrl: '/pages/section/list/index?section=parttime' },
  { key: 'carpool',    name: '拼车搭子', module: 'community', section: 'carpool',    navUrl: '/pages/section/list/index?section=carpool' },
  { key: 'activity',   name: '活动组队', module: 'community', section: 'activity',   navUrl: '/pages/section/list/index?section=activity' },
  { key: 'lostfound',  name: '失物招领', module: 'lostfound', section: '',           navUrl: '/pages/lostfound/index/index' }
]

const HOT_LIMIT = 6                     // 热度榜单最多展示条数
const FEATURED_SECTION_LIMIT = 4        // 精选内容覆盖的热门板块数
const FEATURED_POSTS_PER_SECTION = 2    // 每个热门板块精选的帖子数
const SAMPLE_SIZE = 20                  // 单板块取样条数（用于统计帖子数 / 活跃 / 最新动态）
const WEEK_MS = 7 * 24 * 60 * 60 * 1000 // 一周毫秒数（「本周活跃」口径）
const HEAT_ACTIVE_WEIGHT = 2            // 热度公式中活跃人数权重（体现"内容 & 活跃度越高越靠前"）
const EXCERPT_MAX = 48                  // 精选帖摘要最大字符数
const LATEST_MAX = 24                   // 热度榜「最新动态」最大字符数
const NAV_DEBOUNCE_MS = 300             // 页面跳转防抖间隔

/**
 * 文本截断（Skyline 不支持 line-clamp，摘要需在 JS 层截断）
 * @param {string} text 原始文本
 * @param {number} max 最大字符数
 * @returns {string} 截断后的文本
 */
function truncateText(text, max) {
  if (!text) return ''
  const t = String(text).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/**
 * 取帖子作者唯一标识（用于统计本周活跃人数）
 * 兼容 _openid / author.openid / author._openid 三种字段命名
 * @param {Object} post 帖子
 * @returns {string} 作者标识（缺失返回空串）
 */
function authorKey(post) {
  if (!post) return ''
  const a = post.author || {}
  return post._openid || a.openid || a._openid || ''
}

/**
 * 取作者头像（净化无效临时路径，兜底默认头像）
 * @param {Object} post 帖子
 * @returns {string} 头像地址
 */
function pickAvatar(post) {
  const a = (post && post.author) || {}
  return sanitizeImageUrl(a.avatar || a.avatarUrl, DEFAULT_AVATAR) || DEFAULT_AVATAR
}

/**
 * 取作者昵称
 * @param {Object} post 帖子
 * @returns {string} 昵称
 */
function pickNickname(post) {
  const a = (post && post.author) || {}
  return a.nickname || a.nickName || '匿名同学'
}

/**
 * 取帖子时间戳（兼容 createdAt / createTime / sortTime）
 * @param {Object} post 帖子
 * @returns {number} 毫秒时间戳
 */
function postTime(post) {
  if (!post) return 0
  return post.createdAt || post.createTime || post.sortTime || 0
}

/**
 * 板块热度分：帖子总数 + 活跃人数加权
 * 内容越多、本周越活跃，分值越高、排名越靠前
 * @param {Object} item 板块统计项
 * @returns {number} 热度分
 */
function heatScore(item) {
  return (item.total || 0) + (item.active || 0) * HEAT_ACTIVE_WEIGHT
}

Page({
  /**
   * 页面数据
   */
  data: {
    // 板块标签栏（含配色，active 标签走板块色实心高亮）
    tags: TAGS.map((t) => {
      const meta = t.key === 'lostfound' ? LOSTFOUND_META : getSectionMeta(t.key)
      return { key: t.key, name: t.name, navUrl: t.navUrl, color: meta.color, bgColor: meta.bgColor }
    }),
    // 当前选中的标签（高亮态）
    activeTag: 'help',
    // 板块热度榜单（已排序，最多 HOT_LIMIT 条）
    hotSections: [],
    // 板块热度加载状态
    hotLoading: true,
    // 精选内容（按板块分组，每组含 2 条最热帖）
    featured: [],
    // 精选内容加载状态
    featuredLoading: true
  },

  /**
   * 页面加载
   * 拉取板块热度（内部串联拉取精选内容）
   */
  onLoad() {
    this.loadHeat()
  },

  /**
   * 页面显示
   * 更新自定义 TabBar 选中态为发现（索引 1）
   * 节流刷新：30 秒内不重复请求，避免频繁切 Tab 时的重复加载
   */
  onShow() {
    // Skyline 异步回调 + WebView 同步返回兼容
    if (typeof this.getTabBar === 'function') {
      const result = this.getTabBar((tabBar) => {
        if (tabBar && typeof tabBar.updateSelected === 'function') {
          tabBar.updateSelected(1)
        }
      })
      if (result && typeof result.updateSelected === 'function') {
        result.updateSelected(1)
      }
    }

    const now = Date.now()
    if (!this._lastLoadTime || now - this._lastLoadTime > 30000) {
      this.loadHeat()
    }
  },

  /**
   * 加载板块热度榜单
   * 并行拉取各板块最新帖子样本，按板块聚合「帖子总数 / 本周活跃人数 / 最新动态」，按热度分排序取前 6
   * 完成后串联拉取精选内容
   */
  loadHeat() {
    this._lastLoadTime = Date.now()
    // 仅首次加载（无数据）时显示 loading，避免切 Tab 时闪烁
    if (!this.data.hotSections.length) {
      this.setData({ hotLoading: true, featuredLoading: true })
    }

    const now = Date.now()

    const tasks = BOARDS.map((board) => {
      // 组装查询参数：仅社区板块携带 section（失物招领模块帖子无板块字段）
      const params = {
        module: board.module,
        cursor: 0,
        pageSize: SAMPLE_SIZE,
        sort: 'latest'
      }
      if (board.section) params.section = board.section

      return api.post.feed(params)
        .then((res) => ({ board, res }))
        .catch((err) => {
          console.warn('[discover] 板块取样失败:', board.key, err)
          return { board, res: null }
        })
    })

    Promise.all(tasks)
      .then((results) => {
        const items = []

        results.forEach(({ board, res }) => {
          const data = (res && res.data) || {}
          const list = data.list || data.posts || []
          const total = data.total || list.length

          // 空板块不计入榜单
          if (total <= 0 && !list.length) return

          // 本周活跃人数：近 7 天有发帖的独立作者数
          const activeSet = {}
          let latest = null
          list.forEach((post) => {
            if (!latest) latest = post
            const ts = postTime(post)
            if (ts && now - ts <= WEEK_MS) {
              const k = authorKey(post)
              if (k) activeSet[k] = true
            }
          })

          const meta = board.key === 'lostfound' ? LOSTFOUND_META : getSectionMeta(board.section)
          items.push({
            key: board.key,
            name: board.name,
            color: meta.color,
            bgColor: meta.bgColor,
            navUrl: board.navUrl,
            total,
            active: Object.keys(activeSet).length,
            latestText: latest ? truncateText(latest.title || latest.content, LATEST_MAX) : '暂无新动态',
            latestTime: latest ? formatListTime(postTime(latest)) : ''
          })
        })

        // 热度排序：内容量 + 活跃度（活跃度加权），同分按帖子数降序
        items.sort((a, b) => (heatScore(b) - heatScore(a)) || (b.total - a.total))
        const hotSections = items.slice(0, HOT_LIMIT)

        this.setData({ hotSections, hotLoading: false })
        return this.loadFeatured(items)
      })
      .catch((err) => {
        console.error('[discover] 板块热度加载失败:', err)
        this.setData({ hotLoading: false, featuredLoading: false })
      })
  },

  /**
   * 加载精选内容
   * 从热度排序结果中取前若干「社区」板块，每个板块并行拉取最热帖子（sort=hot）2 条
   * @param {Array} ranked 已排序的板块统计项
   */
  loadFeatured(ranked) {
    // 精选内容只聚合社区板块（失物招领帖无 section 字段，且点击需跳模块详情，避免与帖子详情混淆）
    const tops = (ranked || [])
      .filter((item) => item.key !== 'lostfound')
      .slice(0, FEATURED_SECTION_LIMIT)

    if (!tops.length) {
      this.setData({ featured: [], featuredLoading: false })
      return Promise.resolve()
    }

    const tasks = tops.map((item) =>
      api.post.feed({
        module: 'community',
        section: item.section || item.key,
        cursor: 0,
        pageSize: FEATURED_POSTS_PER_SECTION,
        sort: 'hot'
      })
        .then((res) => ({ item, res }))
        .catch((err) => {
          console.warn('[discover] 精选内容拉取失败:', item.key, err)
          return { item, res: null }
        })
    )

    return Promise.all(tasks)
      .then((results) => {
        const featured = []

        results.forEach(({ item, res }) => {
          const data = (res && res.data) || {}
          const list = data.list || data.posts || []
          if (!list.length) return

          featured.push({
            section: item.key,
            name: item.name,
            color: item.color,
            bgColor: item.bgColor,
            posts: list.map((post) => ({
              _id: post._id,
              nickname: pickNickname(post),
              avatar: pickAvatar(post),
              timeText: formatListTime(postTime(post)),
              excerpt: truncateText(post.title || post.content, EXCERPT_MAX),
              thumb: (post.images && post.images.length) ? post.images[0] : ''
            }))
          })
        })

        this.setData({ featured, featuredLoading: false })
      })
      .catch(() => {
        this.setData({ featured: [], featuredLoading: false })
      })
  },

  /**
   * 页面跳转（统一防抖：避免快速连续点击重复打开页面）
   * @param {string} url 目标页面地址
   */
  _navTo(url) {
    if (!url || this._navPending) return
    this._navPending = true
    wx.navigateTo({
      url,
      complete: () => {
        setTimeout(() => {
          this._navPending = false
        }, NAV_DEBOUNCE_MS)
      }
    })
  },

  /**
   * 点击板块标签：更新选中高亮并跳转对应板块帖子列表 / 模块页
   */
  onTapTag(e) {
    const { key, url } = e.currentTarget.dataset
    if (key) this.setData({ activeTag: key })

    if (!checkBanBeforeNavigate()) return
    if (!url) {
      wx.showToast({ title: '该板块即将上线', icon: 'none' })
      return
    }
    this._navTo(url)
  },

  /**
   * 点击板块热度榜单项：跳转对应板块 / 模块
   */
  onTapHotSection(e) {
    const { url } = e.currentTarget.dataset
    if (!checkBanBeforeNavigate()) return
    this._navTo(url)
  },

  /**
   * 点击精选帖子：进入帖子详情
   */
  onTapPost(e) {
    const postId = e.currentTarget.dataset.postid
    if (!postId) return
    if (!checkBanBeforeNavigate()) return
    this._navTo(`/pages/post/detail/index?postId=${postId}`)
  }
})
