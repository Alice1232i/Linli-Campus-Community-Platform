<template>
  <div class="dashboard">
    <!-- 顶部统计卡片 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :xs="12" :sm="8" :md="4" v-for="item in statCards" :key="item.key">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-card-inner" :style="{ background: item.bg }">
            <el-icon class="stat-icon"><component :is="item.icon" /></el-icon>
            <div class="stat-content">
              <div class="stat-number">{{ overview[item.key] || 0 }}</div>
              <div class="stat-title">{{ item.title }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 趋势图表 -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <span>最近 7 天新增趋势</span>
      </template>
      <v-chart class="chart" :option="chartOption" autoresize />
    </el-card>
  </div>
</template>

<script setup>
/**
 * 仪表盘
 * - 顶部 6 个统计卡片：总用户、总帖子、总评论、总举报、待处理举报、今日新增帖子/用户
 * - 下方 ECharts 折线图：最近 7 天新增帖子和用户趋势
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components'
import VChart from 'vue-echarts'
import { getOverview, getTrend } from '@/api/stats'

// 注册 ECharts 必要模块
use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
])

// 统计卡片配置
const statCards = [
  { key: 'totalUsers', title: '总用户数', icon: 'User', bg: 'linear-gradient(135deg, #667eea, #764ba2)' },
  { key: 'totalPosts', title: '总帖子数', icon: 'Document', bg: 'linear-gradient(135deg, #43cea2, #185a9d)' },
  { key: 'totalComments', title: '总评论数', icon: 'ChatDotRound', bg: 'linear-gradient(135deg, #f7971e, #ffd200)' },
  { key: 'totalReports', title: '总举报数', icon: 'Warning', bg: 'linear-gradient(135deg, #fc5c7d, #6a82fb)' },
  { key: 'pendingReports', title: '待处理举报', icon: 'WarningFilled', bg: 'linear-gradient(135deg, #ff6a00, #ee0979)' },
  { key: 'todayNewPosts', title: '今日新增帖子', icon: 'TrendCharts', bg: 'linear-gradient(135deg, #00b4db, #0083b0)' }
]

// 总览统计数据
const overview = ref({})
// 趋势数据
const trendData = ref([])

// 图表配置
const chartOption = computed(() => ({
  tooltip: {
    trigger: 'axis'
  },
  legend: {
    data: ['新增帖子', '新增用户']
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trendData.value.map((item) => item.date)
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: '新增帖子',
      type: 'line',
      smooth: true,
      data: trendData.value.map((item) => item.postCount)
    },
    {
      name: '新增用户',
      type: 'line',
      smooth: true,
      data: trendData.value.map((item) => item.userCount)
    }
  ]
}))

// 加载总览数据
const loadOverview = async () => {
  try {
    overview.value = await getOverview()
  } catch (err) {
    console.error(err)
  }
}

// 加载趋势数据
const loadTrend = async () => {
  try {
    trendData.value = await getTrend(7)
  } catch (err) {
    console.error(err)
  }
}

onMounted(() => {
  loadOverview()
  loadTrend()
})
</script>

<style lang="scss" scoped>
.dashboard {
  .stat-row {
    margin-bottom: 16px;
  }

  /* 统计卡片 */
  .stat-card {
    margin-bottom: 16px;
    border: none;

    :deep(.el-card__body) {
      padding: 0;
    }

    .stat-card-inner {
      display: flex;
      align-items: center;
      padding: 20px;
      border-radius: 4px;
      color: #fff;

      .stat-icon {
        font-size: 40px;
        margin-right: 16px;
        opacity: 0.9;
      }

      .stat-content {
        flex: 1;
        text-align: center;

        .stat-number {
          font-size: 26px;
          font-weight: 600;
          line-height: 1.2;
        }

        .stat-title {
          font-size: 13px;
          margin-top: 4px;
          opacity: 0.9;
        }
      }
    }
  }

  /* 趋势图表卡片 */
  .chart-card {
    margin-top: 16px;

    .chart {
      width: 100%;
      height: 400px;
    }
  }
}
</style>
