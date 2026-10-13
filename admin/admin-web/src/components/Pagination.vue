<template>
  <!-- 通用分页组件 -->
  <div class="pagination-wrapper">
    <el-pagination
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="pageSizes"
      :total="total"
      layout="total, sizes, prev, pager, next, jumper"
      @update:current-page="handlePageChange"
      @update:page-size="handleSizeChange"
    />
  </div>
</template>

<script setup>
/**
 * 通用分页组件
 * 基于 el-pagination 封装，支持 v-model:page 和 v-model:pageSize
 */
import { ElPagination } from 'element-plus'

const props = defineProps({
  // 总条数
  total: {
    type: Number,
    default: 0
  },
  // 当前页
  page: {
    type: Number,
    default: 1
  },
  // 每页条数
  pageSize: {
    type: Number,
    default: 10
  }
})

const emit = defineEmits(['update:page', 'update:pageSize', 'change'])

// 可选的每页条数
const pageSizes = [10, 20, 50, 100]

// 页码变化
const handlePageChange = (val) => {
  emit('update:page', val)
  emit('change')
}

// 每页条数变化
const handleSizeChange = (val) => {
  emit('update:pageSize', val)
  emit('update:page', 1)
  emit('change')
}
</script>

<style lang="scss" scoped>
.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
