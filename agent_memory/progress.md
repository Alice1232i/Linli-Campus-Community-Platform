# 当前任务进度（agent_memory）

## 任务：项目完整预览审查 + HTML 报告（2026-08-10）
- [x] 全项目只读审查，生成 code-review-report.html（115 项问题）
- [x] 修复 P0-1：comment 云函数缺失 checkCommentRateLimit
- [x] 修复 P0-2：post.detail refDetail 未脱敏泄露联系方式
- [x] 修复 P0-3：admin-server 登录密码明文落操作日志
- [x] 修复 P0-4：身份体系 openid 下发泄露（服务端权威字段 + 脱敏 + 客户端适配）

## P0 修复记录（2026-08-10）
- P0-1 shared/guard.js 新增 DB 版 checkCommentRateLimit + 同步 19 副本
- P0-2 cloudfunctions/post/index.js refDetail 脱敏（contact/openid）
- P0-3 admin-server operationLogger 对 request_body 递归脱敏敏感字段（password/token 等）
- P0-4 系列改动：
  - shared/guard.js enrichAuthors：author 加 userId(users._id)，统一删 _openid/authorId
  - comment.list：isMine + 删 _openid + 删 replyTo.userId；enrichReplyToNicknames 兼容 _id
  - post.detail：isOwner；post.userPosts 支持 userId(_id)
  - lostfound/delivery：detail 返回 isOwner/isPublisher/isAcceptor + publisher.userId，删 openid；list 脱敏
  - block：block/unblock 支持 targetUserId；list 返回 userId+昵称头像
  - order：list/detail 删 _openid/deliveryManId
  - notify.list：删 senderId
  - 客户端：post/detail（isMine/replyTo/主页跳转）、delivery/lostfound detail、search、setting 适配

## 验证状态
- 全部改动文件语法 OK；shared 19 副本一致；客户端无 openid 残留依赖
- 未部署云环境实测（需用户在微信开发者工具重新部署云函数后验证）

## 待办（后续）
- P1+ 问题见 code-review-report.html（未修，超本次 P0 范围）
- [x] 同步更新 code-review-report.html：4 个 P0 卡片标记「✅ 已修复」+ 修复说明；统计 P0 显示 0（已修复）；评分备注更新（2026-08-10）
- [x] 移除外卖（food/order）功能全部代码（2026-08-11）
- [x] 修复 P1：post.checkImages 无鉴权（加 requireLogin + 帖子归属校验 + 数量/前缀限制）（2026-08-11）
- [x] 报告更新：checkImages 标记已修复；全部 104 条未修问题新增「现实使用影响举例」；统计改为待修复数（P1 27）
- [x] 修复 P1：initDB/migrate requireAdmin 按 _openid 查询改为按 openid 查询（2026-08-11）
- [x] 报告更新：initDB/migrate 标记已修复；统计 P1 未修复 26（已修复 2 项）；横幅动态化
- [x] 修复 P1：默认管理员密码 + 无改密接口（新增 POST /api/auth/change-password + 前端修改密码对话框；seedAdmin 随机密码；SQL 提示强化）（2026-08-11）
- [x] 报告更新：默认密码条目标记已修复；统计 P1 未修复 25（已修复 3 项）
- [x] 修复 P1：登录无暴力破解防护（新增 loginRateLimit 滑动窗口限流 + AuthService.login 接入；单测通过）（2026-08-11）
- [x] 报告更新：登录防爆破条目标记已修复；统计 P1 未修复 24（已修复 4 项）
- [x] 重启 admin-server（PID 95284，session 独立启动，加载全部最新改动；验证改密路由/登录接口正常）（2026-08-11）
- [x] 修复管理后台 13 项影响使用的问题（2026-08-11）：
  前端①刷新丢登录态 ②401/403跳登录 ③错误双弹窗(30处) ④详情页路由复用 ⑤分页删除不回退 ⑥关键操作二次确认 ⑦登录防重复提交
  后端⑧认证审核完整(联动更新用户) ⑨操作日志失败也记录 ⑩operator权限对齐 ⑪更新接口存在性校验 ⑫状态/布尔入参校验 ⑬统计口径统一
- [x] 报告更新：新增用户身份唯一性条目(P1,未修)；13 项标记已修复；P1 未修 18、P2 未修 49、已修复 21
- [x] 重启 admin-server（PID 96028）
- [x] 优先级①完成（2026-08-11）：
  - 修「隐藏帖仍可访问/评论」：post.detail 非作者不可见；comment/like/favorite 拦截隐藏帖
  - 新增「帖子编辑」功能：post.update action（仅作者+文本审核+图片归属校验）；发布页编辑模式（回显、图片保持不变）；详情页+我的帖子列表编辑入口
- [x] 报告更新：隐藏帖条目标记已修复；P1 未修 17；已修复 22 项
- [x] 修复小程序设计问题 7 项（2026-08-11）：退出登录自动重登、跑腿列表/收藏页刷新、日期UTC、验证码长度统一、认证徽章即时更新、profile/message loading 静默
- [x] 身份模型 openid 架构债保留（待独立规划）
- [x] 报告更新：P1 未修 16、P2 未修 43、已修复 29 项
- [x] 排查并修复管理后台帖子详情「浏览/点赞不同步」：数据链路实测一致（normalize 正确）；原因为管理后台详情页无自动刷新 + 浏览数仅小程序端计数。已给 post/Detail.vue 加「刷新」按钮 + 30s 静默轮询（2026-08-11）
- [x] 修复小程序 4 项优先问题（2026-08-11）：上传传 openid（举报/失物/头像）、身份判断标记已修、清除缓存清理内存态、移除客户端 archiveLikes
- [x] 报告更新：fixed 33 项；P1 未修 15、P2 未修 40
- [x] 修复发帖核心链路 3 项（2026-08-11）：图片先审后发（同步审核）、文本审核覆盖 title/tags、拉黑生效于搜索/评论/收藏
- [x] 报告更新：fixed 36 项；P1 未修 15、P2 未修 37
- [x] 优化帖子详情打开速度（2026-08-11）：post.detail 用户/帖子查询并行、浏览数更新并入并行、匿名恢复复用用户数据（省 2 次串行 DB 往返）；前端帖子+评论已并行、图片已 lazy-load
- [x] 修复点头像「无法获取作者信息」根因（2026-08-11）：shared/guard.js batchGetUserMap 的 map 值漏了 _id 字段 → enrichAuthors 的 userId 恒为空。已补 _id 并同步 17 副本。
- [x] 修复 6 个安全/正确性问题（2026-08-11）：initAdmin 密钥环境变量+随机密码+package.json；失物招领 contact AES 加密；错误处理不泄露内部信息+提到 bodyParser 前；验证码 crypto.randomInt+哈希存储+尝试限制；user.login 确定性 _id 幂等创建；举报处理先处置后落状态
- [x] 报告更新：fixed 42；P1 未修 10、P2 未修 36
- [x] 重启 admin-server（PID 3962）
- [x] 修复禁言漏洞 + 解禁通知（2026-08-11）：delivery/lostfound create 补禁言/封禁拦截；UserService 解除禁言/封禁后发系统通知；报告新增两条已修复 P2；重启 admin-server
- [x] 补充封禁/禁言时也发系统通知（2026-08-11）：UserService 手动 banned/muted 时 notifyStatusChange；重启 admin-server（PID 5045）
- [x] 修复封禁/禁言通知没发出的深层根因（2026-08-11）：CloudDbAdapter.normalize 的自映射（'openid':'openid'）被脏数据跳过逻辑误跳过，导致管理后台读 users 永远无 openid → notifyStatusChange 静默失败。已修复并重启 admin-server
- [x] 接入订阅消息（2026-08-11）：认证审核结果模板（verify 云函数发送+前端授权）；举报结果模板（ReportService 发送+发布页授权）；重启 admin-server

## 任务：ux-audit-report.html 逐条核验（2026-10-11，只读，未改代码）
- 范围：去重后共 **23 条**可执行问题 = P0×6 + 前端 P1×12 + 后端 P1×5
- 结论分布：**已修复 5 / 仍存在 15 / 描述与代码不符 3**（另有报告自带的 timeout 项已标已修）
- 已修复但报告未更新：P0-1 轮询遮罩（badge.js:46 已传 loading:false,silent:true）、
  P0-5 跑腿刷新事件（emit refreshDelivery + onShow 脏标记绕过节流）、P0-6 点赞登录引导（feed/section/favorites 三处均补）、
  P1 登录页返回按钮（back="{{true}}"）、P1 通知 markRead（notify.js:35 已传 loading:false,silent:true）
- 描述与代码不符：
  P0-3 imgSecCheck **实为 fail-closed**（guard.js:280 异常返回 pass:false）；仅「前端 10MB 上限 vs imgSecCheck <1MB 硬限制」部分成立（upload.js 有 compressImage 但不保证 <1MB）
  P1 发帖草稿**已存在**（DRAFT_KEY + onSaveDraft + loadDraftIfAny），仅缺 onUnload 自动存/返回拦截
  P1 包体积：实测**主包 1.726MB / 分包 0.257MB / 合计 1.983MB**（非报告所述 2.2MB），且**无 .DS_Store**；banners 1.04MB + icons 374KB 偏大属实
- 仍存在·高优先：P0-2 编辑绕过图审（post handleUpdate 无 imageCheck）、P0-4 详情页加载失败无错误态/重试（post|delivery|lostfound detail + user/edit 共 4 页）、
  P1-3 收藏列表缺三件套且泄 _openid、P1-4 delivery.accept TOCTOU、P1-5 msgSecCheck v1 无 openid、P1-6 lostfound/delivery 审核异常误报违规
- 仍存在·中优先：P1-1 登录 redirect 丢失、P1-3 无 token 过期自动恢复、P1-4 消息页无分页、P1-5 下拉刷新死代码（4 页）、
  P1-6 消息页失败误显空态、P1-7 失物招领 onShow 无条件重载、P1-9 跑腿/失物无 clientId、P1-10 上传无进度、P1-11 无订阅消息推送
- 附带更正：`guard.js` 17 份副本**当前完全一致**（无分叉）；分叉仅存在于 `shared/schema.js`（post 版本更新）

## 任务：P0 修复执行（2026-10-11 14:10，已完成）
- [x] **P0-2 编辑帖子绕过图片审核**
  - `cloudfunctions/post/index.js` 抽出模块级公共函数 `auditImages(images, tag)`（:196-218），create(:383) 与 update(:969-979) 共用
  - handleUpdate 对**新增/变更** fileID 审核：`prevImages = post.images`，`newImages = images.filter(id => prevImages.indexOf(id) === -1)`，非空才审核，违规即 `CONTENT_RISK` 拒绝
  - create 逻辑等价重构（行为不变），仅把内联块替换为函数调用
- [x] **P0-4 详情页加载失败永久空白（4 页）**
  - 统一新增 `loadError / loadErrorText` 状态 + wxml 错误占位分支 + onRetry
  - 样式收敛至全局 `styles/mixins.wxss` 的 `.load-error / __text / __btn / __btn--hover`（四处零重复）
  - 页面：post/detail、delivery/detail、lostfound/detail、user/edit（user/edit 用 `wx:if/wx:else` 整体切换，避免展示空表单）
  - 例外保留：「帖子不存在」等重试无意义场景仍走原「toast + navigateBack」
- [x] 验证：5 个 JS 全部 `node --check` 通过；4 个 wxml 栈式解析标签闭合通过；`mixins.wxss` 花括号平衡
- [x] **部署**：`updateFunctionCode post`（functionRootPath=cloudfunctions）→ 线上 Timeout 仍 30s、Runtime Nodejs18.15
- [x] **线上核对**：下载函数代码包 zip 校验 → `auditImages` 定义/create 调用/update 调用/差集计算 4 项全 True；
      `shared/schema.js` 随包上传且含 `followSection`（分叉副本未被破坏）
- [x] 冒烟：`invokeFunction post {action:'__boot_check__'}` → `{"code":1002,"message":"未知操作"}`、1ms、无 ErrMsg（模块加载正常）
- [x] `ux-audit-report.html` 回写：P0 全部标已修 → 统计改为 `5 P0已修复 / 0 P0待修 / 13 P1待修 / 3 描述需更正`
- **待人工**：小程序端 4 页改动需在微信开发者工具重新编译上传后生效

## 任务：P1 前后端修复执行（2026-10-11 14:25，已完成）
- 范围约定：用户要求「忽略所有跑腿外卖相关问题（服务已取消隐藏）」；订阅消息按用户决策跳过（需后台模板 ID）
- [x] **后端 4 项**
  - favorite.handleList 补齐三件套：`enrichAuthors(list)`（内置删 `_openid`/`authorId`）+ `resolveCloudImages(list)` + 新增本地 `fillLikedStatus(list, openid)`（likes 集合批量查询，服务端返回 `liked`）
  - `shared/guard.js` 的 `contentCheck(content, openid, scene)` 升级 v2：传 `version:2+openid+scene`（发帖/招领 3、评论 2、资料 1），按 `result.suggest` 判定（risky/review 不放行）；**v2 失败自动降级 v1**；`87014` 在 v1/v2 catch 中均判「内容违规」；**18 份副本已手工同步并核验一致**（未动 schema.js）
  - lostfound 审核异常区分：`textResult.error` → 「内容审核服务异常，请稍后重试」
  - lostfound create 幂等：前端按「内容签名」复用 clientId（内容变化才重生成），服务端 create 前 `where({_openid, clientId})` 预查去重；**未改 schema.js**（校验只遍历已声明字段、不拒额外字段）
- [x] **前端 7 项**
  - `api/interceptor.js` 新增 `recoverAuth()`：识别 2001/2003 → clearSession → 静默重登 → 重放一次；`recovering` 重入锁 + 尊重 `isLoggedOut()` + 惰性 require 规避循环依赖
  - login 页 `goHome()` 三级优先级：redirect 参数 → 栈中有上一页则 navigateBack → switchTab 首页；新增 `navigateToRedirect()` 区分 Tab/非Tab
  - 消息页：`loadNotifications(reset)` 支持分页 + `onLoadMore`（bindscrolltolower）+ 页脚；新增 `loadError` 错误态 + `onRetryNotify`；`filterNotificationsByType` 改为复用分页逻辑（消重）
  - 三页下拉刷新改走 scroll-view refresher（favorites/setting/lostfound），移除失效 `onPullDownRefresh`/`stopPullDownRefresh`；`loadFavorites`/`loadBlockList` 补 `return`
  - lostfound 大厅 onShow 改「脏标记 + 30s 节流」，监听 `refreshLostfound`；publish 成功后 emit
  - 上传进度：`cloudAdapter.upload` 透传 `task.onProgressUpdate`；`uploadImages(fp, key, {onProgress})` 合成整体百分比；新增**按本地路径的已上传缓存**（重试仅重传失败项）+ `clearUploadCache()`
  - post/publish 新增 `onUnload` 静默落草稿（图片先 saveFile 落盘）+ `_published` 标记
- [x] 验证：15 个 JS `node --check` 通过；4 个 wxml 栈式标签校验通过；5 个 JSON 合法；wxss 括号平衡；guard.js 18 份 hash 一致；schema.js 分叉保持（0 vs 2）
- [x] **部署并线上核验**：post/comment/user/lostfound/favorite 已更新
  - Timeout 全部保持：30 / 15 / 10 / 20 / 10（**未回落 3s**）
  - `tcb fn detail` 逐函数 grep 9 项 index.js 标记全部命中
  - 下载 comment 代码包核验 `shared/guard.js` 7 项 v2 标记全部命中
  - 冒烟：favorite + lostfound `invokeFunction {action:'__boot_check__'}` → `code:1002`、无 ErrMsg
- **新发现（仅记录，未修）**：
  1. `cloudfunctions/user/config.json` 的 `openapi` 为 `[]`，但 updateProfile 调用 msgSecCheck → 权限缺失时必然抛错 → 命中 `result.error` 分支被静默跳过 → **昵称/简介审核实际从未生效**（fail-open）。未擅自加权限（属行为变更，需产品确认）
  2. **CloudBase MCP 部署链路不写 `permissions.openapi`**（函数详情不返回该字段）；config.json 的权限声明由微信开发者工具上传时才生效
- **待人工**：小程序端改动需在微信开发者工具重新编译上传；`user` 的 msgSecCheck 权限待产品确认

## 任务：登录页「完善资料」布局 + 头像椭圆修复（2026-10-11，已完成）
- 现象：点登录后进入完善资料步骤，内容全部挤在页面上方；头像渲染成椭圆
- 根因①（布局）：`.login-page` 用 `min-height:100%`，Skyline 下不给 flex 容器建立确定高度
  → 容器高度按内容算 → `.profile-card{flex:1}` 分不到空间 → 整体顶到上方
  → 改为 `height:100%`（与 verify/discover/profile 等页一致的既有约定）
- 根因②（椭圆/按钮宽度）：app.json `"style":"v2"` 注入内置
  `button:not([size='mini']){width:184px;margin:0 auto}`，权重 (0,1,1) 压过 `.avatar-btn`(0,1,0)
  → 头像 184px × 160rpx = 椭圆；`.login-btn{width:100%}` 同样失效（完成按钮 184px 居中）
  → 用后代选择器 `.profile-card .avatar-btn` / `.login-actions .login-btn`（权重 0,2,0）覆盖
- 改动文件：`miniprogram/pages/user/login/index.wxss`（3 处）
- 验证：静态校验（括号配平、规则提取）；**截图实测换算佐证**（截图设备 428×926，1rpx≈0.6px，
  按钮实测 184px、卡片实测 686rpx 与预期一致）。未做真机/开发者工具实渲染复验

## 任务：首页左上角「定位学校」选择（2026-10-11，已完成）
- 需求：主页左上角加学校选择入口，当前推荐学校 = 杭电信工
- 实现：`navigation-bar` 的 `left` 插槽（仅 back=false 时渲染）放胶囊入口（定位图标 + shortName + CSS 箭头）
  → 点击弹出居中「选择学校」面板（`position:fixed` 遮罩 z-index 1000，高于自定义 TabBar 的 999）
- 新增 `miniprogram/utils/schools.js`：静态名单（hziee 杭电信工=推荐 / zafu 浙农林 / hmc 杭医），
  提供 getList/getDefault/getById/getCurrent/setCurrent；本地只存 id（键 `current_school_id`）
- 改动文件：`utils/schools.js`(新)、`pages/feed/index.wxml`、`pages/feed/index.wxss`、`pages/feed/index.js`
- 设计约束：left 插槽被组件内联固定为 ≈95px（减 16px 左内边距 → 可用 ≈78px），
  故导航栏只用 shortName（**约定 ≤4 字**），全称在选择面板内展示
- 验证：node --check 通过；schools 模块行为验证（空存储→杭电信工、选中持久化、无效 id 返回 null）；
  wxml 标签配平、新增类名全部有对应样式、无兄弟选择器 +、wxss 花括号配平。未实渲染复验

### 待办（本功能后续）
- 学校选择**当前只影响本机展示/记忆，不改动信息流**；「同校」Tab 仍提示「功能开发中」
- 若要真正按校筛选：需服务端支持（post.list 增加 campus 维度；users.campus 目前由 verify 按 edu 邮箱域名推导）
- 静态名单需业务确认后替换（其余学校名/增加校区维度）

## 任务：设置页三份文档按「纯公益」定位重写（2026-10-11，已完成）
- 需求：完善设置里的「用户协议」「隐私政策」「关于我们」，定位改为**纯公益社区校园平台**
- 重写 `pages/agreement/index.wxml`（三份文档共用一个页面，按 type 分支）：
  - 用户协议：新增「纯公益特别提示」+ 关于本平台（不收费/无广告/不参与交易）+ 服务内容（按实际页面：
    9 个社区板块、跑腿代拿、失物招领、帖子互动、学生认证）+ 账号登录 + 行为规范 + 审核处置 +
    风险提示免责 + 知识产权 + 变更终止 + 法律适用 + 联系我们
  - 隐私政策：按**代码实际行为**逐项重写（OpenID / 昵称头像需主动提交 / 校园邮箱认证 / 位置仅
    chooseLocation 主动选点、不后台定位 / 相册相机 chooseMedia / 日志），补权限说明、共享方
    （微信开放平台 + 腾讯云）、用户权利、未成年人、更新机制
  - 关于我们：品牌区（logo/版本/更新日期）+ 公益承诺四条 + 能力清单 + 安全与秩序 + 特别说明 + 联系方式
  - **清除过期内容**：删「外卖跑腿」（food/order 已移除）、「实名认证」（实为校园邮箱学生认证）、旧日期
- `pages/agreement/index.js`：type 白名单（agreement/privacy/about，用 hasOwnProperty 防原型键）+ pageTitle 映射
  + 版本/日期/联系邮箱常量（**CONTACT_EMAIL 留空待运营方补充**，wxml 条件渲染）
- `pages/agreement/index.wxss`：新增 `.agree-note` 强调框、`.about-hero*`、`.about-pledge*`、`.about-feature*`（全用既有 token）
- `pages/setting/index.wxml|js`：把「用户协议与隐私政策」**拆成两条**（旧实现只能进隐私政策，用户协议无入口）
  → `goDoc(e)` 按 dataset.type 跳转；「关于 临里校园」弹窗改为独立页 `goAbout()` → `?type=about`；
  `contactCustomerService` 未配置企微时由 toast 改为弹窗（文档已把它作为联系方式，不能是死路）
- 验证：node --check 通过；wxml 配平、无未转义 `&`、新增类名全部有样式、`card` 为全局 mixin；
  已确认无「外卖/实名认证/7月25日」旧文案残留。未实渲染复验

### 待办（本次后续）
- `CONTACT_EMAIL` 待运营方填写（邮箱/公众号/企微任一）；填上后三份文档自动展示
- 若后续新增收费、广告、支付、后台定位或第三方 SDK，**必须同步改这两份协议**（文档已注明维护提醒）

## 任务：排查并修复「任意界面随时提示登录失效」（2026-10-11 14:35，已完成）

**现象**：主页与任何页面都可能随时弹出「登录状态已失效，请重新登录」，且不会自动恢复。

**根因（两条独立的竞态，叠加放大）**
1. **服务端「登录即作废」**：`user.handleLogin` 每次调用都无条件 `randomHex(32)` 签发新 `sessionToken`
   并覆盖 `users` 上的唯一会话字段（每用户一个会话）→ 任何一次登录都立即作废其它正在使用的会话。
2. **客户端并发登录**：`app.onLaunch` 每次冷启动都无条件 `auth.login()`；`app.onShow` 在本地无 token 时
   （首启、清缓存、存储被回收）会再并发一次 → 两次登录各自签发不同 token，
   **后到的响应把较旧的 token 写回本地**。
3. 任一在途请求只要携带被作废的 token → `isSessionValid` 的 `token !== stored` → 2001。
4. 抛 2001 的只有 `user.getProfile` / `user.updateProfile`；而 `app.onShow → syncUserStatus`
   会在**每次切回前台**调 `getProfile` → **任意界面**都可能弹提示。
5. 本地 token 仍在 → `checkLoginStatus` 认为已登录 → **不自动重登，故障持续**。
6. 「微信开发者工具 + 真机」共享同一 openid，两个客户端互相轮换 token → 必然随机失效（解释「随时」）。

**修复（3 处，最小改动）**
- `cloudfunctions/user/index.js` handleLogin：改为**仅在「无会话 / 已撤销 / 已过期」时签发新 token**，
  有效会话**原样复用**（`needNewSession` 判定），`sessionExpireAt` 仍按 30 天滑动续期。
- `miniprogram/utils/auth.js`：`login()` 增加**在途任务去重**（模块级 `_loginTask`），
  并发登录共享同一 Promise，成功后释放锁。
- `miniprogram/api/modules/user.js` + `miniprogram/store/user.js`：`getProfile(opts)` 支持拦截器选项；
  `syncFromServer()` 显式传 `{loading:false, silent:true}` —— 后台同步不再每次切前台闪全屏 loading，
  失败也不在无关页面弹提示。
- 兜底：`api/interceptor.js` 的 `recoverAuth`（本轮 P1 已实现）遇 2001/2003 自动静默重登并重放原请求。

**验证**
- 真值表离线验证：`needNewSession` 与「服务端会话是否可用」严格一致
  （无会话/已撤销/已过期 → 轮换；有效 → 复用）；附带自愈：客户端持过期 token 调用 login 会被纠正回服务端有效 token。
- 4 个改动文件 `node --check` 通过；`guard.js` 18 份仍一致（未误动 shared）。
- 部署 `user`：Status completed、**Timeout 10 保持**；线上代码含 `needNewSession`(2) 与上一轮 `openid, 1`(1)；
  冒烟 `invokeFunction {action:'__boot_check__'}` → `code:1002`、无 ErrMsg。
- 报告 `ux-audit-report.html` 新增「四、追加修复」章节，横幅已更新。

**待人工**：前端改动需在微信开发者工具重新编译上传（服务端已生效）。
**说明**：`sessionToken` 仍是「每用户单会话」模型，故「A 设备退出登录会同时作废 B 设备会话」的行为保留；
但因新增自动恢复，B 设备不会再看到失效提示（会自动重登）。若产品要求真正的多设备并行会话，需改为 session 列表结构。

## 任务：「我的帖子」类型筛选 + 跑腿整体下架（2026-10-11，已完成）
- 需求1：我的帖子加类型筛选/标签（含失物招领与社区帖混排问题）
- 需求2（同轮）：跑腿功能完全下架，直接删除相关界面

**后端（已部署）**
- `cloudfunctions/post/index.js` handleMyPosts 增加 `event.module` 筛选：
  community → `_.nin(['lostfound','delivery'])`（兼容早期无 module 字段的历史帖）；lostfound/delivery → 等值；
  其余（空/非法）→ 不筛选
- schema 双份同步补 `post.myPosts.module`（`shared/schema.js` + `cloudfunctions/post/shared/schema.js`）
- **部署**：MCP `updateFunctionCode` post（Nodejs18.15）；部署后核对 Timeout 仍为 30、Status Active ✓；
  invoke 冒烟返回业务错误 2001（未登录）而非崩溃 → 代码加载正常
- 前端顺序安全：`validate()` 不拒绝未知键，前端先发也不会报错

**前端**
- `api/modules/post.js`：`myPosts(page, module, opts)`（profile 调用点同步补第 2 参数）
- `pages/user/posts/*`：`feed-tabs` 3 个类型 Tab（全部/社区/失物招领）+ 空状态文案随 Tab 变化 +
  非社区内容类型标签 + 长按菜单对非社区内容提示到对应详情页
- **跑腿界面全删**：`pages/delivery/`(12 文件) / `api/modules/delivery.js` / `images/icons/delivery.png`，
  并清理 app.json（分包 + preloadRule）、api/index.js、utils/route.js、post/detail 兜底重定向、
  message 跳转映射、publish 中心选项与 FEATURES、三份协议文档表述
- **未动**：云函数 delivery、shared 常量（DELIVERY_STATUS/MODULES.DELIVERY/NOTIFY_TYPE.ORDER）、admin 侧枚举

**验证**：全部改动 `node --check` 通过；wxml 配平；无 `/pages/delivery` 与 `api.delivery` 悬空引用；
app.json JSON 合法（6 分包）；线上 `posts.module='delivery'`=0、`notifications.refType='delivery'`=0 → 无死链。
**未实渲染复验**（需开发者工具重新编译）。

### 待办（本轮后续）
- 若确认彻底清除跑腿：云函数 `delivery`、shared 三个常量、admin 举报目标枚举可另开一轮清理
- ~~`pages/message` 对未知 refType 静默无响应~~ → **✅ 已补（2026-10-11）**：统一 `toastUnsupported()`，
  未匹配类型（report / 已下架业务历史通知）与 `navigateTo` fail（目标页已删除）都提示「该通知暂不支持查看详情」

## 任务：全项目静态验收（2026-10-11）
- 手段：自写 9 项静态验收脚本（无新增文件，inline 执行），覆盖：
  JS 语法（vm.Script 全量）/ JSON 合法性 / WXML 配平（**去 HTML 注释后**解析）/
  WXSS 括号 + 真实 vh 扫描（去 CSS 注释）/ app.json 注册页四件套 / usingComponents 目标存在 /
  WXML 自定义组件是否已注册 / `/pages/*` 路由是否已注册 / `/images/*` 资源是否存在
- **结果：9/9 通过，0 阻塞问题**（66 JS、31 JSON、29 WXML、33 WXSS、20 页、47 处组件引用、78 处路由、89 处图片）
- 踩坑记录：首版脚本出现 3 处误报，均为解析器缺陷 —— ①`<text>` 出现在 HTML 注释里 ②把 `swiper-item`/`slot`
  误列为自闭合标签 ③WXSS 用 HTML 注释正则去注释。**修正后全绿**；真实 `vh` 使用为 **0 处**（仅注释提及）
- 主包体积核算：总计 1.99MB（主包 **1.76MB**，余量 0.24MB；分包合计 0.23MB）；
  主包最大占用是 `images/banners/*`（5 张共 **1.04MB，占主包 59%**）→ 未来逼近上限时优先压这里
- **IDE 真实编译未能执行**：开发者工具未运行且**服务端口关闭**，`cli preview` 返回
  「工具的服务端口已关闭」；开启需用户操作（IDE → 设置 → 安全设置 → 服务端口）→ 已交由用户编译确认

## 任务：意见箱（小程序收集 + 管理后台阅览）（2026-10-11，已完成并部署）
- 需求：「我的」页加「意见箱」，收集测试版本意见，同步上传后台管理平台阅览

**云函数（新建 + 已部署）**
- `cloudfunctions/feedback/`（shared 复制自 report，schema 补 `feedback.submit/listMine`，根 shared 同步补）
- action：`submit`（requireLogin + 封禁拦截 + 每日 10 条限条 + 内容安全「异常放行、违规拒绝」+
  集合不存在自动创建）、`listMine`（本人反馈分页，含 status/reply）
- **内容安全策略特例**：反馈仅后台可见不公开 + MCP 部署无法写 openapi 权限 → msgSecCheck
  异常时放行（与 comment 的 fail-closed 不同，已在文件头注明）；IDE 重新上传授权后可收紧
- 部署：MCP createFunction（Nodejs18.15/timeout 10）；冒烟 invoke 返回 2001（未登录）✓

**云数据库**
- 新建 `feedbacks` 集合 + 2 索引（`_openid+createdAt`、`status+createdAt`）
- 文档结构：`{_openid,type:suggestion|bug|other,content,contact,appVersion,status:pending|handled,reply,handledBy,handledAt,createdAt}`

**小程序端**
- `pages/setting/feedback/index`（放 setting 分包，不增主包体积）：类型三选、内容 5-500 字（计数）、
  联系方式选填、提交、我的反馈列表（待处理/已处理 + 官方回复回显）
- `api/modules/feedback.js` + api/index 注册；`pages/profile` 加「意见箱」入口（megaphone 图标 + 「公测」tag，
  wxml 补通用 tag 渲染）；app.json setting 分包注册

**管理后台**
- admin-server：`FeedbackRepository/FeedbackService/FeedbackController/feedbackRoutes`
  （GET /api/feedbacks、PUT /:id/handle、DELETE /batch），operator 白名单加 `feedback:read/handle`，
  fieldMapping 加 feedbacks.handledAt；**已重启（旧 PID 31076 → 后台新进程），实测 /api/feedbacks
  返回 2001 鉴权错误（路由已注册）**
- admin-web：`api/feedback.js` + `views/feedback/List.vue`（筛选/表格/标记处理弹窗带官方回复/批量删除/30s 轮询）
  + 路由 `/feedbacks` + 侧边菜单「意见箱」（ChatLineSquare 图标，全局注册无需 import）

**验证**：全部改动 node --check 通过；小程序静态验收 7 项全绿（68 JS/32 JSON/30 WXML/21 页/79 路由/92 图片）。
**未验证**：真机端到端提交（需小程序登录态）；admin-web 页面渲染（Vite 热更后浏览器确认）

## 任务：修复「我的」页收藏统计显示 0（2026-10-11 14:50，已完成）

**现象**：收藏帖子后收藏列表能看到，但「我的」页统计条「收藏」仍为 0。

**数据面核实（先做，避免误判）**：`favorites` 有该记录、帖子 `stats.favorites` = 1 →
数据库一致，问题在展示层。用 `readNoSqlDatabaseContent` 实测确认。

**根因三条**
1. `profile.onShow` 的 30 秒节流 + 收藏动作不发事件 → 返回「我的」时统计被跳过，屏幕保持旧值 0
   （收藏列表页无节流，故「列表有、统计 0」）。
2. `loadAggregatedStats` 失败时落到 `: 0` → 一次静默失败即清零；叠加会话失效期 2001（`silent:true` 无提示）。
3. `favorite.list` 的 `total = list.length`（当前页过滤后条数）→ 超一页（20）后恒为 20。

**修复**
- `pages/post/detail/index.js`：toggle 成功后 `eventBus.emit('favoritesChanged')`
- `pages/profile/index.js`：`onLoad` 订阅 + `_statsDirty`；`onShow` 脏标记优先于节流；
  统计改为 `patch` 写法（仅在请求成功时覆盖数值，失败保留上次值）
- `cloudfunctions/favorite/index.js`：`total` 改为 `favorites` 集合 `count()`；`hasMore` 逻辑不变
- 已部署 `favorite`（Timeout 10 保持）+ 冒烟 `code:1002` 通过

**验证方式说明**：CLS 日志未开通（`topic not exist`），无法取函数执行日志；
故采用「数据库实测 + 代码路径推导」定位，并逐项标注证据来源。

**待人工**：前端改动（detail/profile）需微信开发者工具重新编译上传（IDE 服务端口当前关闭，需用户开启）。

## 任务：修复「评论点赞」操作失败（2026-10-11 16:40，已完成）

**现象**：详情页给评论点赞 → 弹「操作失败」；帖子点赞正常。

**排查**：链路 = `api.like.toggle(commentId,'comment')` → `like` 云函数入口
`validate(event, SCHEMAS['like.toggle'])`。用 `readNoSqlDatabaseContent` 取真实数据：
`comment._id` **115 字符**（`comment_<openid>_post_<postId>_c_<ts>_<rand>`），
而 schema 中所有 ID 字段 `maxLength: 64` → 抛「参数 targetId 长度不能超过 64」。
`post._id` 仅 53 字符，故帖子点赞不受影响 —— 与「只有评论点赞失败」完全吻合。

**影响面**：同一根因共 6 条链路（评论点赞 / 回复评论 / 删除评论 / 举报评论 /
标记通知已读·删除通知 / 后台处理举报），字段长度 115 / 122 / 151。

**修复方式（脚本化，保证 18 份一致）**
- 写一次性 Python 脚本（放在 `E:/linli-tools/`，跑完已删）逐文件做**字符串级**替换，
  **保留各文件自身行尾符**（根是 CRLF、其余 LF，不能整文件覆盖）。
- 只改 5 个字段：`commentId` / `parentId` / `targetId` / `notificationId` / `reportId`，
  64 → 256（7 处 × 18 份 = 126 处）；`SCHEMAS` 顶部插入注释说明依据。
- **刻意不改** `postId`/`userId`/`openid`/`clientId`/`conversationId`/`taskId`/lostfound `id`
  —— 短 ID 或非 DB id，64 是合理约束。
- 顺手把根 `shared/schema.js` 的 **CRLF 规范化为 LF**（此前被并发会话写成 CRLF，与其余 17 份不一致；
  我曾把自己插入的注释写成 LF 导致 MIXED，遂统一为 LF）。

**验证**
- 真实 ID 跑 `validate()`：7 条链路全通过；**反证**改回 64 → 复现「参数 targetId 长度不能超过 64」；
  300 字符越界值仍被拦下（校验未削弱）。
- 18 份 schema.js `node --check` 全通过；字段分布核对：仅 5 个目标字段变 256，其余保持 64。
- 部署 `like`/`comment`/`report`/`notify`：Timeout 保持 10/15/10/10；冒烟 `code:1002` 无 ErrMsg；
  下载线上 `like` 包核验 `shared/schema.js` 内 5 字段均为 256、`openid` 仍 64。

**遗留**：根 `shared/schema.js` 与 16 份副本仍差并发会话未同步的 `post.myPosts.module` 声明
（已在 bugs.md 记录；因该 action 仅 post 使用且 `validate()` 不拒未知键，功能无影响，未擅自补齐）。

**待人工**：本次改动全在**云函数侧，已生效**，前端无需重新编译。

### 追加：同功能的第二个缺陷（已修）

排查时发现「**评论点赞数永远显示 0**」：写入端 `like` 云函数统一递增 `stats.likes`，
读取端 `comment-item.js:55` 读的却是 `likeCount`（`comment.create` 写死 0、此后无人递增）
→ 点赞成功后刷新即归零。
修复：`comment.handleList` 补映射，以 `stats.likes` 回填 `likeCount`（兼容历史值）。已部署 `comment`（Timeout 15）。
注：`like.batchCheck` 用的是 `targetIds` 数组（只校验元素个数），故点赞**状态**一直正常，
受影响的是计数与「点击」本身。

## 任务：修复「编辑帖子后照片消失」（2026-10-11 17:05，已完成）

**现象**：发布带图帖子正常；点「编辑帖子」照片消失；再添加照片也不显示。

**根因（两个问题叠加 + 一处数据丢失风险）**
1. `loadPostForEdit()` 的 `setData` **只回填板块/标题/正文/标签，完全没有 `images`** → 图片区空 → 「消失」。
2. `this._editingImages = post.images.filter(u => u.indexOf('cloud://') === 0)`，但 `post.images`
   已被服务端 `resolvePostImages()` **就地**转成 HTTP 临时链接 → 过滤得**空数组**；
   提交 payload 用 `images: this._editingImages` → **保存会以 `[]` 覆盖，清空原帖全部照片**。
3. 编辑模式上传被 `(!isEdit && images.length)` 跳过 → 新选照片既不上传也不进 payload。

**修复**
- 后端 `post.handleDetail`：在 `resolvePostImages` **之前**快照原始 `post.images`；`isOwner` 时下发 `imageFileIds`
  （仅作者，避免泄露他人存储路径）。
- 前端 `publish/index.js`：编辑加载时回显 `images` 并建立 `_imageFileIdByUrl`（显示链接 → 原始 fileID）；
  提交时按展示顺序合成最终列表（原图走映射回传、新图才上传）；编辑模式增删图片真正可用；
  `_uploadedImageUrls` 收窄为仅本次新上传的 fileID（原帖图片绝不能被清理）。
- `handleUpdate` 无需改：本就只把「新增 fileID」送审，归属校验 `ownerKeys=[openid, uploadKey]` 覆盖新老路径。

**数据核对**：用户那条 9 图帖（「迪士尼」）库里 `images` 仍为 9 个 `cloud://` fileID、`type:'image'`
→ 此前编辑均未成功保存，**数据未丢失**。

**部署/验证**：部署 `post`（Timeout **30 保持**）；线上含 `rawImageFileIds` 与 `result.imageFileIds`；
冒烟 `code:1002` 无 ErrMsg；两侧文件 `node --check` 通过。

**待人工**：`pages/post/publish/index.js` 属前端改动，**需微信开发者工具重新编译上传**后生效
（后端已生效）。
