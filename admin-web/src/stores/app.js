/**
 * 应用全局 Store
 * 管理布局相关状态（侧边栏折叠等）
 */
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    // 侧边栏是否折叠
    sidebarCollapsed: false
  }),

  actions: {
    /**
     * 切换侧边栏折叠状态
     */
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
    }
  }
})
