// pages/publish/index.js
// 发布页 - 发布中心
// 提供发布选项：图文帖子 / 发布招领
// 点击对应选项跳转至发布页

// 发布选项（跑腿模块已整体下架，2026-10-11 移除发布入口与相关页面）
const ALL_PUBLISH_OPTIONS = [
  {
    key: 'post',
    name: '图文帖子',
    desc: '分享校园生活',
    icon: '/images/icons/edit.png',
    color: '#4A90D9',
    url: '/pages/post/publish/index'
  },
  {
    key: 'lostfound',
    name: '发布招领',
    desc: '失物招领 / 寻物',
    icon: '/images/icons/clipboard.png',
    color: '#6BCF7F',
    url: '/pages/lostfound/publish/index'
  }
]

Page({
  /**
   * 页面数据
   */
  data: {
    // 发布选项列表
    publishOptions: ALL_PUBLISH_OPTIONS
  },

  /**
   * 页面显示
   * 更新自定义 TabBar 选中态为发布（索引 2）
   */
  onShow() {
    // Skyline 异步回调 + WebView 同步返回兼容
    if (typeof this.getTabBar === 'function') {
      const result = this.getTabBar((tabBar) => {
        if (tabBar && typeof tabBar.updateSelected === 'function') {
          tabBar.updateSelected(2)
        }
      })
      if (result && typeof result.updateSelected === 'function') {
        result.updateSelected(2)
      }
    }
  },

  /**
   * 点击发布选项
   * 跳转对应发布页
   */
  onTapOption(e) {
    const { url } = e.currentTarget.dataset
    if (!url) {
      wx.showToast({ title: '功能即将上线', icon: 'none' })
      return
    }
    wx.navigateTo({
      url,
      fail: () => {
        wx.showToast({ title: '功能即将上线', icon: 'none' })
      }
    })
  }
})
