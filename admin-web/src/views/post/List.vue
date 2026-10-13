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
            <el-option label="审核中" value="reviewing" />
          </el-select>
        </el-form-item>

        <!-- 模块筛选 -->
        <el-form-item label="模块">
          <el-select v-model="query.module" placeholder="全部模块" clearable style="width: 140px">
            <el-option label="校园" value="campus" />
            <el-option label="学习" value="study" />
            <el-option label="生活" value="life" />
            <el-option label="活动" value="activity" />
          </el-select>
        </el-form-item>

        <!-- 关键词搜索 -->
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            placeholder="标题/作者关键词"
            clearable
            style="width: 200px"
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
        <el-table-column label="标题" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="goDetail(row.id)">{{ row.title || '(无标题)' }}</el-link>
          </template>
        </el-table-column>
        <el-table-column label="作者" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.author?.nickname || row.authorId || '-' }}</template>
        </el-table-column>
        <el-table-column prop="section" label="板块" width="100" />
        <el-table-column prop="like_count" label="点赞数" width="80" align="center" />
        <el-table-column prop="comment_count" label="评论数" width="80" align="center" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <StatusTag type="post" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="置顶" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_top" type="danger" size="small">置顶</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="加精" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_essence" type="warning" size="small">精华</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row.id)">查看详情</el-button>
            <el-button link type="warning" @click="handleToggleTop(row)">
              {{ row.is_top ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button link type="success" @click="handleToggleEssence(row)">
              {{ row.is_essence ? '取消加精' : '加精' }}
            </el-button>
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
 * 帖子列表
 * - 筛选栏：状态、模块、关键词、时间范围
 * - 表格列：标题、作者、板块、点赞数、评论数、状态、置顶、加精、创建时间、操作
 * - 操作：查看详情、置顶/取消置顶、加精/取消加精、删除
 */
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPosts, toggleTop, toggleEssence, deletePost } from '@/api/post'
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

// 查询参数
const query = reactive({
  page: 1,
  pageSize: 20,
  status: '',
  module: '',
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
    const res = await getPosts(query)
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
  query.module = ''
  query.keyword = ''
  query.startDate = ''
  query.endDate = ''
  query.sortOrder = 'desc'
  dateRange.value = []
  query.page = 1
  loadData()
}

// 跳转详情
const goDetail = (id) => {
  router.push(`/posts/${id}`)
}

// 置顶 / 取消置顶
const handleToggleTop = async (row) => {
  try {
    await toggleTop(row.id, !row.is_top)
    ElMessage.success(row.is_top ? '已取消置顶' : '已置顶')
    loadData()
  } catch (err) {
    console.error(err)
  }
}

// 加精 / 取消加精
const handleToggleEssence = async (row) => {
  try {
    await toggleEssence(row.id, !row.is_essence)
    ElMessage.success(row.is_essence ? '已取消加精' : '已加精')
    loadData()
  } catch (err) {
    console.error(err)
  }
}

// 删除帖子
const handleDelete = (row) => {
  ElMessageBox.confirm(`确定要删除帖子「${row.title}」吗？`, '提示', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
    .then(async () => {
      try {
        await deletePost(row.id)
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
