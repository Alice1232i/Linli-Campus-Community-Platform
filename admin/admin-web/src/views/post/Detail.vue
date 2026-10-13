<template>
  <div class="page-container" v-loading="loading">
    <!-- 帖子详情 -->
    <el-card shadow="never" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>帖子详情</span>
          <el-button link type="primary" @click="goBack">返回</el-button>
        </div>
      </template>

      <!-- 基本信息 -->
      <el-descriptions :column="3" border>
        <el-descriptions-item label="标题" :span="3">{{ detail.title || '(无标题)' }}</el-descriptions-item>
        <el-descriptions-item label="作者">{{ detail.author?.nickname || detail.authorId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="板块">{{ detail.section }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <StatusTag type="post" :value="detail.status" />
        </el-descriptions-item>
        <el-descriptions-item label="点赞数">{{ detail.like_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="评论数">{{ detail.comment_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="浏览数">{{ detail.view_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="分享数">{{ detail.share_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="收藏数">{{ detail.favorite_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="是否置顶">{{ detail.is_top ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="是否加精">{{ detail.is_essence ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTimestamp(detail.created_at) }}</el-descriptions-item>
      </el-descriptions>

      <!-- 内容 -->
      <div class="content-block">
        <div class="block-title">内容</div>
        <div class="content-text">{{ detail.content }}</div>
      </div>

      <!-- 图片列表 -->
      <div class="content-block" v-if="detail.images && detail.images.length">
        <div class="block-title">图片</div>
        <div class="image-list">
          <el-image
            v-for="(img, index) in detail.images"
            :key="index"
            :src="img"
            :preview-src-list="detail.images"
            :initial-index="index"
            fit="cover"
            class="post-image"
            preview-teleported
          />
        </div>
      </div>
    </el-card>

    <!-- 底部操作按钮 -->
    <el-card shadow="never" class="action-card">
      <el-button @click="goBack">返回</el-button>
      <el-button type="warning" @click="handleToggleTop">
        {{ detail.is_top ? '取消置顶' : '置顶' }}
      </el-button>
      <el-button type="success" @click="handleToggleEssence">
        {{ detail.is_essence ? '取消加精' : '加精' }}
      </el-button>
      <el-select v-model="newStatus" placeholder="修改状态" style="width: 140px; margin: 0 8px">
        <el-option label="正常" value="normal" />
        <el-option label="隐藏" value="hidden" />
        <el-option label="审核中" value="reviewing" />
      </el-select>
      <el-button type="primary" @click="handleUpdateStatus">修改状态</el-button>
      <el-button type="danger" @click="handleDelete">删除</el-button>
    </el-card>
  </div>
</template>

<script setup>
/**
 * 帖子详情
 * - 从路由 params.id 获取帖子详情
 * - 展示标题、作者、内容、图片、统计信息、状态、创建时间
 * - 底部操作：返回、置顶/取消置顶、加精/取消加精、修改状态、删除
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getPostDetail,
  toggleTop,
  toggleEssence,
  updatePostStatus,
  deletePost
} from '@/api/post'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp } from '@/utils/format'

const route = useRoute()
const router = useRouter()

// 加载状态
const loading = ref(false)
// 帖子详情
const detail = ref({})
// 修改后的状态值
const newStatus = ref('')

// 加载详情
const refreshing = ref(false)
const loadDetail = async (silent = false) => {
  if (silent) {
    // 静默刷新（定时轮询）：不显示全屏 loading，避免 30 秒闪烁
    refreshing.value = true
  } else {
    loading.value = true
  }
  try {
    const res = await getPostDetail(route.params.id)
    detail.value = res || {}
    newStatus.value = res?.status || ''
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

// 返回列表
const goBack = () => router.back()

// 置顶 / 取消置顶
const handleToggleTop = async () => {
  try {
    await toggleTop(detail.value.id, !detail.value.is_top)
    ElMessage.success(detail.value.is_top ? '已取消置顶' : '已置顶')
    loadDetail()
  } catch (err) {
    console.error(err)
  }
}

// 加精 / 取消加精
const handleToggleEssence = async () => {
  try {
    await toggleEssence(detail.value.id, !detail.value.is_essence)
    ElMessage.success(detail.value.is_essence ? '已取消加精' : '已加精')
    loadDetail()
  } catch (err) {
    console.error(err)
  }
}

// 修改状态
const handleUpdateStatus = async () => {
  if (!newStatus.value) {
    ElMessage.warning('请选择状态')
    return
  }
  // 二次确认：隐藏/审核中状态影响帖子可见性，防止误操作
  try {
    await ElMessageBox.confirm(`确定将帖子「${detail.value.title}」状态修改为「${newStatus.value}」吗？`, '确认修改', { type: 'warning' })
  } catch (e) {
    return
  }
  try {
    await updatePostStatus(detail.value.id, newStatus.value)
    ElMessage.success('状态修改成功')
    loadDetail()
  } catch (err) {
    console.error(err)
  }
}

// 删除帖子
const handleDelete = () => {
  ElMessageBox.confirm(`确定要删除帖子「${detail.value.title}」吗？`, '提示', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
    .then(async () => {
      try {
        await deletePost(detail.value.id)
        ElMessage.success('删除成功')
        router.push('/posts')
      } catch (err) {
        console.error(err)
      }
    })
    .catch(() => {})
}

// 路由参数变化时重新加载（组件复用场景，避免显示上一个 id 的数据）
watch(() => route.params.id, loadDetail, { immediate: true })

// 30 秒静默轮询：页面停留时同步小程序端浏览/点赞/评论等数据变化
let pollTimer = null
const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
onMounted(() => {
  pollTimer = setInterval(() => { loadDetail(true) }, 30000)
})
onUnmounted(stopPolling)
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

    .content-block {
      margin-top: 20px;

      .block-title {
        font-size: 15px;
        font-weight: 600;
        color: #303133;
        margin-bottom: 12px;
        padding-left: 8px;
        border-left: 3px solid #409eff;
      }

      .content-text {
        line-height: 1.8;
        color: #606266;
        background: #f5f7fa;
        padding: 16px;
        border-radius: 4px;
        white-space: pre-wrap;
      }

      .image-list {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;

        .post-image {
          width: 140px;
          height: 140px;
          border-radius: 4px;
        }
      }
    }
  }

  .action-card {
    text-align: right;
  }
}
</style>
