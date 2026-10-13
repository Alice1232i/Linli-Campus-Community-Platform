// components/feed-tabs/feed-tabs.js
// 内容排序 Tab（下划线风格）：推荐 / 最新 / 热门 / 同校
// 4 项等宽铺满，CSS Grid 四等分；下划线用 transform: scaleX 生长动画

Component({
  /**
   * 组件属性
   */
  properties: {
    // Tab 列表：[{ key, name }]
    tabs: {
      type: Array,
      value: []
    },
    // 当前选中 key
    active: {
      type: String,
      value: '',
      observer: '_activeChange'
    }
  },

  /**
   * 组件初始数据
   */
  data: {
    activeKey: ''
  },

  /**
   * 生命周期
   */
  lifetimes: {
    attached() {
      this.setData({ activeKey: this.data.active })
    }
  },

  /**
   * 组件方法
   */
  methods: {
    /**
     * active 属性变化时同步内部状态
     */
    _activeChange(val) {
      this.setData({ activeKey: val })
    },

    /**
     * 点击 Tab 项
     */
    onTapTab(e) {
      const { key } = e.currentTarget.dataset
      if (key === this.data.activeKey) return
      this.setData({ activeKey: key })
      this.triggerEvent('change', { key })
    }
  }
})
