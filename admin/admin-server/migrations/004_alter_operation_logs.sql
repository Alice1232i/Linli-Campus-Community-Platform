-- =============================================================================
-- 004: operation_logs 表结构升级 — 新增数据快照、请求体、防篡改哈希字段
--     对应审计报告 V01（操作前/后数据快照缺失）
-- =============================================================================

-- 操作前原始数据快照（中间件在执行操作前查询目标对象并序列化）
ALTER TABLE `operation_logs`
  ADD COLUMN `before_data` JSON DEFAULT NULL COMMENT '操作前原始数据快照' AFTER `target_id`;

-- 操作后变更数据快照（操作执行后查询目标对象并序列化）
ALTER TABLE `operation_logs`
  ADD COLUMN `after_data` JSON DEFAULT NULL COMMENT '操作后变更数据快照' AFTER `before_data`;

-- 请求体原始参数（用于复盘管理员操作意图，如封禁时长、状态值）
ALTER TABLE `operation_logs`
  ADD COLUMN `request_body` JSON DEFAULT NULL COMMENT '请求体原始参数' AFTER `after_data`;

-- 防篡改哈希链：SHA256(上一条日志 hash + 本条记录关键字段)
-- 用于检测日志是否被人为篡改，满足合规审计不可篡改要求
ALTER TABLE `operation_logs`
  ADD COLUMN `log_hash` VARCHAR(64) DEFAULT NULL COMMENT '防篡改哈希（SHA256(prev_hash + record_json)）' AFTER `request_body`;

-- 新增复合索引：按目标类型+目标ID联合查询（支持"查某帖子的全部操作历史"）
ALTER TABLE `operation_logs`
  ADD INDEX `idx_target` (`target_type`, `target_id`);
