# 问题与风险记录（agent_memory）

> 2026-08-10 全项目只读审查结论（详细见 code-review-report.html）。

## P0（4 项，全部已修复 2026-08-10）
1. ✅ comment 云函数调用不存在的 checkCommentRateLimit → 评论功能不可用
   - 修复：shared/guard.js 新增 DB 版限频 + 导出；sync-shared 同步 19 副本
2. ✅ post.detail refDetail 未脱敏 → 泄露失物招领联系方式明文
   - 修复：refDetail 删除 contact/openid/publisher.openid
3. ✅ admin-server 登录密码明文写入操作日志，operator 角色可读
   - 修复：operationLogger 对 request_body 递归脱敏敏感字段
4. ✅ 身份体系：token 即 openid 明文，且他人 openid 下发客户端
   - 修复（对外泄露面）：enrichAuthors 加 author.userId(users._id) 并删 _openid/authorId；
     comment isMine + 删 replyTo.userId；lostfound/delivery 返回 isOwner 等权威字段 + publisher.userId；
     block 支持 targetUserId；order/notify 脱敏；客户端全链路适配
   - 保留项：login 返回 token=openid 仍为伪登录态（云函数鉴权基于 WXContext，非可利用漏洞；属架构债，见 SUG）

## P1（重点风险摘录，未修）
- post.checkImages 无鉴权可越权隐藏他人帖子/下载任意云文件
- order.updateStatus 商家可改任意订单、无状态机校验；order.create 信任客户端金额
- 接单 TOCTOU 并发竞态可重复接单；initDB/migrate 按 _openid 查询永远 403
- admin-server：CORS 数组配置失效、登录无防爆破、错误信息泄露、MySQL 适配器多处不一致、默认密码 password123
- admin-web：token 存 localStorage、刷新后用户信息丢失、前端无角色权限、详情页路由复用不刷新
- 小程序：下单金额客户端计算、购物车跨分类丢商品、退出登录自动重登

## 部署提醒
- 云函数改动需重新部署：comment/post/lostfound/delivery/block/order/notify/user（login 未改，但 guard 变更涉及）
- 小程序端改动需重新编译上传

---

## UX 审计报告核验与修复（2026-10-11，P0+P1 均已落地）

### P0（2 项，均已于 2026-10-11 修复 ✅）
1. ✅ **编辑帖子绕过图片审核**：`cloudfunctions/post/index.js` handleUpdate 仅校验图片归属，未调用 `imageCheck`。
   - 修复：抽出公共 `auditImages(images, tag)`（:196-218），create(:383) 与 update(:969-979) 共用；update 仅审核新增/变更 fileID（差集），违规即拒绝。已部署并下载线上代码包核对通过。
2. ✅ **详情页加载失败永久空白**：`post/detail`、`delivery/detail`、`lostfound/detail`、`user/edit` 共 4 页均无错误态/重试。
   - 修复：四页统一 `loadError/loadErrorText` + 错误占位 + `onRetry`；样式收敛至全局 `styles/mixins.wxss` 的 `.load-error` 系列。**小程序端待重新编译上传**。

### P1 — 合规/正确性（4 项，3 项已修 ✅ / 1 项按业务下线跳过 ⏭️）
3. ✅ **收藏列表**：`cloudfunctions/favorite/index.js` handleList 缺 `enrichAuthors` + 图片 URL 转换 + 点赞状态，且原样返回 `_openid`/`authorId`。
   - 修复：补齐三件套 —— `enrichAuthors(list)`（内置删 `_openid`/`authorId`）+ `resolveCloudImages(list)` + 新增本地 `fillLikedStatus(list, openid)`。已部署核验。
4. ⏭️ **接单 TOCTOU**：`cloudfunctions/delivery/index.js` handleAccept 仍为先 `doc().get()` 校验再无条件 update。
   - **跑腿业务已取消隐藏/下线，按用户指令跳过**；若后续彻底移除 delivery，此条自动消失。
5. ✅ **msgSecCheck v1**：`shared/guard.js` 未传 openid/scene/version；post/comment 对审核错误 fail-closed。
   - 修复：`contentCheck(content, openid, scene)` 升级 **v2 优先**（发帖/招领 scene=3、评论=2、资料=1），按 `result.suggest` 判定（risky/review 不放行）；**v2 失败自动降级 v1**；`87014` 在 v1/v2 catch 中均判为「内容违规」。**18 份副本已手工同步并 hash 核验一致**，`schema.js` 未触碰。
6. ✅ **审核异常误报违规**：`lostfound/index.js`、`delivery/index.js` 未区分 `textResult.error`。
   - 修复：lostfound 已补 `if (textResult.error) → '内容审核服务异常，请稍后重试'`（与 post/comment 对齐）；delivery 侧按业务下线跳过。

### P1 — 体验（8 项，除跑腿外全部修复 ✅）
7. ✅ 登录 redirect：`goHome()` 三级优先级（`redirect` 参数 → 栈中有上一页则 `navigateBack` → `switchTab` 首页）+ 新增 `navigateToRedirect()` 区分 Tab/非 Tab
8. ✅ token 过期自动恢复：`api/interceptor.js` 新增 `recoverAuth()`，识别 2001/2003 → 清会话 → 静默重登 → 重放一次；带重入锁、尊重「主动退出」、惰性 require 规避循环依赖
9. ✅ 消息页通知分页：`loadNotifications(reset)` 支持追加 + `onLoadMore`（bindscrolltolower）+ 「加载更多 / 没有更多」页脚
10. ✅ 下拉刷新死代码：post/favorites、setting、lostfound/index 三页改走 scroll-view `refresher-enabled`，移除失效 `onPullDownRefresh`/`stopPullDownRefresh`（跑腿大厅跳过）
11. ✅ 消息页失败误显空态：新增 `loadError` + `onRetryNotify`，空态条件补 `!loadError`
12. ✅ 失物招领 onShow：改为「脏标记 + 30s 节流」，监听发布页 `refreshLostfound` 事件
13. ✅ 失物招领 clientId：前端按内容签名复用 + 服务端 `where({_openid, clientId})` 预查去重（跑腿跳过；未改 schema.js）
14. ✅ 上传无进度：`cloudAdapter.upload` 透传 `onProgressUpdate`，`uploadImages` 合成整体百分比；新增**按本地路径的已上传缓存**（重试仅重传失败项）+ `clearUploadCache()`
15. ⏭️ 订阅消息推送：**按用户决策跳过**（需小程序后台申请评论/点赞/收藏模板 ID；无模板时写 `send` 只会产生静默失败的无效代码）

### 已修复但报告未更新（勿重复修）
P0-1 轮询遮罩、P0-5 跑腿刷新事件、P0-6 点赞登录引导、P1 登录页返回按钮、P1 notify.markRead loading
### 描述与代码不符
P0-3 imgSecCheck 实为 fail-closed（pass:false）；发帖草稿机制本已存在（缺口是缺 onUnload 自动保存，已于 2026-10-11 补）；主包实测 1.726MB 且无 .DS_Store

### 本轮新发现（未修，需决策）
- **`cloudfunctions/user/config.json` 的 `openapi` 为空数组**，但 `user.updateProfile` 会调用 `msgSecCheck` 审核昵称/简介：
  权限缺失时调用必然抛错 → 命中代码里的 `result.error` 分支被静默跳过 → **昵称/简介审核实际从未生效**（fail-open）。
  本轮**未擅自加权限**（加权限会让资料审核真正生效，属行为变更，需产品确认）。
- **CloudBase MCP 部署链路不写 `permissions.openapi`**：`getFunctionDetail` 不返回该字段，函数详情中无权限信息；
  `config.json` 的权限声明实际由**微信开发者工具上传**时才生效。后续用 MCP/CLI 部署时需另行确认权限是否已按预期下发。

---

## 新增风险：内置 button 默认宽度 184px 全站性覆盖（2026-10-11，登录页已修，其余未修）

**机制**：`app.json` `"style":"v2"` 注入 `button:not([size='mini']) { width:184px; min-height:40px; margin:0 auto }`，
权重 (0,1,1) > 单类选择器 (0,1,0)，凡用 `width` 自定义按钮宽度的页面都会悄悄退化为 184px 居中。

**已在登录页修复**（`.profile-card .avatar-btn` / `.login-actions .login-btn`，权重 0,2,0）。

**其余同类隐患（仅记录，未修）**：
- `pages/user/verify/index.wxss:145` `.verify-btn { width: 100% }` → 认证页提交按钮同样只有 184px 宽
- `pages/user/edit/index.wxss:42` `.avatar-btn { width: 160rpx }` → 编辑资料页头像同样会变椭圆
- `pages/post/detail/index.wxss:252` `.detail-actions__item` 未设 width（用 padding），不受影响

**根治选项（二选一，需用户决策）**：①移除 `app.json` 的 `"style": "v2"`（一次性，但会改变所有内置组件默认样式，需整体复验）；
②逐页把按钮宽度规则的选择器权重提到 ≥(0,2,0)（改哪验哪，无副作用）。

---

## 「我的」页与界面完整性复核（2026-10-11 首轮发现 → 修订状态见行内标注）

1. **账号注销无功能入口**：全站搜索「注销」只命中协议文本，无任何页面与云接口；而三份协议都已承诺「可申请注销」，
   且承诺的唯一渠道「设置 → 联系客服」当前未接通（`setting/index.js` `WORK_WX_CORP_ID = ''`，
   `agreement/index.js` `CONTACT_EMAIL = ''`）→ **协议承诺与实现不闭环**（UGC 类小程序审核常见关注点）。
2. ~~**「我的帖子」不区分内容类型**~~ → **✅ 已修复（2026-10-11）**：
   `handleMyPosts` 增加 `module` 筛选（community 用 `nin` 兼容无 module 字段的历史帖），已部署并核对配置；
   「我的帖子」页用 `feed-tabs` 增加 类型 Tab（全部/社区/失物招领，跑腿已下架故不设该 Tab）、
   非社区内容加类型标签、长按菜单对非社区内容改为提示到对应详情页。
   注：`shared/schema.js` 与 `cloudfunctions/post/shared/schema.js` 均已补 `module` 字段声明
   （`validate()` 本就不拒绝未知键，故前端先发后部署也不会报错，属可灰度顺序）。
3. ~~**跑腿代拿在界面上完全不可达**~~ → **✅ 已按业务决策整体下架（2026-10-11）**：
   **界面全删**——`pages/delivery/`（12 文件）+ `api/modules/delivery.js` + `images/icons/delivery.png`，
   并清理 `app.json`（分包 + preloadRule）、`api/index.js`、`utils/route.js`、帖子详情兜底重定向、
   消息跳转映射、发布中心选项与三份协议文档中的相关表述。
   **保留**：云函数 `delivery`、shared 常量与 admin 举报目标枚举（后端/数据层未动）。
   已核验线上 `posts.module='delivery'` 与 `notifications.refType='delivery'` **均为 0 条** → 无死链风险。
4. **无意见反馈 / 帮助入口**：全站无「意见反馈 / 帮助中心」，当前唯一可用反馈通道是内容「举报」入口。
5. **「同校」排序为确定性死路**：`pages/feed/index.js` `onSortChange` 命中 `school` 直接 toast「同校功能开发中」
   （用户可稳定复现的占位）。
6. **无分享 / 邀请入口**：仅 `post/detail` 实现 `onShareAppMessage`，无 `onShareTimeline`、无「邀请同学」入口。
7. **「我的」页统计口径偏窄**：统计条仅「帖子 / 收藏」；获赞数、失物招领发布数未聚合（需后端聚合）。

---

## ✅ 已修复：「任意界面随时提示登录失效」（2026-10-11 14:35）

**根因（两条竞态叠加）**
1. 服务端 `user.handleLogin` **每次调用都无条件轮换 `sessionToken`**（`users` 上每用户单字段）→ **任何一次登录都立即作废其它正在使用的会话**。
2. 客户端 `app.onLaunch` 每次冷启动无条件 `auth.login()`，`app.onShow` 在本地无 token 时（首启/清缓存/存储回收）会再**并发**一次 → 后到的响应把**较旧 token 写回本地**。
3. 任一在途请求携带被作废 token → `isSessionValid` 的 `token !== stored` → **2001**。
4. 抛 2001 的只有 `user.getProfile` / `user.updateProfile`，而 `app.onShow → syncUserStatus` 每次切回前台都调 `getProfile` → **任意界面**弹提示。
5. 本地 token 仍在 → `checkLoginStatus` 认为已登录 → **不自动重登，故障持续**。
6. 「微信开发者工具 + 真机」共享同一 openid，互相轮换 token → 故表现为「随时」。

**修复**
- `cloudfunctions/user/index.js`：**仅在「无会话 / 已撤销 / 已过期」时签发新 token**，有效会话原样复用 + 30 天滑动续期（`needNewSession`）。
- `miniprogram/utils/auth.js`：`login()` 增加**在途任务去重**（`_loginTask`），并发登录共享同一 Promise。
- `miniprogram/api/modules/user.js` + `store/user.js`：`getProfile(opts)`；`syncFromServer()` 传 `{loading:false,silent:true}`（后台同步不再闪全屏 loading、失败不弹提示）。
- 兜底：`api/interceptor.js` 的 `recoverAuth` 遇 2001/2003 自动静默重登并重放。
- 已部署 `user`（Timeout 10 保持）+ 冒烟通过；真值表离线验证判定逻辑正确。

**遗留语义（非缺陷，待产品确认）**：`sessionToken` 仍是「每用户单会话」→ A 设备退出登录会作废 B 设备会话；
因有自动恢复，B 设备不再看到失效提示（静默重登）。如需真正多设备并行会话，需把 `sessionToken` 改为会话列表结构。

---

## 并发会话遗留问题（2026-10-11 14:32，仅记录，未处理）

1. **`shared/schema.js` 行尾符被写成 CRLF**（374 CRLF / 0 LF，17,500 字节），而仓库其余文件**全部为 LF**
   （对比：`cloudfunctions/*/shared/schema.js` 均为 LF）。会造成后续 diff 显示整文件变更。
   **未擅自规范化**（该文件正被并发会话编辑，避免冲突）；如需修复：把 CRLF 转为 LF 即可（内容不变）。
2. **`schema.js` 的 `module` 声明只同步到 根 + post 两份**，其余 16 份副本（`7a5b7ce3`，彼此一致）**未同步**。
   功能上无影响（`validate()` 只遍历已声明字段、不拒绝未知键；且 `post.myPosts` 仅 post 使用），
   但违反了「shared/ 改动须同步全部副本」的工程约定，后续需补齐或明确豁免。
3. **`patch`：跑腿前端已整体下架**（`pages/delivery/`、`api/modules/delivery.js`、`images/icons/delivery.png` 已删，
   `app.json`/`api/index.js`/`utils/route.js`/`post/detail` 兜底重定向/消息跳转映射/协议文档均已清理；
   云函数 `delivery` 与 shared 常量保留）。
   → 影响：2026-10-11 P0-4 对 `pages/delivery/detail` 的错误态修复**随文件删除而失效**（非缺陷，
   原本也因业务下架被跳过）；已核验全站无 `pages/delivery` 死链。

---

## 管理后台 ↔ 前端连接性排查（2026-10-11，只读，未改代码）

**结论**：配置层与数据层**全部正确**，线上链路实测通畅；但管理后台**前后端依赖均未安装**，
两端当前都起不来 → 「实际连接」处于不可用状态。

### 阻塞级（✅ 已解决 2026-10-11 14:45，用户确认后执行）
1. ~~**`admin/admin-server/node_modules` 与 `admin/admin-web/node_modules` 均不存在**~~
   - `Change/` 快照同样没有（`node_modules` 未随目录复制），故非误删
   - 后果：`npm start` / `npm run dev` 均无法启动；`netstat` 确认 **3000 / 5173 / 5174 全无监听**
   - **已修复**：两侧各执行 `npm install`（锁文件 resolved 的 host 临时换为 `registry.npmmirror.com` 以绕开
     本机不可达的 `registry.npmjs.org`，**安装后已改回原样并校验：server 153 / web 157 处 npmjs.org，残留 0**）
   - 体积：`admin-server` 14MB + `admin-web` 200MB = **213MB**（均在 C 盘）
   - **踩坑**：`admin-web` 首次安装失败（`esbuild` postinstall 报 spawn 错误），根因是
     `@esbuild/win32-x64@0.21.5` 平台包未装上 → 补装该包后 `esbuild --version` 与 `vite` 均正常
   - **实测结果（全部通过）**：
     - `node src/app.js` 启动成功 → 3000 LISTENING；`npm run dev` → 5173 LISTENING
     - `POST /api/auth/login`（admin + 错误密码）→ `{"code":2001,"message":"用户名或密码错误"}`（说明云库查询已执行）
     - 参数校验 → `{"code":1002,"message":"[password] 不能小于 6"}`
     - CORS 预检（Origin: 5173）→ `204` + `Access-Control-Allow-Origin: http://localhost:5173` ✓
     - **vite 代理链路**：`POST http://localhost:5173/api/auth/login` → 正确转发至 3000 → 返回后端响应 ✅
     - 服务端日志无云 API 错误（无 `40001`），`GET /api/auth/profile` 无 token → `code:2001` ✓

### 配置级
2. **`admin-web/.env.production` 的 `VITE_API_BASE_URL` 仍是占位符**
   `https://your-admin-server-domain.com/api` → 生产构建后前端指向不存在的域名（开发环境不受影响，
   开发走 `.env.development` 的 `/api` + vite 代理 → `localhost:3000`）
3. **`admin-server/package.json` 的 `seed` 脚本指向不存在的文件**
   声明 `node src/scripts/seed.js`，实际只有 `src/scripts/seedAdmin.js` → `npm run seed` 必失败
4. `package.json` 同时声明 `koa-cors`（旧）与 `@koa/cors`（实际使用）→ 冗余依赖，非故障

### 已验证正常（无需处理）
- `admin-server/.env`：`WX_APPID=wxff1bceceece875dc` / `WX_ENV_ID=cloudbase-d3gavr3qt88b7c734` 均为新环境 ✓
- `WX_SECRET` 实测可换取 `access_token`（`expires_in:7200`）→ 凭证有效 ✓
- 云环境 HTTP API 实测：`databasequery` / `databasecount` / `databasecollectionget` 全部 `errcode:0`
  → **18 个集合**、`users` 2 条、`posts` 3 条、`admin_users` 1 条、`config` 2 条
- `admin_users` 记录：`username=admin`、`role=super_admin`、`status=active`、`password_hash` 为 bcrypt ✓
- 小程序端 `miniprogram/api/config.js` `CLOUD_ENV` 已指向新环境 ✓
- `project.config.json` `appid` 已为新值 ✓
- 旧 AppID `wxc0529e7432219786` / 旧环境 `cloud1-d6gf5p5th3ecf8315` **仅存在于文档**
  （`context.md` / `PROGRESS.md` / `迁移手册.md`），代码与配置**零残留** ✓
- `shared/errors.js` 存在 → `AuthService` 的 `../../../../shared/errors` 引用有效 ✓
- `admin-web/src/styles/variables.scss` 存在 → vite `additionalData` 引用有效 ✓
- `CORS_ORIGIN=http://localhost:5173,http://localhost:5174` 与 vite 默认端口一致 ✓

> 文档待更正：`agent_memory/context.md` 与 `PROGRESS.md` 仍写旧环境 `cloud1-d6gf5p5th3ecf8315`，
> 与迁移后的实际配置不符（本轮未改文档）。

---

## ✅ 已修复：「我的」页收藏统计显示 0（2026-10-11 14:50）

**现象**：收藏一个帖子后，在「我的 → 我的收藏」能看到该帖子，但「我的」页统计条的「收藏」数仍是 0。

**先核实数据面（重要）**：`favorites` 集合确有该记录；帖子的 `stats.favorites` 已正确 +1（=1）
→ **数据库本身一致**，问题在展示与统计口径。（用 `readNoSqlDatabaseContent` 实测确认）

**根因（三条叠加）**
1. **统计被 30 秒节流跳过**：`profile.onShow` 用 `_lastLoadTime` 节流 30 秒后才 `refreshUser()`（内含聚合统计）；
   而收藏动作（详情页 `onFavoriteTap`）**不发任何事件** → 收藏后返回「我的」（或从收藏列表返回）若不足 30 秒，
   统计直接跳过、屏幕保持旧值 0。收藏列表页无节流、每次都刷新 → 出现「列表有、统计 0」。
2. **失败被强制清零**：`loadAggregatedStats` 里 `favRes` 为 null 时落到 `: 0` → 一次静默失败即把统计写成 0；
   叠加此前会话失效期 `favorite.list` 返回 2001，且请求是 `silent:true` → 用户只看到数字变 0，无任何提示。
3. **`favorite.list` 的 total 口径错误**：`const total = list.length`（当前页「过滤后」条数）→ 收藏超过一页（20）后恒为 20。

**修复**
- `pages/post/detail/index.js`：收藏/取消收藏成功后 `eventBus.emit('favoritesChanged')`。
- `pages/profile/index.js`：`onLoad` 订阅 `favoritesChanged` 置 `_statsDirty`，`onUnload` 解绑；
  `onShow` 中**脏标记优先于节流** → 立即 `loadAggregatedStats()`。
- `pages/profile/index.js`：统计改为**仅在请求成功时覆盖数值**（`patch` 写法），失败保留上次值。
- `cloudfunctions/favorite/index.js` handleList：`total` 改为 `db.collection('favorites').where({_openid}).count()`
  （走索引）；`hasMore` 仍按 `favList.length === pageSize` 判断，分页不受影响。
- 已部署 `favorite`（Timeout 10 保持）+ 冒烟通过。

**附带核实**：同一统计条的「帖子」数走 `post.myPosts` 的 `count()`，口径正确；
管理后台 `StatsService.getOverview()` 只有 users/posts/comments/reports 四项、**不含收藏统计** →
本次问题不在后台。CLS 日志服务未开通（`topic not exist`），无法取函数执行日志。

**遗留说明（非缺陷）**：`total` 采用「收藏记录数」语义，故帖子被删除后其收藏仍计入总数
（列表会过滤掉该条）→ 可能出现「统计 2、列表 1」。若要与列表严格一致需遍历全部收藏校验帖子存活，成本较高，暂不采用。

---

## ✅ 已修复：帖子详情页「评论点赞」报操作失败（2026-10-11 16:40）

**现象**：详情页给评论点赞，弹「操作失败」（帖子点赞正常）。

**根因**：`shared/schema.js` 里**所有承载 ID 的字段 `maxLength` 都是 64**，而本项目用确定性长 ID：
- `comment._id` **实测 115 字符** = `comment_<openid>_post_<postId>_c_<ts>_<rand>`
- `notifications._id` 122 字符；`reportId` 151 字符 = `'report_' + openid + '_' + targetId`

`like` 云函数入口即 `validate(event, SCHEMAS['like.toggle'])` → 抛
**「参数 targetId 长度不能超过 64」**（code 1002）→ 前端 catch 统一提示「操作失败」。
帖子点赞正常是因为 `post._id` 只有 **53** 字符，恰好过关。

**同一根因影响共 6 条链路**（全部一并修复）：
| 链路 | 字段 | 实际长度 |
|---|---|---|
| 评论点赞（用户报障） | `like.toggle.targetId` | 115 |
| 回复评论（楼中楼） | `comment.create.parentId` | 115 |
| 删除评论 | `comment.delete.commentId` | 115 |
| 举报评论 | `report.create.targetId` | 115 |
| 标记通知已读 / 删除通知 | `notify.markRead` / `notify.delete.notificationId` | 122 |
| 后台处理举报 | `moderation.resolveReport.reportId` | 151 |

**修复**：把 5 个承载确定性长 ID 的字段上限 64 → **256**（`commentId` / `parentId` / `targetId` /
`notificationId` / `reportId`），共 7 处 × 18 份副本 = 126 处；`SCHEMAS` 顶部加注释说明取值依据。
**刻意不动** `postId(53)` / `userId(33)` / `openid(28)` / `clientId` / `conversationId` / `taskId` /
lostfound 的 `id` —— 它们承载短 ID 或非 DB id，64 是合理业务约束。
顺带把根 `shared/schema.js` 的 **CRLF 行尾规范化为 LF**（此前被并发会话写成 CRLF，与其余 17 份不一致）。

**验证**
- 用真实 115 字符评论 ID 跑 `validate()`：修复后 7 条链路全部「通过」；
  **反证**：把上限改回 64 → 重新报「参数 targetId 长度不能超过 64」，与用户所见一致；
  越界反例（300 字符）仍被正确拦下 → 校验未被削弱。
- 部署 `like` / `comment` / `report` / `notify`：Timeout 保持 **10 / 15 / 10 / 10**；冒烟全部 `code:1002` 无 ErrMsg。
- 下载线上 `like` 代码包核验 `shared/schema.js`：5 个字段均为 256，`openid` 仍为 64（未误放宽）。

**工程约定（新增）**：**凡承载数据库 `_id` 的 schema 字段，上限用 256，不要写 64** —— 本项目的
确定性 ID 普遍超过 64，写 64 会在参数校验层静默拦下接口。

### 同功能的第二个缺陷（已修）：评论点赞数永远显示 0

排查上述报障时发现：**点赞计数写入字段与读取字段不一致**。
- 写入端：`like` 云函数对帖子/评论**统一**递增目标文档的 `stats.likes`。
- 读取端：`components/comment-item/comment-item.js:55` 读的是 `comment.likeCount`，
  而该字段只在 `comment.create` 时写死为 `0`，此后无人递增。
- 后果：即使点赞成功（图标点亮、乐观 +1），**刷新页面后计数又回到 0**。

**修复**：`cloudfunctions/comment/index.js` 的 `handleList` 中补映射 ——
以 `stats.likes` 为准回填 `likeCount`（无 `stats.likes` 时回退历史 `likeCount` 值）。已部署（Timeout 15）。
题外：`likes` 记录与 `like.batchCheck` 均正常（`targetIds` 是数组，只校验元素个数不校验元素长度），
所以点赞**状态**（图标亮/灭）一直是对的，只有计数与「点击」受影响。

---

## ✅ 已修复：编辑帖子后照片消失 + 新增照片不生效（含数据丢失）（2026-10-11 17:05）

**现象**：发布带图帖子正常；点「编辑帖子」后照片消失；再添加照片也不显示。

**根因（两个问题叠加）**
1. `pages/post/publish/index.js` 的 `loadPostForEdit()` 里 `setData` **只回填了板块/标题/正文/标签，
   完全没有 `images`** → 编辑页图片区渲染空数组，照片「消失」。
2. `this._editingImages = post.images.filter(u => u.indexOf('cloud://') === 0)` —— 但 `post.images`
   已被服务端 `resolvePostImages()` **就地**转成 HTTP 临时链接，过滤结果为**空数组**；
   提交时 payload 用 `images: this._editingImages` → **保存会用 `[]` 覆盖原帖图片（静默清空全部照片）**。
3. 编辑模式下 `<上传>` 被 `(!isEdit && images.length)` 直接跳过 → 新选照片既不上传也不进 payload。

**修复**
- 后端 `cloudfunctions/post/index.js` `handleDetail`：在 `resolvePostImages` 执行**之前**
  快照原始 `post.images`；`isOwner` 时额外下发 `imageFileIds`（**仅作者**，避免暴露他人帖子的存储路径）。
- 前端 `pages/post/publish/index.js`：
  - `loadPostForEdit` 现在会 `setData({ images })` 回显，并建立 `_imageFileIdByUrl`（显示链接 → 原始 fileID）。
  - 提交时按当前展示顺序合成最终列表：**原图走映射原样回传、新选图片才上传**；
    并让编辑模式的**增删图片真正可用**。
  - `_uploadedImageUrls`（失败时清理孤儿图片）收窄为**仅本次新上传的 fileID** —— 原帖图片绝不能被删。
- 服务端 `handleUpdate` 本就支持增删（只把「相对原帖新增的 fileID」送审；归属校验 `ownerKeys=[openid, uploadKey]`
  覆盖新老存储路径），因此本次无需改它。

**数据核对**：用户那条 9 图帖（「迪士尼」）库中 `images` 仍是 **9 个 `cloud://` fileID**、`type: 'image'`
→ **此前编辑均未成功保存，数据未丢失**。

**部署/验证**：已部署 `post`（Timeout **30 保持**）；线上代码含 `rawImageFileIds`(3) 与 `result.imageFileIds`(1)；
冒烟 `code:1002` 无 ErrMsg。`publish/index.js` 前端改动**需微信开发者工具重新编译上传**。

**教训**：云函数里对详情对象做「就地转换」（如 fileID → 临时 URL）时，若同一份数据还要回传给客户端做「原样回传」，
必须**在转换前快照原始值**，否则会丢掉不可逆的原始标识。

---

## ✅ 已修复（并行会话，已核验）：帖子图片上下裁切（2026-10-11 17:03）

**现象**：一张近似 1:1 的帖子图片，在「帖子详情页」和「首页信息流卡片缩略图」都被裁掉上下，无法完整显示。

**根因**：两处容器都是「宽 > 高」的非正方形，且图片用 `aspectFill`（填满即裁切）：
- 详情页单图：固定 `480×360`（4:3）+ `aspectFill` → 1:1 图被裁掉约 25% 高度
- 信息流卡片单图缩略图：`180×140` + `aspectFill` → 1:1 图被裁掉约 22% 高度

**修复（17:03:54 落盘，与用户截图 17:02 仅差 1 分钟）**
- `pages/post/detail/index.wxml` + `.wxss`：单图改 `mode="widthFix"`（`width:100%; max-width:480rpx; height:auto`）
  → 高度按原图比例自适应，完整显示
- `components/post-card/post-card.wxml` + `.wxss`：单图缩略图改 `mode="aspectFit"`（容器 180×140 不变）
  → 完整显示整张图，留白用页面底色填充

**已核验**：两处 wxml 的 mode 与 wxss 容器均确认正确；并复查了全项目 20 处 `aspectFill` ——
其余内容缩略图容器都是**正方形**（发现页 120×120、失物招领 120×120、我的帖子 160×160、发布预览 200×200），
方图不会被裁；其余 `aspectFill` 用于头像 / banner / 隐藏帖封面，本就应该裁切。**无遗漏。**

**待人工**：纯前端改动，**需微信开发者工具重新编译**后才能看到效果（用户截图 17:02 早于修复落盘 17:03，
看到的是旧构建）。
