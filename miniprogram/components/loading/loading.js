// components/loading/loading.js
// 加载组件
// 用于列表加载中、提交中等场景的统一展示

Component({
  /**
   * 组件属性
   */
  properties: {
    // 提示文案
    text: {
      type: String,
      value: '加载中...'
    },
    // 是否块级布局（true 时占满一行，false 时内联）
    block: {
      type: Boolean,
      value: true
    }
  }
})
