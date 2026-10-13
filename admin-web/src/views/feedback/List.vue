<template>
  <div class="page-container">
    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <!-- 状态筛选 -->
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px">
            <el-option label="待处理" value="pending" />
            <el-option label="已处理" value="handled" />
          </el-select>
        </el-form-item>

        <!-- 类型筛选 -->
        <el-form-item label="类型">
          <el-select v-model="query.type" placeholder="全部类型" clearable style="width: 140px">
            <el-option label="功能建议" value="suggestion" />
            <el-option label="问题反馈" value="bug" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>

        <!-- 时间范围 -->
        <el-form-item label="提交时间">
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
        <el-table-column prop="reporter" label="提交人" min-width="110" show-overflow-tooltip />
        <el-table-column prop="typeText" label="类型" width="100" align="center" />
        <el-table-column label="反馈内容" min-width="240">
          <template #default="{ row }">
            <span class="content-cell">{{ row.content }}</span>
          </template>
        </el-table-column>
        <el-table-column label="联系方式" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contact || '-' }}</template>
        </el-table-column>
        <el-table-column label="版本" width="90" align="center">
          <template #default="{ row }">{{ row.appVersion || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'handled'" type="success" size="small">已处理</el-tag>
            <el-tag v-else type="warning" size="small">待处理</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'handled'"
              link
              type="primary"
              @click="openHandle(row)"
            >标记处理</el-button>
            <span v-else class="handled-by">{{ row.handledBy || '已处理' }}</span>
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

    <!-- 标记处理弹窗 -->
    <el-dialog v-model="handleVisible" title="标记为已处理" width="520px" :close-on-click-modal="false">
      <div class="handle-content" v-if="currentRow">
        <div class="handle-origin">
          <div class="handle-origin__meta">
            <span>{{ currentRow.reporter }}</span>
            <span class="handle-origin__time">{{ formatTimestamp(currentRow.created_at) }}</span>
          </div>
          <div class="handle-origin__text">{{ currentRow.content }}</div>
        </div>
        <el-input
          v-model="handleForm.reply"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="官方回复（选填，将展示到该用户小程序的「我的反馈」中）"
        />
      </div>
      <template #footer>
        <el-button @click="handleVisible = false">取消</el-button>
        <el-button type="primary" :loading="handling" @click="submitHandle">确认处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 意见箱列表
 * - 数据来源：小程序「意见箱」（feedback 云函数写入 feedbacks 集合）
 * - 筛选栏：状态、类型、时间范围
 * - 表格列：提交人、类型、内容、联系方式、版本、状态、提交时间、操作
 * - 操作：标记处理（可附官方回复，回显到小程序「我的反馈」）、批量删除
 */
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getFeedbacks, handleFeedback, batchDeleteFeedbacks } from '@/api/feedback'
import Pagination from '@/components/Pagination.vue'
import { formatTimestamp } from '@/utils/format'

// 加载状态
const loading = ref(false)
// 表格数据
const tableData = ref([])
// 总条数
const total = ref(0)
// 时间范围
const dateRange = ref([])
// 多选选中的反馈 ID 数组
const selectedIds = ref([])
// 表格 ref（用于手动清空选择）
const tableRef = ref()

// 查询参数
const query = reactive({
  page: 1,
  pageSize: 20,
  status: '',
  type: '',
  startDate: '',
  endDate: '',
  sortOrder: 'desc'
})

// 标记处理弹窗
const handleVisible = ref(false)
const handling = ref(false)
const currentRow = ref(null)
const handleForm = reactive({ reply: '' })

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
    const res = await getFeedbacks(query)
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
  query.type = ''
  query.startDate = ''
  query.endDate = ''
  query.sortOrder = 'desc'
  dateRange.value = []
  query.page = 1
  loadData()
}

// 打开标记处理弹窗
const openHandle = (row) => {
  currentRow.value = row
  handleForm.reply = ''
  handleVisible.value = true
}

// 提交标记处理
const submitHandle = async () => {
  if (!currentRow.value) return
  handling.value = true
  try {
    await handleFeedback(currentRow.value.id, { reply: handleForm.reply })
    ElMessage.success('已标记为已处理')
    handleVisible.value = false
    loadData(true)
  } catch (err) {
    console.error(err)
  } finally {
    handling.value = false
  }
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
    ElMessage.warning('请先选择要删除的反馈')
    return
  }
  ElMessageBox.confirm(
    `确定要删除选中的 ${selectedIds.value.length} 条反馈吗？此操作不可恢复。`,
    '批量删除确认',
    { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }
  )
    .then(async () => {
      try {
        const res = await batchDeleteFeedbacks(selectedIds.value)
        ElMessage.success(`成功删除 ${res.deleted} 条反馈`)
        clearSelection()
        loadData()
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

onMounted(loadData)

// 30 秒静默轮询：页面停留时同步小程序端新提交的反馈
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

.content-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.handled-by {
  font-size: 12px;
  color: #909399;
}

.handle-origin {
  padding: 10px 12px;
  margin-bottom: 12px;
  background-color: #f5f7fa;
  border-radius: 4px;

  .handle-origin__meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 12px;
    color: #909399;
  }

  .handle-origin__text {
    font-size: 14px;
    line-height: 1.6;
    color: #303133;
    word-break: break-all;
  }
}
</style>
