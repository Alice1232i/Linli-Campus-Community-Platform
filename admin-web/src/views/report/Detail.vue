<template>
  <div class="page-container" v-loading="loading">
    <!-- 举报详情 -->
    <el-card shadow="never" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>举报详情</span>
          <el-button link type="primary" @click="goBack">返回</el-button>
        </div>
      </template>

      <!-- 基本信息 -->
      <el-descriptions :column="3" border>
        <el-descriptions-item label="举报ID" :span="3">{{ detail.id || '-' }}</el-descriptions-item>
        <el-descriptions-item label="举报人">{{ detail.openid || '-' }}</el-descriptions-item>
        <el-descriptions-item label="目标类型">{{ targetTypeText(detail.targetType) }}</el-descriptions-item>
        <el-descriptions-item label="目标ID">{{ detail.targetId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="举报原因">{{ reasonText(detail.reason) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <StatusTag type="report" :value="detail.status" />
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTimestamp(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="处理人">{{ detail.handler || '-' }}</el-descriptions-item>
        <el-descriptions-item label="处理时间">{{ formatTimestamp(detail.resolved_at) }}</el-descriptions-item>
      </el-descriptions>

      <!-- 举报描述 -->
      <div class="content-block">
        <div class="block-title">举报描述</div>
        <div class="content-text">{{ detail.detail || '(举报人未填写描述)' }}</div>
      </div>

      <!-- 被举报内容（反查展示，让管理员直接看到违规内容） -->
      <div class="content-block" v-if="detail.targetContent">
        <div class="block-title">
          被举报内容
          <el-link
            v-if="detail.targetContent.exists && detail.targetContent.type === 'post' && detail.targetId"
            type="primary"
            :underline="false"
            style="margin-left: 12px"
            @click="goPostDetail(detail.targetId)"
          >查看帖子详情</el-link>
        </div>

        <!-- 帖子内容 -->
        <template v-if="detail.targetContent.type === 'post' && detail.targetContent.exists">
          <div class="target-content">
            <div class="target-content__title" v-if="detail.targetContent.title">{{ detail.targetContent.title }}</div>
            <div class="target-content__text">{{ detail.targetContent.content || '(无正文)' }}</div>
            <div class="target-content__images" v-if="detail.targetContent.images && detail.targetContent.images.length">
              <el-image
                v-for="(img, index) in detail.targetContent.images"
                :key="index"
                :src="img"
                :preview-src-list="detail.targetContent.images"
                :initial-index="index"
                fit="cover"
                class="post-image"
                preview-teleported
              />
            </div>
            <div class="target-content__meta">
              <el-tag size="small" type="info">板块: {{ detail.targetContent.section || '-' }}</el-tag>
              <el-tag size="small" :type="detail.targetContent.status === 'deleted' ? 'danger' : 'success'">状态: {{ detail.targetContent.status || '-' }}</el-tag>
            </div>
          </div>
        </template>

        <!-- 评论内容 -->
        <template v-else-if="detail.targetContent.type === 'comment' && detail.targetContent.exists">
          <div class="target-content">
            <div class="target-content__text">{{ detail.targetContent.content || '(无内容)' }}</div>
            <div class="target-content__meta">
              <el-tag size="small" type="info">所属帖子: {{ detail.targetContent.postId || '-' }}</el-tag>
              <el-tag size="small" :type="detail.targetContent.status === 'deleted' ? 'danger' : 'success'">状态: {{ detail.targetContent.status || '-' }}</el-tag>
            </div>
          </div>
        </template>

        <!-- 用户信息 -->
        <template v-else-if="detail.targetContent.type === 'user' && detail.targetContent.exists">
          <div class="target-content">
            <div class="target-content__text">用户: {{ detail.targetContent.nickname || '-' }}</div>
            <div class="target-content__meta">
              <el-tag size="small" :type="detail.targetContent.status === 'banned' ? 'danger' : 'success'">状态: {{ detail.targetContent.status || '-' }}</el-tag>
            </div>
          </div>
        </template>

        <!-- 其他类型 -->
        <template v-else-if="detail.targetContent.exists">
          <div class="target-content">
            <div class="target-content__title" v-if="detail.targetContent.title">{{ detail.targetContent.title }}</div>
            <div class="target-content__text">{{ detail.targetContent.content || '(无内容)' }}</div>
            <div class="target-content__meta">
              <el-tag size="small" :type="detail.targetContent.status === 'deleted' ? 'danger' : 'success'">状态: {{ detail.targetContent.status || '-' }}</el-tag>
            </div>
          </div>
        </template>

        <!-- 内容已被删除 -->
        <div class="content-text" v-else style="color: #f56c6c">该内容已被删除或不存在</div>
      </div>

      <!-- 证据图片 -->
      <div class="content-block" v-if="evidenceImages.length">
        <div class="block-title">证据图片</div>
        <div class="image-list">
          <el-image
            v-for="(img, index) in evidenceImages"
            :key="index"
            :src="img"
            :preview-src-list="evidenceImages"
            :initial-index="index"
            fit="cover"
            class="post-image"
            preview-teleported
          />
        </div>
      </div>

      <!-- 处理结果 -->
      <div class="content-block" v-if="detail.result">
        <div class="block-title">处理结果</div>
        <div class="content-text">{{ detail.result }}</div>
      </div>
    </el-card>

    <!-- 底部操作按钮 -->
    <el-card shadow="never" class="action-card">
      <el-button @click="goBack">返回</el-button>
      <el-button
        v-if="detail.status === 'pending'"
        type="warning"
        @click="openHandleDialog"
      >
        处理举报
      </el-button>
    </el-card>

    <!-- 处理举报弹窗 -->
    <el-dialog v-model="dialogVisible" title="处理举报" width="540px">
      <el-form :model="handleForm" label-width="100px">
        <!-- 处理动作 -->
        <el-form-item label="处理动作">
          <el-radio-group v-model="handleForm.action">
            <el-radio value="ban">封禁账号</el-radio>
            <el-radio value="mute">禁言</el-radio>
            <el-radio value="warn">警告</el-radio>
            <el-radio value="dismiss">驳回举报</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 封禁/禁言时长 -->
        <el-form-item label="时长" v-if="handleForm.action === 'ban' || handleForm.action === 'mute'">
          <el-select v-model="handleForm.duration" placeholder="选择时长" style="width: 100%">
            <el-option label="1天" :value="1" />
            <el-option label="3天" :value="3" />
            <el-option label="7天" :value="7" />
            <el-option label="30天" :value="30" />
            <el-option label="永久" :value="0" />
          </el-select>
        </el-form-item>

        <!-- 处理说明 -->
        <el-form-item label="处理说明">
          <el-input
            v-model="handleForm.result"
            type="textarea"
            :rows="4"
            placeholder="请输入处理说明（将作为通知内容发送给被举报用户）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmHandle">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 举报详情
 * - 从路由 params.id 获取举报详情
 * - 展示举报人、目标类型/ID、原因、状态、创建时间、处理人、处理时间
 * - 展示举报描述、证据图片、处理结果
 * - 底部操作：返回、处理举报（仅 pending 状态显示）
 * - 处理举报支持：封禁N天/禁言N天/警告/驳回，处理后会通知被举报用户
 */
import { ref, reactive, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getReportDetail, handleReport } from '@/api/report'
import StatusTag from '@/components/StatusTag.vue'
import { formatTimestamp } from '@/utils/format'

const route = useRoute()
const router = useRouter()

// 加载状态
const loading = ref(false)
// 举报详情
const detail = ref({})

// 弹窗状态
const dialogVisible = ref(false)
// 提交中状态
const submitting = ref(false)
// 处理表单
const handleForm = reactive({
  action: 'warn',
  duration: 1,
  result: ''
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

// 目标类型映射（与云函数 TARGET_TYPES 白名单对齐）
const TARGET_TYPE_MAP = {
  post: '帖子',
  comment: '评论',
  user: '用户',
  message: '消息',
  lostfound: '失物招领',
  delivery: '跑腿'
}

const reasonText = (val) => REASON_MAP[val] || val || '-'
const targetTypeText = (val) => TARGET_TYPE_MAP[val] || val || '-'

// 证据图片（兼容数组与字符串、过滤空值）
const evidenceImages = computed(() => {
  const ev = detail.value.evidence
  if (Array.isArray(ev)) return ev.filter(Boolean)
  if (typeof ev === 'string' && ev) return [ev]
  return []
})

// 加载详情
const loadDetail = async () => {
  loading.value = true
  try {
    const res = await getReportDetail(route.params.id)
    detail.value = res || {}
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// 返回列表
const goBack = () => router.back()

// 跳转帖子详情（从举报详情跳到帖子管理详情页）
const goPostDetail = (postId) => {
  if (!postId) {
    ElMessage.warning('目标帖子不存在')
    return
  }
  router.push(`/posts/${postId}`)
}

// 打开处理弹窗
const openHandleDialog = () => {
  handleForm.action = 'warn'
  handleForm.duration = 1
  handleForm.result = ''
  dialogVisible.value = true
}

// 确认处理
const confirmHandle = async () => {
  if (!handleForm.action) {
    ElMessage.warning('请选择处理动作')
    return
  }
  // 封禁/禁言必须选择时长
  if ((handleForm.action === 'ban' || handleForm.action === 'mute') && handleForm.duration === '') {
    ElMessage.warning('请选择时长')
    return
  }
  submitting.value = true
  try {
    await handleReport(detail.value.id, {
      action: handleForm.action,
      duration: Number(handleForm.duration),
      result: handleForm.result
    })
    ElMessage.success('处理成功')
    dialogVisible.value = false
    loadDetail()
  } catch (err) {
    console.error(err)
  } finally {
    submitting.value = false
  }
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

      .target-content {
        background: #fff8f0;
        border: 1px solid #fde2c8;
        border-radius: 4px;
        padding: 16px;

        .target-content__title {
          font-size: 15px;
          font-weight: 600;
          color: #303133;
          margin-bottom: 8px;
        }

        .target-content__text {
          line-height: 1.8;
          color: #606266;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .target-content__images {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;

          .post-image {
            width: 100px;
            height: 100px;
            border-radius: 4px;
          }
        }

        .target-content__meta {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
      }
    }
  }

  .action-card {
    text-align: right;
  }
}
</style>
