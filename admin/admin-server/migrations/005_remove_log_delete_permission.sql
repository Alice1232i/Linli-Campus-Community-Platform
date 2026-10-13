-- =============================================================================
-- 005: 移除 admin:log:delete 权限
--     对应审计报告 V07 — 操作日志禁止删除，权限项不应存在
--     说明：admin_role_permissions 表通过 permission_id 关联 admin_permissions，
--     无 permission_code 列，需通过子查询定位后删除关联记录
-- =============================================================================

-- 1. 删除角色-权限关联（通过子查询定位 permission_id）
DELETE FROM `admin_role_permissions`
WHERE `permission_id` IN (
  SELECT `id` FROM `admin_permissions` WHERE `code` = 'admin:log:delete'
);

-- 2. 删除权限定义
DELETE FROM `admin_permissions` WHERE `code` = 'admin:log:delete';
