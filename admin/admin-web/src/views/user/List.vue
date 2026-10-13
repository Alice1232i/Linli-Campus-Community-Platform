<template>
  <div class="page-container">
    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <!-- 状态筛选 -->
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px">
            <el-option label="正常" value="active" />
            <el-option label="禁言" value="muted" />
            <el-option label="封禁" value="banned" />
          </el-select>
        </el-form-item>

        <!-- 角色筛选 -->
        <el-form-item label="角色">
          <el-select v-model="query.role" placeholder="全部角色" clearable style="width: 140px">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
            <el-option label="操作员" value="operator" />
            <el-option label="商家" value="merchant" />
          </el-select>
        </el-form-item>

        <!-- 关键词搜索（昵称） -->
        <el-form-item label="昵称">
          <el-input
            v-model="query.keyword"
            placeholder="请输入昵称"
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
        <el-table-column label="头像/昵称" min-width="180">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="36" :src="row.avatar" />
              <span class="nickname">{{ row.nickname }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="openid" label="openid" min-width="200" show-overflow-tooltip />
        <el-table-column label="角色" width="120" align="center">
          <template #default="{ row }">{{ formatRole(row.role) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <StatusTag type="user" :value="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="处罚到期" width="180" align="center">
          <template #default="{ row }">
            <span v-if="row.status === 'active'" class="expire-normal">-</span>
            <div v-else class="expire-info">
              <div>{{ formatBanExpire(row.status === 'banned' ? row.ban_expire : row.mute_expire, row.status) }}</div>
              <div class="remaining">{{ formatRemainingTime(row.status === 'banned' ? row.ban_expire : row.mute_expire) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="post_count" label="帖子数" width="90" align="center" />
        <el-table-column prop="follower_count" label="粉丝数" width="90" align="center" />
        <el-table-column label="创建时间" width="180" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row.id)">详情</el-button>
            <!-- 正常用户：可禁言、可封禁 -->
            <template v-if="row.status === 'active'">
              <el-button link type="warning" @click="openPenaltyDialog(row, 'muted')">禁言</el-button>
              <el-button link type="danger" @click="openPenaltyDialog(row, 'banned')">封禁</el-button>
            </template>
            <!-- 禁言/封禁用户：可解除、可延长 -->
            <template v-else>
              <el-button link type="success" @click="handleUnban(row)">解除</el-button>
              <el-button link type="warning" @click="openPenaltyDialog(row, row.status)">延长</el-button>
            </template>
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

    <!-- 禁言/封禁对话框 -->
    <el-dialog
      v-model="penaltyDialog.visible"
      :title="penaltyDialogTitle"
      width="440px"
      @close="closePenaltyDialog"
    >
      <el-form label-width="100px">
        <el-form-item label="目标用户">
          <span>{{ penaltyDialog.userNickname }}</span>
        </el-form-item>
        <el-form-item label="处罚类型">
          <el-tag :type="penaltyDialog.status === 'banned' ? 'danger' : 'warning'" size="small">
            {{ penaltyDialog.status === 'banned' ? '封禁' : '禁言' }}
          </el-tag>
        </el-form-item>
        <el-form-item label="处罚时长">
          <el-radio-group v-model="penaltyDialog.durationType">
            <el-radio :value="1">1天</el-radio>
            <el-radio :value="3">3天</el-radio>
            <el-radio :value="7">7天</el-radio>
            <el-radio :value="30">30天</el-radio>
            <el-radio :value="0">永久</el-radio>
            <el-radio :value="-1">自定义</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="penaltyDialog.durationType === -1" label="自定义天数">
          <el-input-number
            v-model="penaltyDialog.customDays"
            :min="1"
            :max="3650"
            placeholder="输入天数"
            style="width: 200px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closePenaltyDialog">取消</el-button>
        <el-button type="primary" :loading="penaltyDialog.loading" @click="confirmPenalty">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 用户列表
 * - 筛选栏：状态、角色、昵称关键词、时间范围
 * - 表格列：头像+昵称、openid、角色、状态、处罚到期、帖子数、粉丝数、创建时间、操作
 * - 操作：查看详情、禁言（带时长）、封禁（带时长）、解除、延长、删除
 */
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUsers, updateUserStatus, unbanUser, deleteUser } from '@/api/user'
import Pagination from '@/components/Pagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp, formatRole, formatBanExpire, formatRemainingTime } from '@/utils/format'

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
  role: '',
  keyword: '',
  startDate: '',
  endDate: '',
  sortOrder: 'desc'
})

// 禁言/封禁对话框状态
const penaltyDialog = reactive({
  visible: false,
  loading: false,
  userId: '',
  userNickname: '',
  status: 'muted',     // muted 或 banned
  isExtend: false,     // 是否为延长操作
  durationType: 1,     // 1/3/7/30/0(永久)/-1(自定义)
  customDays: 1
})

// 对话框标题
const penaltyDialogTitle = computed(() => {
  const action = penaltyDialog.status === 'banned' ? '封禁' : '禁言'
  const prefix = penaltyDialog.isExtend ? '延长' : ''
  return `${prefix}${action}用户`
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
    const res = await getUsers(query)
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
  query.role = ''
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
  router.push(`/users/${id}`)
}

// 打开禁言/封禁对话框
const openPenaltyDialog = (row, status) => {
  penaltyDialog.userId = row.id
  penaltyDialog.userNickname = row.nickname || '未知'
  penaltyDialog.status = status
  penaltyDialog.isExtend = row.status === status // 如果用户已经是该状态，则为延长操作
  penaltyDialog.durationType = 1
  penaltyDialog.customDays = 1
  penaltyDialog.visible = true
}

// 关闭对话框
const closePenaltyDialog = () => {
  penaltyDialog.visible = false
  penaltyDialog.loading = false
}

// 确认禁言/封禁
const confirmPenalty = async () => {
  // 计算最终天数
  let duration
  if (penaltyDialog.durationType === -1) {
    duration = penaltyDialog.customDays
  } else {
    duration = penaltyDialog.durationType
  }

  penaltyDialog.loading = true
  try {
    await updateUserStatus(penaltyDialog.userId, penaltyDialog.status, duration)
    const action = penaltyDialog.status === 'banned' ? '封禁' : '禁言'
    const prefix = penaltyDialog.isExtend ? '延长' : ''
    ElMessage.success(`${prefix}${action}成功`)
    closePenaltyDialog()
    loadData()
  } catch (err) {
    console.error(err)
  } finally {
    penaltyDialog.loading = false
  }
}

// 解除封禁/禁言
const handleUnban = (row) => {
  ElMessageBox.confirm(`确定要解除用户「${row.nickname}」的封禁/禁言吗？`, '提示', {
    type: 'success',
    confirmButtonText: '确定解除',
    cancelButtonText: '取消'
  })
    .then(async () => {
      try {
        await unbanUser(row.id)
        ElMessage.success('已解除封禁/禁言')
        loadData()
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

// 删除用户
const handleDelete = (row) => {
  ElMessageBox.confirm(
    `确定要删除用户「${row.nickname}」吗？此操作不可恢复！\n用户发布的帖子和评论将保留，但作者信息将显示为空。`,
    '删除用户',
    {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消'
    }
  )
    .then(async () => {
      try {
        await deleteUser(row.id)
        ElMessage.success('用户删除成功')
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

/* 头像 + 昵称单元格 */
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;

  .nickname {
    color: #303133;
  }
}

/* 处罚到期信息 */
.expire-normal {
  color: #909399;
}

.expire-info {
  .remaining {
    font-size: 12px;
    color: #909399;
    margin-top: 2px;
  }
}
</style>
