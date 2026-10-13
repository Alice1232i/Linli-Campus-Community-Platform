// components/image-uploader/image-uploader.js
// 图片上传组件
// 提供图片选择、预览、删除能力
// 选择后通过 change 事件把本地临时路径数组抛给父组件，
// 实际上传由父组件在提交时统一调用 utils/upload.uploadImages 完成

const { ensurePrivacy, isUserCancel, showChooseFailDialog } = require('../../utils/privacy')

Component({
  /**
   * 组件属性
   */
  properties: {
    // 当前图片列表（本地临时路径）
    images: {
      type: Array,
      value: []
    },
    // 最大数量
    max: {
      type: Number,
      value: 9
    }
  },

  methods: {
    /**
     * 点击添加图片
     */
    onChoose() {
      const remain = this.data.max - this.data.images.length
      if (remain <= 0) {
        wx.showToast({ title: `最多上传 ${this.data.max} 张`, icon: 'none' })
        return
      }
      // 相册/相机属隐私接口：必须先取得隐私授权，否则 chooseMedia 会失败
      ensurePrivacy().then((granted) => {
        if (!granted) {
          wx.showToast({ title: '需同意隐私政策后才能选择图片', icon: 'none' })
          return
        }
        wx.chooseMedia({
          count: remain,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: (res) => {
            const newPaths = res.tempFiles.map(f => f.tempFilePath)
            const next = this.data.images.concat(newPaths)
            this.setData({ images: next })
            // 抛出最新图片列表
            this.triggerEvent('change', { images: next })
          },
          fail: (err) => {
            // 用户主动取消：静默；其余失败必须提示，否则表现为「点了没反应」
            if (isUserCancel(err)) return
            console.error('[image-uploader] 选择图片失败:', err)
            showChooseFailDialog(err)
          }
        })
      })
    },

    /**
     * 点击预览图片
     */
    onPreview(e) {
      const { src } = e.currentTarget.dataset
      wx.previewImage({
        current: src,
        urls: this.data.images
      })
    },

    /**
     * 删除图片
     */
    onRemove(e) {
      const { index } = e.currentTarget.dataset
      const next = this.data.images.slice()
      next.splice(index, 1)
      this.setData({ images: next })
      this.triggerEvent('change', { images: next })
    }
  }
})
