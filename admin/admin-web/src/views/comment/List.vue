<template>
  <div class="page-container">
    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <!-- 状态筛选 -->
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px">
            <el-option label="正常" value="normal" />
            <el-option label="隐藏" value="hidden" />
            <el-option label="已删除" value="deleted" />
          </el-select>
        </el-form-item>

        <!-- 关键词搜索 -->
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            placeholder="评论内容关键词"
            clearable
            style="width: 220px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>

        <!-- 时间范围 -->
        <el-form-item label="创建时间">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 240px"
            @change="handleDateChange"
          />
        </el-form-item>

        <!-- 排序方式 -->
        <el-form-item label="排序">
          <el-select v-model="query.sortOrder" style="width: 120px" @change="handleSearch">
            <el-option label="最新在前" value="desc" />
            <el-option label="最早在前" value="asc" />
          </el-select>
        </el-form-item>

        <!-- 操作按钮 -->
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 表格 -->
    <el-card shadow="never" class="table-card">
      <el-table v-loading="loading" :data="tableData" stripe border style="width: 100%">
        <el-table-column label="内容" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ truncate(row.content, 40) }}</template>
        </el-table-column>
        <el-table-column prop="postId" label="所属帖子ID" width="140" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <StatusTag type="post" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <Pagination
        :total="total"
        :page="query.page"
        :page-size="query.pageSize"
        @update:page="handlePageChange"
        @update:page-size="handleSizeChange"
        @change="loadData"
      />
    </el-card>
  </div>
</template>

<script setup>
/**
 * 评论列表
 * - 筛选栏：状态、关键词、时间范围
 * - 表格列：内容（截断）、所属帖子ID、状态、创建时间、操作
 * - 操作：删除
 */
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getComments, deleteComment } from '@/api/comment'
import Pagination from '@/components/Pagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp, truncate } from '@/utils/format'

// 加载状态
const loading = ref(false)
// 表格数据
const tableData = ref([])
// 总条数
const total = ref(0)
// 时间范围
const dateRange = ref([])

// 查询参数
const query = reactive({
  page: 1,
  pageSize: 20,
  status: '',
  keyword: '',
  startDate: '',
  endDate: '',
  sortOrder: 'desc'
})

// 时间范围变化处理
const handleDateChange = (val) => {
  if (val && val.length === 2) {
    query.startDate = val[0]
    query.endDate = val[1]
  } else {
    query.startDate = ''
    query.endDate = ''
  }
}

// 加载列表数据
const loadData = async (silent = false) => {
  if (!silent) loading.value = true
  try {
    const res = await getComments(query)
    // 删除最后一页最后一条后页码回退：当前页无数据且 page>1 时回退一页重拉
    if ((!res.list || res.list.length === 0) && query.page > 1) {
      query.page = query.page - 1
      await loadData(silent)
      return
    }
    tableData.value = res.list || []
    total.value = res.total || 0
  } catch (err) {
    console.error(err)
  } finally {
    if (!silent) loading.value = false
  }
}

// 分页变化
const handlePageChange = (page) => { query.page = page }
const handleSizeChange = (size) => { query.pageSize = size; query.page = 1 }

// 搜索
const handleSearch = () => { query.page = 1; loadData() }

// 重置筛选
const handleReset = () => {
  query.status = ''
  query.keyword = ''
  query.startDate = ''
  query.endDate = ''
  query.sortOrder = 'desc'
  dateRange.value = []
  query.page = 1
  loadData()
}

// 删除评论
const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该评论吗？', '提示', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
    .then(async () => {
      try {
        await deleteComment(row.id)
        ElMessage.success('删除成功')
        loadData()
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

onMounted(loadData)

// 30 秒静默轮询：页面停留时同步小程序端编辑/置顶/加精等数据变化
let pollTimer = null
onMounted(() => {
  pollTimer = setInterval(() => { loadData(true) }, 30000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style lang="scss" scoped>
.page-container {
  .filter-card {
    margin-bottom: 16px;
  }

  .table-card {
    .el-table {
      margin-bottom: 16px;
    }
  }
}
</style>
