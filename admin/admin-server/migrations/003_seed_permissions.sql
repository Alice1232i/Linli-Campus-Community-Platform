-- =============================================================================
-- 文件名称：003_seed_permissions.sql
-- 用途说明：临里校园管理后台 - 权限体系建表与种子数据初始化
--           1) 创建 admin_permissions（权限定义表）
--           2) 创建 admin_role_permissions（角色-权限关联表）
--           3) 插入 15 项权限种子数据
--           4) 建立 super_admin / admin / operator 三个角色的权限映射
-- 版本号  ：v1.0.0  (migrations/003)
-- 适配来源：角色体系对应 admin_users.role（super_admin/admin/operator）
--           权限编码风格采用 资源:动作 格式，与 src/middleware/permission.js 配合使用
-- 依赖关系：必须在 001_init_schema.sql 执行完成后运行
--           （独立于 002_seed_admin.sql，两者无强依赖，可任意先后顺序）
-- 兼容环境：MySQL 5.7+ / 8.0+
-- 时间戳约定：created_at / updated_at 使用 UNIX_TIMESTAMP() * 1000 生成毫秒时间戳
-- =============================================================================

USE `linli_admin`;

-- 设置会话时区为 UTC，保持与 001 脚本一致
SET time_zone = '+00:00';

-- =============================================================================
-- 1. admin_permissions 表（权限定义表）
--    说明：权限编码（code）采用「资源:动作」格式，如 post:delete
--          与 src/middleware/permission.js 中 requirePermission(code) 配合校验
-- =============================================================================
DROP TABLE IF EXISTS `admin_permissions`;
CREATE TABLE `admin_permissions` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT                  COMMENT '主键ID',
  `code`        VARCHAR(100)  NOT NULL                                  COMMENT '权限编码（资源:动作），如 post:delete',
  `name`        VARCHAR(100)  NOT NULL                                  COMMENT '权限中文名称',
  `category`    VARCHAR(50)   DEFAULT NULL                              COMMENT '权限分类：post/comment/user/report/verify/log/stats',
  `description` VARCHAR(255)  DEFAULT NULL                              COMMENT '权限描述',
  `created_at`  BIGINT        NOT NULL                                  COMMENT '创建时间（毫秒时间戳）',
  `updated_at`  BIGINT        NOT NULL                                  COMMENT '更新时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='权限定义表（资源:动作 编码体系）';

-- =============================================================================
-- 2. admin_role_permissions 表（角色-权限关联表）
--    说明：多对多关系，role 取值对应 admin_users.role
--          super_admin / admin / operator
-- =============================================================================
DROP TABLE IF EXISTS `admin_role_permissions`;
CREATE TABLE `admin_role_permissions` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT                  COMMENT '主键ID',
  `role`          VARCHAR(20)  NOT NULL                                  COMMENT '角色：super_admin/admin/operator',
  `permission_id` INT UNSIGNED NOT NULL                                  COMMENT '权限ID（关联 admin_permissions.id）',
  `created_at`    BIGINT       NOT NULL                                  COMMENT '创建时间（毫秒时间戳）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_permission` (`role`, `permission_id`),
  KEY `idx_role` (`role`),
  KEY `idx_permission_id` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='角色-权限关联表（多对多，role 对应 admin_users.role）';

-- =============================================================================
-- 3. 插入权限种子数据（共 15 项）
--    分类：post 帖子 / comment 评论 / user 用户 / report 举报
--          verify 认证 / log 日志 / stats 统计
-- =============================================================================
INSERT INTO `admin_permissions`
  (`code`, `name`, `category`, `description`, `created_at`, `updated_at`)
VALUES
  -- 帖子管理
  ('post:read',         '帖子查看',       'post',    '查看帖子列表与详情', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('post:pin',          '帖子置顶',       'post',    '置顶/取消置顶帖子',  UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('post:delete',       '帖子删除',       'post',    '删除违规帖子',       UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 评论管理
  ('comment:read',      '评论查看',       'comment', '查看帖子评论',       UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('comment:delete',    '评论删除',       'comment', '删除违规评论',       UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 用户管理
  ('user:read',         '用户查看',       'user',    '查看用户列表与详情', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('user:ban',          '用户封禁',       'user',    '禁言/封禁用户账号',  UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('admin:user:manage', '管理员账户管理', 'user',    '增删改后台管理员账户及角色', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 举报管理
  ('report:read',       '举报查看',       'report',  '查看举报列表与详情', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('report:handle',     '举报处理',       'report',  '处理举报工单并出结论', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 认证管理
  ('verify:read',       '认证查看',       'verify',  '查看学生认证申请',   UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  ('verify:approve',    '认证审核',       'verify',  '审核通过/驳回学生认证', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 日志管理
  ('log:read',          '日志查看',       'log',     '查看管理员操作日志', UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
  -- 统计管理
  ('stats:read',        '统计查看',       'stats',   '查看运营统计数据',   UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000);

-- =============================================================================
-- 4. 角色-权限映射种子数据
--    角色权限矩阵：
--    ┌──────────────┬────────────────────────────────────────────────────┐
--    │ super_admin  │ 全部 14 项权限                                       │
--    │ admin        │ 除 admin:user:manage 外的全部权限                     │
--    │ operator     │ post:read, comment:read, comment:delete, user:read,  │
--    │              │ report:read, report:handle, log:read, stats:read     │
--    └──────────────┴────────────────────────────────────────────────────┘
-- =============================================================================

-- 4.1 super_admin：拥有全部权限
INSERT INTO `admin_role_permissions` (`role`, `permission_id`, `created_at`)
SELECT 'super_admin', `id`, UNIX_TIMESTAMP() * 1000
  FROM `admin_permissions`;

-- 4.2 admin：除「管理员账户管理」外的全部权限
INSERT INTO `admin_role_permissions` (`role`, `permission_id`, `created_at`)
SELECT 'admin', `id`, UNIX_TIMESTAMP() * 1000
  FROM `admin_permissions`
 WHERE `code` NOT IN ('admin:user:manage');

-- 4.3 operator：仅查看与基础处理权限（8 项）
INSERT INTO `admin_role_permissions` (`role`, `permission_id`, `created_at`)
SELECT 'operator', `id`, UNIX_TIMESTAMP() * 1000
  FROM `admin_permissions`
 WHERE `code` IN (
         'post:read',
         'comment:read',
         'comment:delete',
         'user:read',
         'report:read',
         'report:handle',
         'log:read',
         'stats:read'
       );

-- =============================================================================
-- 5. 校验：角色-权限分布总览
-- =============================================================================
SELECT
  r.`role`                                          AS `角色`,
  COUNT(r.`permission_id`)                          AS `权限数量`,
  GROUP_CONCAT(p.`code` ORDER BY p.`category`, p.`code` SEPARATOR ', ') AS `权限列表`
  FROM `admin_role_permissions` r
  JOIN `admin_permissions` p ON p.`id` = r.`permission_id`
 GROUP BY r.`role`
 ORDER BY FIELD(r.`role`, 'super_admin', 'admin', 'operator');

-- =============================================================================
-- 迁移脚本结束
-- =============================================================================
