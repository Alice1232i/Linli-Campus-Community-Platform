-- =============================================================================
-- 文件名称：001_init_schema.sql
-- 用途说明：临里校园管理后台 MySQL 初始 Schema 迁移脚本
--           创建数据库及全部业务表，作为微信云数据库 MongoDB 迁移至 MySQL 的目标结构
-- 版本号  ：v1.0.0  (migrations/001)
-- 适配来源：字段映射规则来源于 src/adapters/fieldMapping.js
--           枚举值来源于 shared/constants.js
--           通用映射：_id->id, _openid->openid, createdAt->created_at, updatedAt->updated_at
--           嵌套对象拍平：posts.stats / posts.tradeInfo / users.stats /
--                         comments.replyTo / reports.handler
-- 兼容环境：MySQL 5.7+ / 8.0+，字符集 utf8mb4，排序规则 utf8mb4_unicode_ci
-- 时间戳约定：所有 BIGINT 时间字段均存储毫秒级 Unix 时间戳（与云数据库保持一致）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 创建数据库
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `linli_admin`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `linli_admin`;

-- 设置会话时区为 UTC，避免时间戳在写入/读取时被 MySQL 隐式转换
SET time_zone = '+00:00';

-- =============================================================================
-- 2. admin_users 表（管理员账户，独立于小程序 users 集合）
--    说明：后台运维人员账号，密码使用 bcrypt 加密存储
-- =============================================================================
DROP TABLE IF EXISTS `admin_users`;
CREATE TABLE `admin_users` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT              COMMENT '主键ID',
  `username`      VARCHAR(50)   NOT NULL                              COMMENT '登录用户名',
  `password_hash` VARCHAR(255)  NOT NULL                              COMMENT '密码哈希值（bcrypt 加密）',
  `real_name`     VARCHAR(50)   DEFAULT NULL                          COMMENT '真实姓名',
  `role`          VARCHAR(20)   NOT NULL DEFAULT 'operator'           COMMENT '角色：super_admin/admin/operator',
  `status`        VARCHAR(20)   NOT NULL DEFAULT 'active'             COMMENT '状态：active/disabled',
  `last_login_at` BIGINT        DEFAULT NULL                          COMMENT '最后登录时间（毫秒时间戳）',
  `last_login_ip` VARCHAR(45)   DEFAULT NULL                          COMMENT '最后登录IP（兼容 IPv4/IPv6）',
  `created_at`    BIGINT        NOT NULL                              COMMENT '创建时间（毫秒时间戳）',
  `updated_at`    BIGINT        NOT NULL                              COMMENT '更新时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='管理员账户表（后台运维人员，独立于小程序用户体系）';

-- =============================================================================
-- 3. users 表（映射云数据库 users 集合，stats 嵌套对象拍平）
--    映射来源：stats.postCount->post_count, stats.likeCount->like_received_count,
--             stats.followerCount->follower_count, stats.followingCount->following_count
-- =============================================================================
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`                  VARCHAR(64) NOT NULL                          COMMENT '主键ID（原 _id）',
  `openid`              VARCHAR(64) NOT NULL                          COMMENT '微信 openid（原 _openid）',
  `nickname`            VARCHAR(20) DEFAULT NULL                      COMMENT '昵称',
  `avatar`              VARCHAR(500) DEFAULT NULL                     COMMENT '头像URL',
  `gender`              TINYINT     DEFAULT 0                         COMMENT '性别：0未知/1男/2女',
  `bio`                 VARCHAR(100) DEFAULT NULL                     COMMENT '个人简介',
  `phone`               VARCHAR(20) DEFAULT NULL                      COMMENT '手机号',
  `role`                VARCHAR(20) DEFAULT 'user'                    COMMENT '角色：user/merchant/admin',
  `status`              VARCHAR(20) DEFAULT 'active'                  COMMENT '状态：active/muted/banned',
  `ban_expire`          BIGINT      DEFAULT 0                          COMMENT '封禁到期时间戳（0=永久，毫秒）',
  `mute_expire`         BIGINT      DEFAULT 0                          COMMENT '禁言到期时间戳（0=永久，毫秒）',
  `student_verified`    TINYINT     DEFAULT 0                         COMMENT '是否学生认证：0否/1是',
  `verify_badge`        TINYINT     DEFAULT 0                         COMMENT '是否展示认证徽标：0否/1是',
  `campus`              VARCHAR(50) DEFAULT NULL                      COMMENT '所属校区',
  `post_count`          INT         DEFAULT 0                         COMMENT '发帖数（原 stats.postCount）',
  `like_received_count` INT         DEFAULT 0                         COMMENT '获赞数（原 stats.likeCount）',
  `follower_count`      INT         DEFAULT 0                         COMMENT '粉丝数（原 stats.followerCount）',
  `following_count`     INT         DEFAULT 0                         COMMENT '关注数（原 stats.followingCount）',
  `created_at`          BIGINT      NOT NULL                          COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  `updated_at`          BIGINT      NOT NULL                          COMMENT '更新时间（毫秒时间戳，原 updatedAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_status` (`status`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='小程序用户表（映射 users 集合，stats 拍平）';

-- =============================================================================
-- 4. posts 表（映射 posts 集合，stats 与 tradeInfo 嵌套对象拍平）
--    映射来源：stats.likes->like_count, stats.comments->comment_count,
--             stats.views->view_count, stats.shares->share_count,
--             stats.favorites->favorite_count,
--             tradeInfo.price->trade_price, tradeInfo.condition->trade_condition,
--             tradeInfo.location->trade_location
-- =============================================================================
DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `id`              VARCHAR(64)  NOT NULL                             COMMENT '主键ID（原 _id）',
  `openid`          VARCHAR(64)  NOT NULL                             COMMENT '发布者 openid（原 _openid）',
  `author_id`       VARCHAR(64)  NOT NULL                             COMMENT '作者用户ID（关联 users.id）',
  `module`          VARCHAR(50)  NOT NULL                             COMMENT '业务模块：community/lostfound/missing/delivery/food',
  `section`         VARCHAR(50)  DEFAULT NULL                         COMMENT '社区板块：daily/secondhand/help/study/emotion/news',
  `title`           VARCHAR(200) DEFAULT NULL                         COMMENT '标题',
  `content`         TEXT         DEFAULT NULL                         COMMENT '正文内容',
  `images`          JSON         DEFAULT NULL                         COMMENT '图片URL数组',
  `tags`            JSON         DEFAULT NULL                         COMMENT '标签数组',
  `like_count`      INT          DEFAULT 0                            COMMENT '点赞数（原 stats.likes）',
  `comment_count`   INT          DEFAULT 0                            COMMENT '评论数（原 stats.comments）',
  `view_count`      INT          DEFAULT 0                            COMMENT '浏览数（原 stats.views）',
  `share_count`     INT          DEFAULT 0                            COMMENT '分享数（原 stats.shares）',
  `favorite_count`  INT          DEFAULT 0                            COMMENT '收藏数（原 stats.favorites）',
  `is_top`          TINYINT      DEFAULT 0                            COMMENT '是否置顶：0否/1是',
  `is_essence`      TINYINT      DEFAULT 0                            COMMENT '是否精华：0否/1是',
  `status`          VARCHAR(20)  DEFAULT 'normal'                     COMMENT '帖子状态：normal/hidden/deleted/reviewing',
  `sec_status`      VARCHAR(20)  DEFAULT 'pass'                       COMMENT '内容安全状态：pass/risk/reviewing',
  `trade_price`     DECIMAL(10,2) DEFAULT NULL                        COMMENT '交易价格（原 tradeInfo.price）',
  `trade_condition` VARCHAR(20)  DEFAULT NULL                         COMMENT '成色（原 tradeInfo.condition）',
  `trade_location`  VARCHAR(200) DEFAULT NULL                         COMMENT '交易地点（原 tradeInfo.location）',
  `created_at`      BIGINT       NOT NULL                             COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  `updated_at`      BIGINT       NOT NULL                             COMMENT '更新时间（毫秒时间戳，原 updatedAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_module` (`module`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='帖子表（映射 posts 集合，stats 与 tradeInfo 拍平）';

-- =============================================================================
-- 5. comments 表（映射 comments 集合，replyTo 嵌套对象拍平）
--    映射来源：replyTo.userId->reply_to_user_id, replyTo.nickname->reply_to_nickname
-- =============================================================================
DROP TABLE IF EXISTS `comments`;
CREATE TABLE `comments` (
  `id`                VARCHAR(64) NOT NULL                            COMMENT '主键ID（原 _id）',
  `openid`            VARCHAR(64) NOT NULL                            COMMENT '评论者 openid（原 _openid）',
  `post_id`           VARCHAR(64) NOT NULL                            COMMENT '所属帖子ID（关联 posts.id）',
  `parent_id`         VARCHAR(64) DEFAULT NULL                        COMMENT '父评论ID（楼中楼）',
  `reply_to_user_id`  VARCHAR(64) DEFAULT NULL                        COMMENT '被回复用户ID（原 replyTo.userId）',
  `reply_to_nickname` VARCHAR(50) DEFAULT NULL                        COMMENT '被回复用户昵称（原 replyTo.nickname）',
  `content`           TEXT        DEFAULT NULL                        COMMENT '评论内容',
  `like_count`        INT         DEFAULT 0                           COMMENT '点赞数',
  `status`            VARCHAR(20) DEFAULT 'normal'                    COMMENT '状态：normal/hidden/deleted/reviewing',
  `created_at`        BIGINT      NOT NULL                            COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  `updated_at`        BIGINT      NOT NULL                            COMMENT '更新时间（毫秒时间戳，原 updatedAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='评论表（映射 comments 集合，replyTo 拍平）';

-- =============================================================================
-- 6. likes 表（点赞记录）
--    target_type 取值：post/comment/user/message/lostfound/missing/delivery
-- =============================================================================
DROP TABLE IF EXISTS `likes`;
CREATE TABLE `likes` (
  `id`          VARCHAR(64) NOT NULL                                  COMMENT '主键ID（原 _id）',
  `openid`      VARCHAR(64) NOT NULL                                  COMMENT '点赞者 openid（原 _openid）',
  `target_type` VARCHAR(20) NOT NULL                                  COMMENT '目标类型：post/comment/user/message/lostfound/missing/delivery',
  `target_id`   VARCHAR(64) NOT NULL                                  COMMENT '目标对象ID',
  `created_at`  BIGINT      NOT NULL                                  COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid_target` (`openid`, `target_type`, `target_id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_target_id` (`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='点赞记录表（openid+目标 唯一约束，防止重复点赞）';

-- =============================================================================
-- 7. favorites 表（收藏记录）
-- =============================================================================
DROP TABLE IF EXISTS `favorites`;
CREATE TABLE `favorites` (
  `id`         VARCHAR(64) NOT NULL                                   COMMENT '主键ID（原 _id）',
  `openid`     VARCHAR(64) NOT NULL                                   COMMENT '收藏者 openid（原 _openid）',
  `post_id`    VARCHAR(64) NOT NULL                                   COMMENT '被收藏帖子ID（关联 posts.id）',
  `created_at` BIGINT      NOT NULL                                   COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid_post` (`openid`, `post_id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_post_id` (`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='收藏记录表（openid+post 唯一约束，防止重复收藏）';

-- =============================================================================
-- 8. reports 表（举报记录，handler 嵌套对象拍平）
--    映射来源：handler.adminId->handler_id, handler.adminName->handler_name
--    reason 取值：spam/abuse/porn/fraud/privacy/other
--    status 取值：pending/processing/resolved/rejected
-- =============================================================================
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `id`           VARCHAR(64) NOT NULL                                 COMMENT '主键ID（原 _id）',
  `openid`       VARCHAR(64) NOT NULL                                 COMMENT '举报人 openid（原 _openid）',
  `target_type`  VARCHAR(20) NOT NULL                                 COMMENT '目标类型：post/comment/user/message/lostfound/missing/delivery',
  `target_id`    VARCHAR(64) NOT NULL                                 COMMENT '目标对象ID',
  `reason`       VARCHAR(20) NOT NULL                                 COMMENT '举报原因：spam/abuse/porn/fraud/privacy/other',
  `detail`       VARCHAR(500) DEFAULT NULL                            COMMENT '举报详情描述',
  `evidence`     JSON         DEFAULT NULL                            COMMENT '证据图片URL数组',
  `status`       VARCHAR(20)  DEFAULT 'pending'                       COMMENT '处理状态：pending/processing/resolved/rejected',
  `handler_id`   INT UNSIGNED DEFAULT NULL                            COMMENT '处理人管理员ID（原 handler.adminId，关联 admin_users.id）',
  `handler_name` VARCHAR(50)  DEFAULT NULL                            COMMENT '处理人管理员姓名（原 handler.adminName）',
  `result`       VARCHAR(500) DEFAULT NULL                            COMMENT '处理结果说明',
  `resolved_at`  BIGINT       DEFAULT NULL                            COMMENT '处理完成时间（毫秒时间戳）',
  `created_at`   BIGINT       NOT NULL                                COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  `updated_at`   BIGINT       NOT NULL                                COMMENT '更新时间（毫秒时间戳，原 updatedAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='举报记录表（映射 reports 集合，handler 拍平）';

-- =============================================================================
-- 9. operation_logs 表（管理员操作日志审计）
-- =============================================================================
DROP TABLE IF EXISTS `operation_logs`;
CREATE TABLE `operation_logs` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT                  COMMENT '主键ID',
  `admin_id`     INT UNSIGNED NOT NULL                                 COMMENT '操作管理员ID（关联 admin_users.id）',
  `admin_name`   VARCHAR(50)  DEFAULT NULL                             COMMENT '操作管理员姓名（冗余便于检索）',
  `action`       VARCHAR(100) NOT NULL                                 COMMENT '操作动作标识，如 post:delete',
  `target_type`  VARCHAR(50)  DEFAULT NULL                             COMMENT '操作对象类型',
  `target_id`    VARCHAR(64)  DEFAULT NULL                             COMMENT '操作对象ID',
  `before_data`  JSON         DEFAULT NULL                             COMMENT '操作前原始数据快照',
  `after_data`   JSON         DEFAULT NULL                             COMMENT '操作后变更数据快照',
  `request_body` JSON         DEFAULT NULL                             COMMENT '请求体原始参数',
  `log_hash`     VARCHAR(64)  DEFAULT NULL                             COMMENT '防篡改哈希（SHA256(prev_hash + record_json)）',
  `method`       VARCHAR(10)  DEFAULT NULL                             COMMENT 'HTTP方法：GET/POST/PUT/DELETE',
  `path`         VARCHAR(500) DEFAULT NULL                             COMMENT '请求路径',
  `ip`           VARCHAR(45)  DEFAULT NULL                             COMMENT '请求IP（兼容 IPv4/IPv6）',
  `status_code`  INT          DEFAULT NULL                             COMMENT 'HTTP响应状态码',
  `created_at`   BIGINT       NOT NULL                                 COMMENT '操作时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  KEY `idx_admin_id` (`admin_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='管理员操作日志表（审计追踪，只读追加，禁止删除/修改）';

-- =============================================================================
-- 10. verifications 表（学生认证申请）
--     status 取值：pending/approved/rejected
-- =============================================================================
DROP TABLE IF EXISTS `verifications`;
CREATE TABLE `verifications` (
  `id`             VARCHAR(64) NOT NULL                               COMMENT '主键ID（原 _id）',
  `openid`         VARCHAR(64) NOT NULL                               COMMENT '申请人 openid（原 _openid）',
  `email`          VARCHAR(100) DEFAULT NULL                          COMMENT '校园邮箱',
  `code`           VARCHAR(20)  DEFAULT NULL                          COMMENT '验证码',
  `status`         VARCHAR(20)  DEFAULT 'pending'                     COMMENT '认证状态：pending/approved/rejected',
  `email_verified` TINYINT      DEFAULT 0                             COMMENT '邮箱是否已验证：0否/1是',
  `created_at`     BIGINT       NOT NULL                              COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  `updated_at`     BIGINT       NOT NULL                              COMMENT '更新时间（毫秒时间戳，原 updatedAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='学生认证申请表';

-- =============================================================================
-- 11. notifications 表（站内通知）
--     type 取值：like/comment/favorite/follow/order/chat/system/report
-- =============================================================================
DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
  `id`         VARCHAR(64) NOT NULL                                   COMMENT '主键ID（原 _id）',
  `openid`     VARCHAR(64) NOT NULL                                   COMMENT '接收人 openid（原 _openid）',
  `type`       VARCHAR(20) NOT NULL                                   COMMENT '通知类型：like/comment/favorite/follow/order/chat/system/report',
  `title`      VARCHAR(200) DEFAULT NULL                              COMMENT '通知标题',
  `body`       TEXT         DEFAULT NULL                              COMMENT '通知正文',
  `ref_type`   VARCHAR(20)  DEFAULT NULL                              COMMENT '关联对象类型',
  `ref_id`     VARCHAR(64)  DEFAULT NULL                              COMMENT '关联对象ID',
  `sender_id`  VARCHAR(64)  DEFAULT NULL                              COMMENT '发送人ID（系统通知为空）',
  `read`       TINYINT      DEFAULT 0                                 COMMENT '是否已读：0未读/1已读',
  `created_at` BIGINT       NOT NULL                                  COMMENT '创建时间（毫秒时间戳，原 createdAt）',
  PRIMARY KEY (`id`),
  KEY `idx_openid` (`openid`),
  KEY `idx_read` (`read`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='站内通知表';

-- =============================================================================
-- 迁移脚本结束
-- 说明：权限相关表（admin_permissions / admin_role_permissions）在 003_seed_permissions.sql
--       中创建并初始化种子数据，本脚本不涉及。
-- =============================================================================
