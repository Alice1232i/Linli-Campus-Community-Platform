<template>
  <div class="page-container">
    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <!-- 管理员姓名 -->
        <el-form-item label="操作人">
          <el-input
            v-model="query.adminName"
            placeholder="输入管理员姓名搜索"
            clearable
            style="width: 180px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>

        <!-- 操作类型（下拉选择，分组展示） -->
        <el-form-item label="操作类型">
          <el-select
            v-model="query.action"
            placeholder="全部操作"
            clearable
            filterable
            style="width: 220px"
          >
            <el-option-group
              v-for="group in actionGroups"
              :key="group.label"
              :label="group.label"
            >
              <el-option
                v-for="opt in group.options"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-option-group>
          </el-select>
        </el-form-item>

        <!-- 目标类型 -->
        <el-form-item label="目标类型">
          <el-select v-model="query.targetType" placeholder="全部类型" clearable style="width: 140px">
            <el-option label="帖子" value="post" />
            <el-option label="评论" value="comment" />
            <el-option label="用户" value="user" />
            <el-option label="举报" value="report" />
            <el-option label="认证" value="verification" />
          </el-select>
        </el-form-item>

        <!-- 目标ID（用于按帖子ID查操作日志） -->
        <el-form-item label="目标ID">
          <el-input
            v-model="query.targetId"
            placeholder="输入目标ID精确查询"
            clearable
            style="width: 220px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>

        <!-- 时间范围 -->
        <el-form-item label="操作时间">
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
      <el-table
        v-loading="loading"
        :data="tableData"
        stripe
        border
        style="width: 100%"
        row-key="id"
      >
        <!-- 展开行：显示操作前/后数据快照与请求参数 -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-detail">
              <!-- 变更摘要：字段级差异对比 -->
              <div v-if="row.changes && row.changes.length > 0" class="detail-section">
                <div class="detail-label">变更内容</div>
                <div class="change-list">
                  <div v-for="(change, idx) in row.changes" :key="idx" class="change-item">
                    <span class="change-field">{{ change.label }}</span>
                    <span class="change-arrow">：</span>
                    <span v-if="change.type === 'added'" class="change-value change-added">新增「{{ change.newVal }}」</span>
                    <span v-else-if="change.type === 'removed'" class="change-value change-removed">删除「{{ change.oldVal }}」</span>
                    <span v-else class="change-value">
                      <span class="change-old">{{ change.oldVal }}</span>
                      <span class="change-arrow"> → </span>
                      <span class="change-new">{{ change.newVal }}</span>
                    </span>
                  </div>
                </div>
              </div>

              <!-- 请求参数语义化描述 -->
              <div v-if="row.paramsDesc && row.paramsDesc.length > 0" class="detail-section">
                <div class="detail-label">操作参数</div>
                <div class="change-list">
                  <div v-for="(param, idx) in row.paramsDesc" :key="idx" class="change-item">
                    <span class="change-field">{{ param.label }}</span>
                    <span class="change-arrow">：</span>
                    <span class="change-value">{{ param.value }}</span>
                  </div>
                </div>
              </div>

              <!-- 无变更且无参数时展示提示 -->
              <div v-if="(!row.changes || row.changes.length === 0) && (!row.paramsDesc || row.paramsDesc.length === 0)" class="detail-section">
                <div class="detail-empty">暂无可展示的变更详情</div>
              </div>

              <!-- 原始数据折叠区（供技术排查） -->
              <el-collapse class="raw-collapse">
                <el-collapse-item title="查看原始数据" name="raw">
                  <div class="raw-section">
                    <div class="raw-label">操作前数据</div>
                    <pre class="detail-json">{{ formatJson(row.before_data) }}</pre>
                  </div>
                  <div class="raw-section">
                    <div class="raw-label">操作后数据</div>
                    <pre class="detail-json">{{ formatJson(row.after_data) }}</pre>
                  </div>
                  <div class="raw-section">
                    <div class="raw-label">请求参数</div>
                    <pre class="detail-json">{{ formatJson(row.request_body) }}</pre>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="admin_name" label="操作人" min-width="120" show-overflow-tooltip />
        <el-table-column label="操作类型" width="160" align="center">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)" size="small">{{ formatAction(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标类型" width="100" align="center">
          <template #default="{ row }">
            {{ formatTargetType(row.target_type) }}
          </template>
        </el-table-column>
        <el-table-column label="目标ID" width="160">
          <template #default="{ row }">
            <el-link
              v-if="row.target_type === 'post' && row.target_id"
              type="primary"
              :underline="false"
              @click="goPostDetail(row.target_id)"
            >{{ row.target_id }}</el-link>
            <span v-else>{{ row.target_id || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="method" label="请求方法" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="methodTagType(row.method)" size="small">{{ row.method }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="path" label="路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column label="状态码" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusCodeTagType(row.status_code)" size="small">{{ row.status_code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180" align="center">
          <template #default="{ row }">{{ formatTimestamp(row.created_at) }}</template>
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
 * 操作日志（合规审计版）
 * - 筛选栏：操作人、操作类型（下拉）、目标类型、目标ID、时间范围、排序
 * - 表格列：操作人、操作类型、目标类型、目标ID、请求方法、路径、IP、状态码、创建时间
 * - 展开行：操作前数据快照、操作后数据快照、请求参数
 * - 只读列表，无操作列，禁止删除/修改日志
 */
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getLogs } from '@/api/log'
import Pagination from '@/components/Pagination.vue'
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
  adminName: '',
  action: '',
  targetType: '',
  targetId: '',
  startDate: '',
  endDate: '',
  sortOrder: 'desc'
})

// 操作类型中英文映射表（key 为后端 action 值，value 为中文标签）
// 与后端 operationLogger 中间件 defaultGetAction 推导规则一一对应：
//   PUT /api/posts/:id/top     → post:update_top
//   PUT /api/users/:id/unban   → user:update_unban
//   PUT /api/reports/:id/handle → report:update_handle
//   PUT /api/verifications/:id/approve → verification:update_approve
const ACTION_LABELS = {
  // 帖子管理
  'post:update_top': '置顶/取消置顶',
  'post:update_essence': '加精/取消加精',
  'post:update_status': '更新帖子状态',
  'post:delete': '删除帖子',
  // 评论管理
  'comment:delete': '删除评论',
  // 用户管理
  'user:update_status': '禁言/封禁用户',
  'user:update_role': '更新用户角色',
  'user:update_unban': '解除禁言/封禁',
  'user:delete': '删除用户',
  // 举报管理
  'report:update_handle': '处理举报',
  'report:delete': '删除举报',
  // 认证管理
  'verification:update_approve': '审核通过认证',
  'verification:update_reject': '驳回认证申请',
  // 系统
  'auth:login': '管理员登录'
}

// 操作类型分组下拉选项（与 ACTION_LABELS 一致）
const actionGroups = [
  {
    label: '帖子管理',
    options: [
      { label: '置顶/取消置顶', value: 'post:update_top' },
      { label: '加精/取消加精', value: 'post:update_essence' },
      { label: '更新帖子状态', value: 'post:update_status' },
      { label: '删除帖子', value: 'post:delete' }
    ]
  },
  {
    label: '评论管理',
    options: [
      { label: '删除评论', value: 'comment:delete' }
    ]
  },
  {
    label: '用户管理',
    options: [
      { label: '禁言/封禁用户', value: 'user:update_status' },
      { label: '更新用户角色', value: 'user:update_role' },
      { label: '解除禁言/封禁', value: 'user:update_unban' },
      { label: '删除用户', value: 'user:delete' }
    ]
  },
  {
    label: '举报管理',
    options: [
      { label: '处理举报', value: 'report:update_handle' },
      { label: '删除举报', value: 'report:delete' }
    ]
  },
  {
    label: '认证管理',
    options: [
      { label: '审核通过认证', value: 'verification:update_approve' },
      { label: '驳回认证申请', value: 'verification:update_reject' }
    ]
  },
  {
    label: '系统',
    options: [
      { label: '管理员登录', value: 'auth:login' }
    ]
  }
]

// 格式化 JSON 数据为可读字符串（原始数据折叠区使用）
const formatJson = (data) => {
  if (data === null || data === undefined) return '无数据'
  try {
    if (typeof data === 'string') {
      return JSON.stringify(JSON.parse(data), null, 2)
    }
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

// ========== 字段中文名映射表 ==========
// 将数据库蛇形字段名翻译为中文，供差异对比展示使用
const FIELD_LABELS = {
  // 通用字段
  id: 'ID',
  openid: 'OpenID',
  status: '状态',
  created_at: '创建时间',
  updated_at: '更新时间',
  // 帖子字段
  title: '标题',
  content: '内容',
  module: '模块',
  section: '板块',
  images: '图片',
  tags: '标签',
  is_top: '置顶',
  is_essence: '精华',
  like_count: '点赞数',
  comment_count: '评论数',
  view_count: '浏览数',
  share_count: '分享数',
  favorite_count: '收藏数',
  sec_status: '内容安全状态',
  trade_price: '交易价格',
  trade_condition: '成色',
  trade_location: '交易地点',
  // 用户字段
  nickname: '昵称',
  avatar: '头像',
  gender: '性别',
  bio: '个人简介',
  phone: '手机号',
  role: '角色',
  campus: '校区',
  ban_expire: '封禁到期',
  mute_expire: '禁言到期',
  student_verified: '学生认证',
  verify_badge: '认证徽标',
  post_count: '发帖数',
  like_received_count: '获赞数',
  follower_count: '粉丝数',
  following_count: '关注数',
  // 评论字段
  post_id: '所属帖子',
  parent_id: '父评论',
  reply_to_user_id: '回复用户',
  reply_to_nickname: '回复昵称',
  // 举报字段
  reason: '举报原因',
  detail: '举报详情',
  evidence: '证据图片',
  result: '处理结果',
  handler_id: '处理人',
  handler_name: '处理人姓名',
  resolved_at: '处理时间'
}

// 状态值中文映射
const STATUS_LABELS = {
  // 帖子/评论状态
  normal: '正常',
  hidden: '隐藏',
  deleted: '已删除',
  reviewing: '审核中',
  // 内容安全状态
  pass: '通过',
  risk: '有风险',
  // 用户状态
  active: '正常',
  muted: '禁言',
  banned: '封禁',
  // 举报状态
  pending: '待处理',
  processing: '处理中',
  resolved: '已处理',
  rejected: '已驳回'
}

// 请求参数字段中文映射
const PARAM_LABELS = {
  status: '目标状态',
  duration: '时长',
  action: '处罚措施',
  isTop: '置顶状态',
  isEssence: '加精状态',
  reason: '原因',
  result: '处理结果',
  penalty: '处罚措施',
  username: '用户名',
  password: '密码',
  role: '角色'
}

// 举报处理动作中文映射（action 字段值：mute/ban/warn/dismiss）
const PENALTY_LABELS = {
  mute: '禁言',
  ban: '封禁',
  warn: '警告',
  dismiss: '驳回举报'
}

/**
 * 将字段值转换为可读的中文描述
 * @param {string} field 字段名
 * @param {*} value 字段值
 * @returns {string} 可读的值
 */
const formatFieldValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '空'
  // 布尔值
  if (typeof value === 'boolean') return value ? '是' : '否'
  // 状态字段映射
  if (field === 'status' || field === 'sec_status') {
    return STATUS_LABELS[value] || String(value)
  }
  // 时间戳字段
  if (field === 'created_at' || field === 'updated_at' || field === 'ban_expire' ||
      field === 'mute_expire' || field === 'resolved_at') {
    if (typeof value === 'number' && value > 0) {
      return formatTimestamp(value)
    }
    if (value === 0) return '永久'
    return String(value)
  }
  // 性别
  if (field === 'gender') {
    return { 0: '未知', 1: '男', 2: '女' }[value] || String(value)
  }
  // 数组
  if (Array.isArray(value)) {
    if (value.length === 0) return '空'
    return value.length + ' 项'
  }
  // 长文本截断
  const str = String(value)
  if (str.length > 60) return str.slice(0, 60) + '...'
  return str
}

/**
 * 解析数据，确保返回对象
 */
const parseData = (data) => {
  if (!data) return null
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return null }
  }
  return data
}

/**
 * 对比 before_data 和 after_data，提取字段级变更
 * 只展示发生变化的字段，格式：{ label, oldVal, newVal, type }
 * type: 'modified' | 'added' | 'removed'
 * @param {Object} before 操作前数据
 * @param {Object} after 操作后数据
 * @returns {Array} 变更列表
 */
const computeChanges = (before, after) => {
  if (!before && !after) return []
  const beforeObj = parseData(before) || {}
  const afterObj = parseData(after) || {}
  const changes = []
  // 需要忽略的系统字段
  const IGNORE_FIELDS = ['updated_at']

  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])
  for (const key of allKeys) {
    if (IGNORE_FIELDS.includes(key)) continue
    const oldVal = beforeObj[key]
    const newVal = afterObj[key]
    const label = FIELD_LABELS[key] || key

    // 新增字段
    if (oldVal === undefined || oldVal === null) {
      if (newVal !== undefined && newVal !== null) {
        changes.push({ label, type: 'added', newVal: formatFieldValue(key, newVal) })
      }
      continue
    }
    // 删除字段
    if (newVal === undefined || newVal === null) {
      changes.push({ label, type: 'removed', oldVal: formatFieldValue(key, oldVal) })
      continue
    }
    // 修改字段（值不同）
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        label,
        type: 'modified',
        oldVal: formatFieldValue(key, oldVal),
        newVal: formatFieldValue(key, newVal)
      })
    }
  }
  return changes
}

/**
 * 将 request_body 解析为语义化的参数描述
 * @param {Object} requestBody 请求体
 * @param {string} logAction 日志操作类型（用于判断 duration 单位等上下文）
 * @returns {Array} 参数列表 { label, value }
 */
const computeParamsDesc = (requestBody, logAction) => {
  const body = parseData(requestBody)
  if (!body || typeof body !== 'object') return []
  const params = []
  for (const [key, value] of Object.entries(body)) {
    // 忽略密码字段
    if (key === 'password') {
      params.push({ label: PARAM_LABELS[key] || key, value: '******' })
      continue
    }
    const label = PARAM_LABELS[key] || FIELD_LABELS[key] || key
    if (key === 'status' && STATUS_LABELS[value]) {
      params.push({ label, value: STATUS_LABELS[value] })
    } else if (key === 'action' && PENALTY_LABELS[value]) {
      // 举报处理动作映射（mute→禁言, ban→封禁, warn→警告, dismiss→驳回）
      params.push({ label, value: PENALTY_LABELS[value] })
    } else if (key === 'duration' && typeof value === 'number') {
      // duration 在举报处理和用户状态更新中均为天数（0=永久）
      if (value === 0) {
        params.push({ label, value: '永久' })
      } else {
        params.push({ label, value: value + ' 天' })
      }
    } else if (typeof value === 'boolean') {
      params.push({ label, value: value ? '是' : '否' })
    } else if (value === '' || value === null || value === undefined) {
      // 空字符串/空值显示"未填写"，比"空"更直观
      params.push({ label, value: '未填写' })
    } else {
      params.push({ label, value: formatFieldValue(key, value) })
    }
  }
  return params
}

/**
 * 为每条日志记录计算变更摘要和参数描述
 * 在 loadData 后对 tableData 进行后处理
 */
const enrichLogData = (list) => {
  return list.map(item => ({
    ...item,
    changes: computeChanges(item.before_data, item.after_data),
    paramsDesc: computeParamsDesc(item.request_body, item.action)
  }))
}

// 操作类型对应的 tag 颜色
const actionTagType = (action) => {
  if (!action) return 'info'
  if (action.includes('delete')) return 'danger'
  if (action.includes('unban') || action.includes('approve')) return 'success'
  if (action.includes('login')) return 'info'
  return 'warning'
}

// 格式化操作类型为中文
const formatAction = (action) => {
  if (!action) return '-'
  return ACTION_LABELS[action] || action
}

// 格式化目标类型为中文
const formatTargetType = (type) => {
  const map = {
    post: '帖子',
    comment: '评论',
    user: '用户',
    report: '举报',
    verification: '认证'
  }
  return map[type] || type || '-'
}

// 请求方法对应的 tag type
const methodTagType = (method) => {
  const map = {
    GET: 'info',
    POST: 'success',
    PUT: 'warning',
    DELETE: 'danger'
  }
  return map[(method || '').toUpperCase()] || 'info'
}

// 状态码对应的 tag type
const statusCodeTagType = (code) => {
  if (!code) return 'info'
  if (code >= 200 && code < 300) return 'success'
  if (code >= 300 && code < 400) return 'info'
  if (code >= 400 && code < 500) return 'warning'
  return 'danger'
}

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
    const res = await getLogs(query)
    // 删除最后一页最后一条后页码回退：当前页无数据且 page>1 时回退一页重拉
    if ((!res.list || res.list.length === 0) && query.page > 1) {
      query.page = query.page - 1
      await loadData(silent)
      return
    }
    // 后处理：计算字段变更摘要和参数语义化描述
    tableData.value = enrichLogData(res.list || [])
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

// 跳转帖子详情（从操作日志跳到帖子管理详情页）
const goPostDetail = (postId) => {
  if (!postId) {
    ElMessage.warning('目标帖子不存在')
    return
  }
  router.push(`/posts/${postId}`)
}

// 重置筛选
const handleReset = () => {
  query.adminName = ''
  query.action = ''
  query.targetType = ''
  query.targetId = ''
  query.startDate = ''
  query.endDate = ''
  query.sortOrder = 'desc'
  dateRange.value = []
  query.page = 1
  loadData()
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

/* 展开行详情样式 */
.expand-detail {
  padding: 12px 24px;

  .detail-section {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .detail-label {
    font-weight: 600;
    color: #606266;
    margin-bottom: 8px;
    font-size: 14px;
  }

  .detail-empty {
    color: #909399;
    font-size: 14px;
    padding: 8px 0;
  }

  /* 变更对比列表 */
  .change-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .change-item {
    display: flex;
    align-items: baseline;
    font-size: 14px;
    line-height: 1.8;
    padding: 4px 12px;
    background: #fafafa;
    border-radius: 4px;
    border-left: 3px solid #dcdfe6;
  }

  .change-field {
    font-weight: 600;
    color: #303133;
    min-width: 80px;
    flex-shrink: 0;
  }

  .change-arrow {
    color: #909399;
    margin: 0 4px;
  }

  .change-value {
    color: #606266;
  }

  .change-old {
    color: #f56c6c;
    text-decoration: line-through;
    text-decoration-color: rgba(245, 108, 108, 0.5);
  }

  .change-new {
    color: #67c23a;
    font-weight: 600;
  }

  .change-added {
    color: #67c23a;
    font-weight: 500;
  }

  .change-removed {
    color: #f56c6c;
    font-weight: 500;
  }

  /* 原始数据折叠区 */
  .raw-collapse {
    border: none;
    margin-top: 8px;

    :deep(.el-collapse-item__header) {
      font-size: 13px;
      color: #909399;
      height: 32px;
      line-height: 32px;
      border: none;
    }

    :deep(.el-collapse-item__wrap) {
      border: none;
    }

    :deep(.el-collapse-item__content) {
      padding: 0;
    }
  }

  .raw-section {
    margin-bottom: 12px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .raw-label {
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
  }

  .detail-json {
    background: #f5f7fa;
    border: 1px solid #e4e7ed;
    border-radius: 4px;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #303133;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
}
</style>
