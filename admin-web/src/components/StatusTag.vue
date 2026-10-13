<template>
  <!-- 状态标签 -->
  <el-tag :type="tagType" size="small">{{ label }}</el-tag>
</template>

<script setup>
/**
 * 状态标签组件
 * 根据 type + value 映射到对应的 Element Plus tag type 和中文标签
 */
import { computed } from 'vue'
import { ElTag } from 'element-plus'

const props = defineProps({
  // 状态类型：post / user / report
  type: {
    type: String,
    required: true
  },
  // 状态值
  value: {
    type: String,
    default: ''
  }
})

// 各类型状态映射表：key -> { type: el-tag type, label: 中文标签 }
const STATUS_MAP = {
  // 帖子状态
  post: {
    normal: { type: 'success', label: '正常' },
    hidden: { type: 'warning', label: '隐藏' },
    deleted: { type: 'danger', label: '已删除' },
    reviewing: { type: 'info', label: '审核中' }
  },
  // 用户状态
  user: {
    active: { type: 'success', label: '正常' },
    muted: { type: 'warning', label: '禁言' },
    banned: { type: 'danger', label: '封禁' }
  },
  // 举报状态
  report: {
    pending: { type: 'warning', label: '待处理' },
    processing: { type: 'info', label: '处理中' },
    resolved: { type: 'success', label: '已处理' },
    rejected: { type: 'info', label: '已驳回' }
  }
}

// 当前状态对应的 tag type
const tagType = computed(() => {
  const map = STATUS_MAP[props.type] || {}
  return (map[props.value] && map[props.value].type) || 'info'
})

// 当前状态对应的中文标签
const label = computed(() => {
  const map = STATUS_MAP[props.type] || {}
  return (map[props.value] && map[props.value].label) || props.value || '未知'
})
</script>
