-- =============================================================================
-- 文件名称：002_seed_admin.sql
-- 用途说明：临里校园管理后台 - 初始超级管理员账户种子数据
--           首次部署后用于登录后台，登录后应及时修改默认密码
-- 版本号  ：v1.0.0  (migrations/002)
-- 适配来源：依赖 001_init_schema.sql 创建的 admin_users 表
-- 依赖关系：必须在 001_init_schema.sql 执行完成后运行
-- 兼容环境：MySQL 5.7+ / 8.0+
-- 时间戳约定：created_at / updated_at 使用 UNIX_TIMESTAMP() * 1000 生成毫秒时间戳
-- =============================================================================
-- 安全提示（重要）：
--   1. 默认密码 password123 仅供首次部署兜底使用，绝不建议直接用于生产。
--   2. 生产环境请改用 `node src/scripts/seedAdmin.js` 生成随机强口令的初始管理员，
--      或部署后立即通过新增接口 POST /api/auth/change-password 修改密码。
--   3. 修改密码后本 SQL 中的默认哈希将失效，无需重复执行本脚本。
-- =============================================================================
-- =============================================================================

USE `linli_admin`;

-- 设置会话时区为 UTC，保持与 001 脚本一致
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 插入初始超级管理员账户
--   用户名      ：admin
--   密码哈希    ：$2a$10$N9qo8uLOickgx2ZMRZoMy.MrqK0VrJqHwDvQEHoNQEyVQmqJKZ8iC
--                 （明文为 password123 的 bcrypt 哈希，cost factor = 10，仅供首次部署兜底）
--   real_name   ：超级管理员
--   role        ：super_admin
--   status      ：active
--   last_login_at / last_login_ip：留空，待首次登录时回填
-- -----------------------------------------------------------------------------
INSERT INTO `admin_users`
  (`username`, `password_hash`, `real_name`, `role`, `status`,
   `last_login_at`, `last_login_ip`, `created_at`, `updated_at`)
VALUES
  ('admin',
   '$2a$10$N9qo8uLOickgx2ZMRZoMy.MrqK0VrJqHwDvQEHoNQEyVQmqJKZ8iC',
   '超级管理员',
   'super_admin',
   'active',
   NULL,
   NULL,
   UNIX_TIMESTAMP() * 1000,
   UNIX_TIMESTAMP() * 1000);

-- -----------------------------------------------------------------------------
-- 校验：确认初始管理员已插入
-- -----------------------------------------------------------------------------
SELECT `id`, `username`, `real_name`, `role`, `status`, `created_at`
  FROM `admin_users`
 WHERE `username` = 'admin';

-- =============================================================================
-- 迁移脚本结束
-- =============================================================================
