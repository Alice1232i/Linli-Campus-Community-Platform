// components/section-tabs/section-tabs.js
// 板块切换组件
// 横向滚动的板块标签条，用于信息流顶部分区切换

Component({
  /**
   * 组件属性
   */
  properties: {
    // 板块列表：[{ key, name }]
    sections: {
      type: Array,
      value: []
    },
    // 当前选中的板块 key
    current: {
      type: String,
      value: '',
      observer: '_currentChange'
    }
  },

  /**
   * 组件初始数据
   */
  data: {
    // 当前选中 key 的视图同步副本（供 wxml 判断高亮）
    activeKey: ''
  },

  lifetimes: {
    attached() {
      // 初始化时同步一次 activeKey
      this.setData({ activeKey: this.data.current })
    }
  },

  methods: {
    /**
     * current 变化时同步 activeKey
     */
    _currentChange(val) {
      this.setData({ activeKey: val })
    },

    /**
     * 点击板块标签
     */
    onTapItem(e) {
      const { key } = e.currentTarget.dataset
      if (key === this.data.activeKey) return
      this.setData({ activeKey: key })
      // 向父组件派发 change 事件，携带板块 key
      this.triggerEvent('change', { key })
    }
  }
})
