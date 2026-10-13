// components/empty-state/empty-state.js
// 空状态组件
// 用于列表无数据、无评论等空场景的统一展示

Component({
  /**
   * 组件属性
   */
  properties: {
    // 提示文案
    text: {
      type: String,
      value: '暂无内容'
    },
    // 副标题
    sub: {
      type: String,
      value: ''
    },
    // 图标路径（不传则使用默认插画占位）
    icon: {
      type: String,
      value: '/images/icons/empty.png'
    }
  }
})
