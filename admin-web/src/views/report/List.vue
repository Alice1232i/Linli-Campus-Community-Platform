<template>
  <div class="page-container">
    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <!-- 状态筛选 -->
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px">
            <el-option label="待处理" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="已处理" value="resolved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
        </el-form-item>

        <!-- 原因筛选 -->
        <el-form-item label="原因">
          <el-select v-model="query.reason" placeholder="全部原因" clearable style="width: 140px">
            <el-option label="垃圾广告" value="spam" />
            <el-option label="辱骂攻击" value="abuse" />
            <el-option label="色情低俗" value="porn" />
            <el-option label="欺诈" value="fraud" />
            <el-option label="隐私侵犯" value="privacy" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>

        <!-- 目标类型筛选 -->
        <el-form-item label="目标类型">
          <el-select v-model="query.targetType" placeholder="全部类型" clearable style="width: 140px">
            <el-option label="帖子" value="post" />
            <el-option label="评论" value="comment" />
            <el-option label="用户" value="user" />
          </el-select>
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
      <!-- 批量操作工具栏 -->
      <div class="batch-bar" v-if="selectedIds.length > 0">
        <span class="batch-info">已选择 {{ selectedIds.length }} 条</span>
        <el-button type="danger" size="small" @click="handleBatchDelete">批量删除</el-button>
        <el-button size="small" @click="clearSelection">取消选择</el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="tableData"
        stripe
        border
        style="width: 100%"
        @selection-change="handleSelectionChange"
        ref="tableRef"
      >
        <el-table-column type="selection" width="50" />
        <el-table-column prop="reporter" label="举报人" min-width="120" show-overflow-tooltip />
        <el-table-column prop="targetType" label="目标类型" width="100" align="center">
          <template #default="{ row }">{{ targetTypeText(row.targetType) }}</template>
        </el-table-column>
        <el-table-column label="目标ID" width="160">
          <template #default="{ row }">
            <el-link
              v-if="row.targetType === 'post' && row.targetId"
              type="primary"
              :underline="false"
              @click="goPostDetail(row.targetId)"
            >{{ row.targetId }}</el-link>
            <span v-else>{{ row.targetId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" width="120" align="center">
          <template #default="{ row }">{{ reasonText(row.reason) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <StatusTag type="report" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column prop="handler" label="处理人" width="120" align="center">
          <template #default="{ row }">{{ row.handler || '-' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="180" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row.id)">查看详情</el-button>
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
 * 举报列表
 * - 筛选栏：状态、原因、目标类型、时间范围
 * - 表格列：举报人、目标类型、目标ID、原因、状态、处理人、创建时间、操作
 * - 操作：查看详情（跳转详情页处理举报）
 */
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getReports, batchDeleteReports } from '@/api/report'
import Pagination from '@/components/Pagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp } from '@/utils/format'

const router = useRouter()

// 加载状态
const loading = ref(false)
// 表格数据
const tableData = ref([])
// 总条数
const total = ref(0)
// 时间范围
const dateRange = ref([])
// 多选选中的举报 ID 数组
const selectedIds = ref([])
// 表格 ref（用于手动清空选择）
const tableRef = ref()

// 查询参数
const query = reactive({
  page: 1,
  pageSize: 20,
  status: '',
  reason: '',
  targetType: '',
  startDate: '',
  endDate: '',
  sortOrder: 'desc'
})

// 原因映射
const REASON_MAP = {
  spam: '垃圾广告',
  abuse: '辱骂攻击',
  porn: '色情低俗',
  fraud: '欺诈',
  privacy: '隐私侵犯',
  other: '其他'
}

// 目标类型映射
const TARGET_TYPE_MAP = {
  post: '帖子',
  comment: '评论',
  user: '用户'
}

const reasonText = (val) => REASON_MAP[val] || val || '-'
const targetTypeText = (val) => TARGET_TYPE_MAP[val] || val || '-'

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
    const res = await getReports(query)
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
  query.reason = ''
  query.targetType = ''
  query.startDate = ''
  query.endDate = ''
  query.sortOrder = 'desc'
  dateRange.value = []
  query.page = 1
  loadData()
}

// 跳转详情
const goDetail = (id) => {
  router.push(`/reports/${id}`)
}

// 跳转帖子详情（从举报列表跳到帖子管理详情页，查看被举报的具体帖子）
const goPostDetail = (postId) => {
  if (!postId) {
    ElMessage.warning('目标帖子不存在')
    return
  }
  router.push(`/posts/${postId}`)
}

// 多选变化
const handleSelectionChange = (rows) => {
  selectedIds.value = rows.map((r) => r.id)
}

// 清空选择
const clearSelection = () => {
  tableRef.value?.clearSelection()
}

// 批量删除
const handleBatchDelete = () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先选择要删除的举报')
    return
  }
  ElMessageBox.confirm(
    `确定要删除选中的 ${selectedIds.value.length} 条举报吗？此操作不可恢复。`,
    '批量删除确认',
    { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }
  )
    .then(async () => {
      try {
        const res = await batchDeleteReports(selectedIds.value)
        ElMessage.success(`成功删除 ${res.deleted} 条举报`)
        clearSelection()
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

.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background-color: #fdf6ec;
  border-radius: 4px;

  .batch-info {
    font-size: 14px;
    color: #e6a23c;
    font-weight: 500;
  }
}
</style>
