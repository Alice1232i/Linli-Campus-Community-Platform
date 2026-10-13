<template>
  <!-- 404 页面 -->
  <div class="not-found">
    <div class="content">
      <div class="code">404</div>
      <div class="text">页面不存在</div>
      <el-button type="primary" size="large" @click="goHome">返回首页</el-button>
    </div>
  </div>
</template>

<script setup>
/**
 * 404 页面
 * - 居中显示 "404" 大字 + "页面不存在"
 * - 提供返回首页按钮
 */
import { useRouter } from 'vue-router'

const router = useRouter()

// 返回首页
const goHome = () => {
  router.push('/')
}
</script>

<style lang="scss" scoped>
/* 404 页面容器：全屏居中 */
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  background: #f0f2f5;

  .content {
    text-align: center;

    .code {
      font-size: 120px;
      font-weight: 700;
      color: #409eff;
      line-height: 1;
    }

    .text {
      font-size: 20px;
      color: #606266;
      margin: 16px 0 32px;
    }
  }
}
</style>
