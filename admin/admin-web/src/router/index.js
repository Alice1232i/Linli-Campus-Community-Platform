/**
 * 路由配置
 * - 使用懒加载
 * - 嵌套路由：dashboard/posts/comments/users/reports/verifications/logs 作为 AdminLayout 的 children
 * - 导航守卫：基于 token 控制访问权限
 */
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// token 在 localStorage 中的键名
const TOKEN_KEY = 'admin_token'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '仪表盘' }
      },
      {
        path: 'posts',
        name: 'PostList',
        component: () => import('@/views/post/List.vue'),
        meta: { title: '帖子管理' }
      },
      {
        path: 'posts/:id',
        name: 'PostDetail',
        component: () => import('@/views/post/Detail.vue'),
        meta: { title: '帖子详情' }
      },
      {
        path: 'comments',
        name: 'CommentList',
        component: () => import('@/views/comment/List.vue'),
        meta: { title: '评论管理' }
      },
      {
        path: 'users',
        name: 'UserList',
        component: () => import('@/views/user/List.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'users/:id',
        name: 'UserDetail',
        component: () => import('@/views/user/Detail.vue'),
        meta: { title: '用户详情' }
      },
      {
        path: 'reports',
        name: 'ReportList',
        component: () => import('@/views/report/List.vue'),
        meta: { title: '举报中心' }
      },
      {
        path: 'reports/:id',
        name: 'ReportDetail',
        component: () => import('@/views/report/Detail.vue'),
        meta: { title: '举报详情' }
      },
      {
        path: 'feedbacks',
        name: 'FeedbackList',
        component: () => import('@/views/feedback/List.vue'),
        meta: { title: '意见箱' }
      },
      {
        path: 'verifications',
        name: 'VerificationList',
        component: () => import('@/views/verify/List.vue'),
        meta: { title: '认证审核' }
      },
      {
        path: 'logs',
        name: 'LogList',
        component: () => import('@/views/log/List.vue'),
        meta: { title: '操作日志' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/error/404.vue'),
    meta: { public: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 全局前置守卫
router.beforeEach(async (to, from, next) => {
  const token = localStorage.getItem(TOKEN_KEY)
  const authStore = useAuthStore()
  // 已登录访问登录页 -> 跳转到首页
  if (to.path === '/login' && token) {
    return next('/')
  }
  // 未登录访问非公开路由 -> 跳转登录页
  if (!token && !to.meta.public) {
    return next('/login')
  }
  // 已登录但尚未加载用户信息（刷新页面场景）-> 静默恢复，token 失效则转登录
  if (token && !authStore.userLoaded) {
    try {
      await authStore.loadUser()
    } catch (e) {
      // getProfile 失败（token 无效/过期）时 loadUser 内部已清理登录态
      if (!authStore.token) {
        return next('/login')
      }
    }
  }
  // 其他情况放行
  next()
})

export default router
