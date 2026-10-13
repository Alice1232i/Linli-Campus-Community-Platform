<template>
  <!-- 登录页：居中卡片 + 渐变背景 -->
  <div class="login-container">
    <el-card class="login-card" shadow="always">
      <!-- 标题 -->
      <div class="login-title">临里校园 管理后台</div>

      <!-- 登录表单 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @keyup.enter="handleLogin"
      >
        <!-- 用户名 -->
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
            clearable
          />
        </el-form-item>

        <!-- 密码 -->
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            show-password
            clearable
          />
        </el-form-item>

        <!-- 登录按钮 -->
        <el-form-item>
          <el-button
            type="primary"
            class="login-btn"
            :loading="loading"
            @click="handleLogin"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
/**
 * 登录页
 * - 表单校验：用户名必填，密码必填且≥6位
 * - 调用 auth API login，成功后保存登录态并跳转首页
 */
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { login } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

// 表单引用
const formRef = ref(null)
// 提交中状态
const loading = ref(false)

// 表单数据
const form = reactive({
  username: '',
  password: ''
})

// 表单校验规则
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
  ]
}

// 登录处理
const handleLogin = async () => {
  // 防重复提交：请求进行中直接忽略（快速连按回车/按钮不会并发请求）
  if (loading.value) return
  if (!formRef.value) return
  loading.value = true

  // 表单校验（Promise 形式）
  let valid = false
  try {
    valid = await formRef.value.validate()
  } catch (e) {
    valid = false
  }
  if (!valid) {
    loading.value = false
    return
  }

  try {
    const res = await login({ username: form.username, password: form.password })
    // 保存登录态
    authStore.setAuth(res.token, res.user)
    ElMessage.success('登录成功')
    // 跳转首页
    router.push('/')
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
/* 登录页容器：渐变背景 + 居中布局 */
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* 登录卡片 */
.login-card {
  width: 420px;
  padding: 20px 20px 8px;
  border-radius: 8px;

  .login-title {
    text-align: center;
    font-size: 22px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 24px;
  }

  .login-btn {
    width: 100%;
  }
}
</style>
