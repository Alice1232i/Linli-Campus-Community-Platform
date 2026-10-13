# 项目上下文（agent_memory）

## 项目概述
- **项目名称**：临里校园（校园综合服务平台）
- **技术栈**：微信小程序原生（Skyline + glass-easel）+ 微信云开发 + 管理后台（Koa2 + Vue3/Element Plus）
- **云环境**：`cloud1-d6gf5p5th3ecf8315`
- **目录**：`miniprogram/`、`cloudfunctions/`（16 个云函数）、`admin/admin-server`、`admin/admin-web`、`shared/`、`audit-log-compliance/`
- **进度文档**：`PROGRESS.md`（项目自带）、`agent_memory/`

## 当前状态（2026-08-11）
- 4 项 P0 审查问题已全部修复（comment 限频、refDetail 脱敏、日志密码脱敏、openid 下发）
- 外卖功能（food/order）已整体移除：云函数 food/order、页面 pages/food|order、api/modules/food|order.js、
  app.json 分包与 preloadRule、shared 中 FOOD/ORDER_STATUS 与 food.*/order.* schema、initDB 集合、
  profile「我的订单」入口与统计、message 跳转映射均已清理；报告已同步（109 项问题）
- **跑腿代拿（delivery）已于 2026-10-11 整体下架**（小程序端界面已删除）：
  删除 `pages/delivery/`（12 文件）、`api/modules/delivery.js`、`images/icons/delivery.png`，
  并从 `app.json`（分包 + preloadRule）、`api/index.js`、`utils/route.js`、`pages/message` 跳转映射、
  发布中心选项、三份协议文档中移除引用。**仅删界面**：云函数 `delivery`、shared 常量
  （DELIVERY_STATUS / MODULES.DELIVERY / NOTIFY_TYPE.ORDER）、admin 举报目标的 delivery 枚举均保留，
  线上 `posts` 中 `module='delivery'` 记录为 0 条（已核验），故不会产生死链

## 关键事实
- shared/ 为 SSOT，改动后必须运行 `node scripts/sync-shared.js` 同步 17 个副本（16 云函数 + 小程序端）
  （**例外**：`shared/schema.js` 已分叉，post 版本更新，故当前禁止执行 sync-shared.js）
- 学校名录在小程序端 `miniprogram/utils/schools.js`（静态 MVP 名单，非 shared，无需同步）；
  本地存储键 `current_school_id`；shortName 约定 ≤4 字（导航栏 left 插槽可用宽 ≈78px）
- **文档类内容统一放 `pages/agreement/index`**（主包，避免为静态页新增包/页面）：
  `?type=agreement|privacy|about` 三份文档共用一页，页面内按 type 分支；版本/更新日期/联系邮箱为
  `pages/agreement/index.js` 顶部常量。**产品定位为「纯公益社区校园平台」**（不收费、无商业广告、
  不参与交易、数据不商用）；新增收费/广告/支付/定位或第三方 SDK 时必须同步更新这两份协议
- 云函数一律以 WXContext.OPENID 鉴权；对外标识改用 users._id（author.userId）
- 管理后台 Server 提供登录认证、帖子/评论/用户/举报/统计/操作日志接口
- **意见箱**：feedback 云函数（submit/listMine）→ `feedbacks` 集合 → admin `/api/feedbacks`
  （GET 列表 / PUT :id/handle / DELETE batch，权限码 `feedback:read|handle`）→ admin-web「意见箱」页；
  小程序入口在「我的」（pages/setting/feedback，setting 分包）。内容安全为「异常放行、违规拒绝」特例
- admin-server 以 node 直跑（端口 3000），改代码后需重启（kill 旧 PID + 后台 `node src/app.js`）
- **⚠️ 后台进程存活**：Bash 工具的 `run_in_background` 启动的常驻服务会在**该轮对话结束时被回收**
  （2026-10-11 实测：admin-server 8 分 52 秒后被杀，stderr 为空）。正确做法：
  `cmd //c "start /B node src/app.js > admin-server.out.log 2>&1"`（脱离会话的分离进程，已验证存活），
  日志落在 `admin/admin-server/admin-server.out.log`

## 验收方法（2026-10-11 建立）
- 本项目可在**无 IDE** 情况下做 9 项静态验收（inline node 脚本，无需新增文件）：
  JS 语法 / JSON 合法性 / WXML 配平（先剥 HTML 注释）/ WXSS 括号 + 真实 vh / app.json 注册页四件套 /
  usingComponents 目标存在 / WXML 组件是否已注册 / `/pages/*` 路由是否已注册 / `/images/*` 资源是否存在
- 删页面或分包后**必跑第 6/7/8/9 项**：能直接抓出死路由、未注册组件、丢失资源
- IDE 真实编译：`E:/RUANJIAN/微信web开发者工具/cli.bat preview --project <项目> --port 9420`
  —— 需 IDE 已启动且**服务端口已开启**（当前为关闭，属用户侧设置，勿擅自改）

## Skyline 渲染约定（踩坑结论，2026-10-11 实测）
- 页面根节点建立整屏高度必须用 `height: 100%`；`min-height:100%` / `min-height:100vh`
  在 Skyline 下不产生「确定高度」，子项 `flex:1` 分不到空间（表现为内容整体顶到上方）
- `app.json` 的 `"style": "v2"` 会注入内置 `button:not([size='mini']) { width:184px; min-height:40px; margin:0 auto }`，
  权重 (0,1,1) 高于任何单类选择器 `.xxx-btn` (0,1,0) → **按钮自定义宽度会被压成 184px 并居中**
  （圆形头像按钮因此变椭圆）。修复方式：用后代选择器把权重提到 (0,2,0)，或改内联 style；
  全局根治需移除 `"style":"v2"`（影响所有内置组件默认样式，未采用）
- 其他 Skyline 约束：不支持 `vh` 单位；页面高度链统一 `height:100% + flex`
