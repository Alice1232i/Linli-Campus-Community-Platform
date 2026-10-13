# 临里校园 · Linli Campus

> 面向高校的校园社区与生活服务平台 —— 微信小程序 + 微信云开发 + Vue 3 管理后台

「临里校园」是一个以学生为中心的校园社区产品。小程序端提供社区发帖、失物招领、跑腿代拿、消息通知与用户认证等能力；服务端基于微信云开发的 Serverless 云函数；另配套一套 Vue 3 管理后台，用于内容审核、用户管理与运营数据查看。

---

## 功能概览

### 小程序端
- **社区**：9 大板块发帖 / 信息流分页 / 帖子详情 / 点赞 / 收藏 / 评论 / 搜索
- **失物招领**：丢失与拾获两类信息，支持发布、详情、定位选点
- **跑腿代拿**：任务的发布、接单与状态流转
- **消息通知**：点赞 / 评论 / 收藏 / 关注 / 订单 / 系统 / 举报 多类型通知
- **用户体系**：微信登录、学生认证、资料编辑（学院 / 专业 / 届数联动）、拉黑、举报、意见反馈
- **内容安全**：文本与图片安全检测（先审后发）

### 管理后台
仪表盘、帖子管理、评论管理、用户管理、举报中心、认证审核、意见箱、操作日志。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 小程序前端 | 微信原生小程序（WXML / WXSS / JS），Skyline 渲染器 + glass-easel，自定义 tabBar，分包 + 预加载 |
| 服务端 | 微信云开发 Serverless 云函数（`wx-server-sdk`），按模块拆分，`shared/` 共享层 |
| 数据存储 | 微信云数据库（NoSQL）；管理后台亦支持 MySQL |
| 管理后台前端 | Vue 3 + Vite + Element Plus + Pinia + Vue Router + ECharts |
| 管理后台服务端 | Koa 2 + koa-router，JWT 鉴权、bcryptjs、mysql2，双数据库适配器 |
| 工程脚本 | Node.js 共享层同步脚本、云函数批量部署脚本（bash） |

---

## 目录结构

```text
linli/
├─ miniprogram/               # 微信小程序前端
│  ├─ api/                    # API 聚合层：adapter（云开发/HTTP 可切换）+ modules（业务模块）
│  ├─ components/             # 自定义组件（帖子卡片、评论项、导航栏、图片上传等）
│  ├─ custom-tab-bar/         # 自定义底部 TabBar
│  ├─ images/                 # 图标与横幅资源
│  ├─ pages/                  # 主包与分包页面
│  ├─ store/                  # 轻量状态管理（user / badge / eventBus）
│  ├─ styles/                 # 全局样式变量与 mixins
│  ├─ utils/                  # 工具函数（auth、上传、格式化、路由、隐私等）
│  │  └─ shared/              # 共享层副本（由脚本同步，勿直接改）
│  ├─ app.js / app.json / app.wxss
│  └─ sitemap.json
├─ cloudfunctions/            # 微信云函数（服务端）
│  ├─ post/                   # 帖子
│  ├─ comment/                # 评论
│  ├─ user/                   # 用户
│  ├─ like/ favorite/         # 点赞 / 收藏
│  ├─ lostfound/ delivery/    # 失物招领 / 跑腿代拿
│  ├─ notify/                 # 消息通知
│  ├─ report/ block/          # 举报 / 拉黑
│  ├─ verify/                 # 学生认证
│  ├─ feedback/               # 意见反馈
│  ├─ moderation/             # 内容安全
│  ├─ common/                 # 通用配置与定时归档
│  ├─ initDB/ initAdmin/ migrate/  # 初始化与迁移
│  └─ <各函数>/shared/        # 共享层副本（由脚本同步，勿直接改）
├─ admin/                     # 管理后台
│  ├─ admin-web/              # 前端（Vue 3 + Vite）
│  │  └─ src/{api,components,layouts,router,stores,styles,utils,views}
│  └─ admin-server/           # 服务端（Koa 2）
│     ├─ migrations/          # SQL 迁移脚本
│     └─ src/{adapters,config,controllers,db,middleware,repositories,routes,scripts,services,utils}
├─ shared/                    # 共享层「唯一编辑源」(SSOT)
│  ├─ constants.js            # 枚举、板块、学院/专业等常量
│  ├─ schema.js               # 参数校验 schema
│  ├─ guard.js                # 云函数统一包装：鉴权/校验/响应/安全检测
│  └─ errors.js               # 错误码定义
├─ scripts/
│  ├─ sync-shared.js          # 同步 shared/ 到小程序与各云函数
│  ├─ deploy-all-functions.sh      # 云函数批量部署（macOS）
│  └─ deploy-all-functions-win.sh  # 云函数批量部署（Windows / Git Bash）
├─ .eslintrc.js
├─ .gitignore
├─ project.config.json        # 小程序项目配置（appid、根目录）
└─ project.private.config.json
```

---

## 架构说明

### 三段式结构

```text
微信小程序 (miniprogram/)
        │  api/modules → api/adapter（cloud / http 可切换）
        ▼
云函数 (cloudfunctions/*)  ── 每个函数：index.js + config.json + package.json + shared/
        │  shared/guard.js 统一处理：登录态、参数校验、异常捕获、内容安全、统一响应
        ▼
微信云数据库 (NoSQL)
```

- **共享层 `shared/` 是唯一编辑源（SSOT）**：`constants.js` / `schema.js` / `guard.js` / `errors.js` 定义全员共用的枚举、校验规则与工具。修改后必须执行 `node scripts/sync-shared.js`，脚本会将其同步到 `miniprogram/utils/shared/` 以及每个云函数目录下的 `shared/`。
- **API 适配器**：小程序 `miniprogram/api/config.js` 中的 `USE_CLOUD` 可切换云开发适配器 / HTTP 适配器，业务页面无需改动。
- **管理后台独立服务**：`admin-server` 通过数据库适配器（`adapters/`）在「微信云数据库 HTTP API」与「自建 MySQL」之间切换，仅需修改环境变量 `DB_TYPE`。

### 统一响应格式

所有云函数与后台接口返回统一结构：

```json
{ "code": 0, "data": null, "message": "ok" }
```

`code` 为 `0` 表示成功，非 `0` 表示业务或系统错误（错误码见 [shared/errors.js](file:///c:/Users/Administrator/Desktop/linli%20-%20副本/shared/errors.js)）。

---

## 快速开始

### 1. 小程序端

1. 用微信开发者工具「导入项目」，选择仓库根目录（`project.config.json` 已指定 `miniprogramRoot: miniprogram/`）。
2. 在 [miniprogram/api/config.js](file:///c:/Users/Administrator/Desktop/linli%20-%20副本/miniprogram/api/config.js) 中填写自己的云开发环境 ID（`CLOUD_ENV`）。
3. 修改过 `shared/` 后，同步共享层副本：
   ```bash
   node scripts/sync-shared.js
   ```

### 2. 云函数

1. 在微信云开发控制台创建云环境，并开通所需开放接口权限（`security.msgSecCheck`、`security.imgSecCheck`、`subscribeMessage.send`）。
2. 初始化数据库与管理员账号：调用 `initDB`、`initAdmin`（迁移场景使用 `migrate`）。
3. 批量部署（macOS）：
   ```bash
   bash scripts/deploy-all-functions.sh
   ```
   Windows / Git Bash：
   ```bash
   bash scripts/deploy-all-functions-win.sh
   ```
   > 部署脚本使用微信开发者工具 CLI，需在「设置 → 安全设置」中开启「服务端口」。

### 3. 管理后台

**服务端 `admin/admin-server`：**

```bash
cd admin/admin-server
cp .env.example .env     # 填入实际配置
npm install
npm run dev              # 开发模式（nodemon）
npm start                # 生产启动
```

启动前会校验必填环境变量，缺失将直接报错终止。

**前端 `admin/admin-web`：**

```bash
cd admin/admin-web
npm install
npm run dev              # 本地开发（Vite）
npm run build            # 生产构建
```

---

## 环境变量

管理后台服务端通过 `.env` 读取配置，模板见 [admin/admin-server/.env.example](file:///c:/Users/Administrator/Desktop/linli%20-%20副本/admin/admin-server/.env.example)。**代码中零硬编码密钥**，请勿将 `.env` 提交到版本库。

```dotenv
# 服务
NODE_ENV=development
PORT=3000

# JWT
JWT_SECRET=your-super-secret-key-change-me
JWT_EXPIRES_IN=7d

# 数据库类型：cloud（微信云数据库）或 mysql（自建 MySQL）
DB_TYPE=cloud

# 微信云数据库（DB_TYPE=cloud 时必填）
WX_APPID=your-wx-appid
WX_SECRET=your-wx-secret
WX_ENV_ID=your-cloud-env-id

# MySQL（DB_TYPE=mysql 时必填）
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=linli_admin
MYSQL_CONNECTION_LIMIT=10

# 跨域与日志
CORS_ORIGIN=http://localhost:5173
LOG_RETENTION_DAYS=90
```

---

## 云函数清单

`cloudfunctions/` 下的实际业务函数（其余为占位空目录）：

| 云函数 | 职责 |
| --- | --- |
| `post` | 帖子：发帖、信息流、详情、删除、我的/他人帖子 |
| `comment` | 评论：发表、列表、删除 |
| `user` | 用户：登录、资料、认证、拉黑等 |
| `like` / `favorite` | 点赞 / 收藏 |
| `lostfound` | 失物招领 |
| `delivery` | 跑腿代拿 |
| `notify` | 消息通知 |
| `report` | 举报 |
| `block` | 拉黑 |
| `verify` | 学生认证 |
| `feedback` | 意见反馈 |
| `moderation` | 内容安全 |
| `common` | 通用配置、板块列表、点赞记录定时归档 |
| `initDB` / `initAdmin` / `migrate` | 数据库初始化、管理员初始化、数据迁移 |

> 部分函数通过 `config.json` 配置超时与定时触发器（如 `common` 的点赞归档定时任务）；部署后建议复核各函数超时配置。

---

## 安全与合规

- 内容安全：发帖/评论前经 `msgSecCheck` / `imgSecCheck` 审核，采用先审后发策略。
- 鉴权：管理后台 JWT + 基于角色的权限控制（`middleware/permission.js`）；后台所有写操作记录操作日志。
- 登录防爆破：服务端内置登录频率限制（`utils/loginRateLimit.js`）。
- 隐私：小程序声明 `scope.userLocation` 用途，页面内提供隐私协议与用户协议。

---

## 说明

- 本项目 `shared/` 为共享层唯一编辑源，请勿直接修改各目标目录下的副本。
- 本仓库未声明开源许可证（License）。
