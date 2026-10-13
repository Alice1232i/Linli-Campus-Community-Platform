<template>
  <div class="page-container" v-loading="loading">
    <!-- 用户详情 -->
    <el-card shadow="never" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>用户详情</span>
          <el-button link type="primary" @click="goBack">返回</el-button>
        </div>
      </template>

      <el-descriptions :column="3" border>
        <el-descriptions-item label="头像">
          <el-avatar :size="60" :src="detail.avatar" />
        </el-descriptions-item>
        <el-descriptions-item label="昵称">{{ detail.nickname }}</el-descriptions-item>
        <el-descriptions-item label="openid">{{ detail.openid }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ formatRole(detail.role) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <StatusTag type="user" :value="detail.status" />
        </el-descriptions-item>
        <el-descriptions-item label="处罚到期">
          <span v-if="detail.status === 'active'">-</span>
          <div v-else class="expire-detail">
            <div>{{ formatBanExpire(detail.status === 'banned' ? detail.ban_expire : detail.mute_expire, detail.status) }}</div>
            <div class="remaining">{{ formatRemainingTime(detail.status === 'banned' ? detail.ban_expire : detail.mute_expire) }}</div>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="简介">{{ detail.bio || '-' }}</el-descriptions-item>
        <el-descriptions-item label="手机">{{ detail.phone || '-' }}</el-descriptions-item>
        <el-descriptions-item label="校区">{{ detail.campus || '-' }}</el-descriptions-item>
        <!-- 院系信息：编辑资料填写，来自 users 集合的 college / major / grade -->
        <el-descriptions-item label="学院">{{ detail.college || '-' }}</el-descriptions-item>
        <el-descriptions-item label="专业">{{ detail.major || '-' }}</el-descriptions-item>
        <el-descriptions-item label="届数">{{ detail.grade ? detail.grade + ' 届' : '-' }}</el-descriptions-item>
        <el-descriptions-item label="帖子数">{{ detail.post_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="获赞数">{{ detail.like_received_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="粉丝数">{{ detail.follower_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="关注数">{{ detail.following_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTimestamp(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 禁言/封禁管理 -->
    <el-card shadow="never" class="action-card">
      <template #header>
        <span>禁言 / 封禁管理</span>
      </template>

      <!-- 当前状态展示 -->
      <div class="current-status">
        <span>当前状态：</span>
        <StatusTag type="user" :value="detail.status" />
        <span v-if="detail.status !== 'active'" class="status-extra">
          （{{ formatBanExpire(detail.status === 'banned' ? detail.ban_expire : detail.mute_expire, detail.status) }}）
        </span>
      </div>

      <!-- 操作区 -->
      <el-form :inline="true" label-width="80px" class="penalty-form">
        <!-- 处罚类型 -->
        <el-form-item label="操作">
          <el-select v-model="penaltyForm.status" placeholder="选择操作" style="width: 160px">
            <el-option label="禁言" value="muted" />
            <el-option label="封禁" value="banned" />
          </el-select>
        </el-form-item>

        <!-- 处罚时长 -->
        <el-form-item label="时长">
          <el-select v-model="penaltyForm.durationType" style="width: 120px">
            <el-option label="1天" :value="1" />
            <el-option label="3天" :value="3" />
            <el-option label="7天" :value="7" />
            <el-option label="30天" :value="30" />
            <el-option label="永久" :value="0" />
            <el-option label="自定义" :value="-1" />
          </el-select>
        </el-form-item>

        <!-- 自定义天数 -->
        <el-form-item v-if="penaltyForm.durationType === -1" label="天数">
          <el-input-number
            v-model="penaltyForm.customDays"
            :min="1"
            :max="3650"
            style="width: 160px"
          />
        </el-form-item>

        <!-- 执行按钮 -->
        <el-form-item>
          <el-button
            type="warning"
            :disabled="!penaltyForm.status"
            @click="handleApplyPenalty"
          >
            {{ penaltyForm.status === 'banned' ? '执行封禁' : '执行禁言' }}
          </el-button>
          <el-button
            type="success"
            :disabled="detail.status === 'active'"
            @click="handleUnban"
          >
            解除封禁/禁言
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 其他操作 -->
    <el-card shadow="never" class="action-card">
      <template #header>
        <span>其他操作</span>
      </template>
      <el-form :inline="true" label-width="80px">
        <!-- 修改角色 -->
        <el-form-item label="角色">
          <el-select v-model="newRole" placeholder="请选择角色" style="width: 160px">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
            <el-option label="操作员" value="operator" />
            <el-option label="商家" value="merchant" />
          </el-select>
          <el-button type="primary" @click="handleUpdateRole">保存角色</el-button>
        </el-form-item>

        <el-form-item>
          <el-button @click="goBack">返回</el-button>
          <el-button type="danger" @click="handleDelete">删除用户</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
/**
 * 用户详情
 * - 展示完整用户信息，包括禁言/封禁到期时间
 * - 禁言/封禁管理：可选择时长执行禁言/封禁，可解除，可延长
 * - 其他操作：修改角色、删除用户
 */
import { ref, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUserDetail, updateUserStatus, unbanUser, updateUserRole, deleteUser } from '@/api/user'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp, formatRole, formatBanExpire, formatRemainingTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()

// 加载状态
const loading = ref(false)
// 用户详情
const detail = ref({})
// 修改后的角色
const newRole = ref('')

// 禁言/封禁表单
const penaltyForm = reactive({
  status: 'muted',       // muted 或 banned
  durationType: 1,       // 1/3/7/30/0(永久)/-1(自定义)
  customDays: 1
})

// 加载详情
const loadDetail = async () => {
  loading.value = true
  try {
    const res = await getUserDetail(route.params.id)
    detail.value = res || {}
    newRole.value = res?.role || ''
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// 返回列表
const goBack = () => router.back()

// 计算最终天数
const getDuration = () => {
  if (penaltyForm.durationType === -1) {
    return penaltyForm.customDays
  }
  return penaltyForm.durationType
}

// 执行禁言/封禁
const handleApplyPenalty = async () => {
  if (!penaltyForm.status) {
    ElMessage.warning('请选择操作类型')
    return
  }

  const duration = getDuration()
  const action = penaltyForm.status === 'banned' ? '封禁' : '禁言'
  const isExtend = detail.value.status === penaltyForm.status
  const prefix = isExtend ? '延长' : ''

  try {
    await updateUserStatus(detail.value.id, penaltyForm.status, duration)
    ElMessage.success(`${prefix}${action}成功`)
    loadDetail()
  } catch (err) {
    ElMessage.error(err?.message || `${action}失败`)
  }
}

// 解除封禁/禁言
const handleUnban = async () => {
  ElMessageBox.confirm(
    `确定要解除用户「${detail.value.nickname}」的封禁/禁言吗？`,
    '解除确认',
    {
      type: 'success',
      confirmButtonText: '确定解除',
      cancelButtonText: '取消'
    }
  )
    .then(async () => {
      try {
        await unbanUser(detail.value.id)
        ElMessage.success('已解除封禁/禁言')
        loadDetail()
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

// 修改角色
const handleUpdateRole = async () => {
  if (!newRole.value) {
    ElMessage.warning('请选择角色')
    return
  }
  // 二次确认：修改角色影响用户权限，防止误操作
  try {
    await ElMessageBox.confirm(`确定将用户「${detail.value.nickname}」的角色修改为「${newRole.value}」吗？`, '确认修改', { type: 'warning' })
  } catch (e) {
    return
  }
  try {
    await updateUserRole(detail.value.id, newRole.value)
    ElMessage.success('角色修改成功')
    loadDetail()
  } catch (err) {
    console.error(err)
  }
}

// 删除用户
const handleDelete = () => {
  ElMessageBox.confirm(
    `确定要删除用户「${detail.value.nickname}」吗？此操作不可恢复！\n用户发布的帖子和评论将保留，但作者信息将显示为空。`,
    '删除用户',
    {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消'
    }
  )
    .then(async () => {
      try {
        await deleteUser(detail.value.id)
        ElMessage.success('用户删除成功')
        router.push('/users')
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

// 路由参数变化时重新加载（组件复用场景，避免显示上一个 id 的数据）
watch(() => route.params.id, loadDetail, { immediate: true })
</script>

<style lang="scss" scoped>
.page-container {
  .detail-card {
    margin-bottom: 16px;

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  }

  .action-card {
    margin-bottom: 16px;
    text-align: left;
  }
}

/* 当前状态行 */
.current-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 14px;

  .status-extra {
    color: #909399;
  }
}

/* 处罚表单 */
.penalty-form {
  margin-top: 8px;
}

/* 处罚到期详情 */
.expire-detail {
  .remaining {
    font-size: 12px;
    color: #909399;
    margin-top: 2px;
  }
}
</style>
