// custom-tab-bar/index.js
// 自定义底部 TabBar 组件
// 注意：入口文件必须位于代码根目录 miniprogram/custom-tab-bar/ 下，框架按固定路径自动注入
// 5 个 Tab：首页 / 发现 / 发布(中间凸起) / 消息 / 我的
// 消息 Tab 支持未读角标：数字（>0 时显示）+ 红点

const eventBus = require('../store/eventBus.js')
const badgeStore = require('../store/badge.js')
const { isLoggedIn } = require('../utils/auth')
const { ensurePrivacy, isUserCancel, showChooseFailDialog } = require('../utils/privacy')

Component({
  /**
   * 组件初始数据
   * selected：当前选中 Tab 索引（0~4）
   * list：5 个 Tab 配置，iconPath/selectedIconPath 暂用同一图标
   *   - 中间"发布"项 isCenter=true，采用凸起圆形大按钮样式
   * unreadCount：消息未读总数（0 时不显示角标，1-99 显示数字，>99 显示 99+）
   */
  data: {
    selected: 0,
    // 消息未读数，0 表示无未读
    unreadCount: 0,
    list: [
      {
        pagePath: '/pages/feed/index',
        text: '首页',
        iconPath: '/images/icons/home.png',
        isCenter: false
      },
      {
        pagePath: '/pages/discover/index',
        text: '发现',
        iconPath: '/images/icons/search.png',
        isCenter: false
      },
      {
        pagePath: '/pages/publish/index',
        text: '发布',
        iconPath: '/images/icons/edit.png',
        isCenter: true // 中间凸起按钮
      },
      {
        pagePath: '/pages/message/index',
        text: '消息',
        iconPath: '/images/icons/chat_dots.png',
        isCenter: false
      },
      {
        pagePath: '/pages/profile/index',
        text: '我的',
        iconPath: '/images/icons/user.png',
        isCenter: false
      }
    ]
  },

  lifetimes: {
    /**
     * 组件 attached 时：
     * 1. 读取当前角标状态初始化显示
     * 2. 监听 badgeUpdate 事件，实时更新角标
     */
    attached() {
      // 同步读取当前角标状态
      const badge = badgeStore.getBadge()
      this.setData({ unreadCount: badge.unreadCount })
      // 监听角标更新事件
      this._offBadge = eventBus.on('badgeUpdate', (data) => {
        this.setData({ unreadCount: data.unreadCount || 0 })
      })
    },

    /**
     * 组件 detached 时解绑事件监听
     */
    detached() {
      if (typeof this._offBadge === 'function') {
        this._offBadge()
        this._offBadge = null
      }
    }
  },

  methods: {
    /**
     * 中央「发布」按钮：唤起发布方式选择（相册 / 拍照 / 写文字）
     * 使用微信原生 ActionSheet：自定义组件内无法使用 app.wxss 全局样式，
     * 手搓弹窗会丢样式且点击命中受限，原生选择器最稳
     */
    onTapCenter() {
      if (!isLoggedIn()) {
        wx.navigateTo({ url: '/pages/user/login/index' })
        return
      }
      wx.showActionSheet({
        itemList: ['从相册选择', '拍照', '写文字'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this._chooseImages(['album'])
          } else if (res.tapIndex === 1) {
            this._chooseImages(['camera'])
          } else if (res.tapIndex === 2) {
            this._goPublish(null)
          }
        },
        fail: () => { /* 用户取消：静默 */ }
      })
    },

    /**
     * 唤起系统相册/相机选择图片，选完带图进入发帖页
     * @param {Array} sourceType ['album'] | ['camera']
     */
    _chooseImages(sourceType) {
      // 相册/相机属隐私接口：必须先取得隐私授权，否则 chooseMedia 会失败
      ensurePrivacy().then((granted) => {
        if (!granted) {
          wx.showToast({ title: '需同意隐私政策后才能选择图片', icon: 'none' })
          return
        }
        // 原生 UI 不能紧挨着连续调用：ActionSheet / 隐私弹窗刚收起就拉起相册相机，
        // iOS 上会出现选择器不弹出或直接失败，这里留 300ms 间隔
        setTimeout(() => {
          wx.chooseMedia({
            count: 9,
            mediaType: ['image'],
            sourceType,
            sizeType: ['compressed'],
            success: (res) => {
              const paths = (res.tempFiles || [])
                .map((f) => f.tempFilePath)
                .filter(Boolean)
              this._goPublish(paths)
            },
            fail: (err) => {
              // 用户主动取消：静默；其余失败必须提示，否则表现为「点了没反应」
              if (isUserCancel(err)) return
              console.error('[tabbar] 选择图片失败:', err)
              showChooseFailDialog(err)
            }
          })
        }, 300)
      })
    },

    /**
     * 进入发帖页
     * 图片为本地临时路径，经 globalData 传递（避免 URL 长度限制），
     * 发帖页 onLoad 消费后立即清空，防止二次进入串数据
     * @param {Array|null} paths 已选图片临时路径，null 表示纯文字
     */
    _goPublish(paths) {
      const app = getApp()
      if (app) {
        app.globalData = app.globalData || {}
        app.globalData.pendingImages = (paths && paths.length) ? paths : null
      }
      wx.navigateTo({ url: '/pages/post/publish/index' })
    },

    /**
     * 切换 Tab
     * 点击 Tab 项时调用 wx.switchTab 跳转到对应页面
     * @param {Object} e 事件对象，dataset.index 为目标 Tab 索引
     */
    switchTab(e) {
      const index = e.currentTarget.dataset.index
      const item = this.data.list[index]
      if (!item) return

      // 先更新选中态，保证响应即时
      this.setData({ selected: index })

      // 跳转到目标 Tab 页
      wx.switchTab({
        url: item.pagePath
      })
    },

    /**
     * 更新选中态
     * 由各 Tab 页 onShow 主动调用，确保切回页面时高亮正确
     * @param {Number} index 当前页对应的 Tab 索引
     */
    updateSelected(index) {
      if (this.data.selected !== index) {
        this.setData({ selected: index })
      }
    }
  }
})
