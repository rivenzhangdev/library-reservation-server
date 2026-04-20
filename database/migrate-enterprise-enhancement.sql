-- ============================================================
-- 企业增强功能 - 数据库迁移脚本
-- 适用于已有 library_booking_dev / library_booking_uat / library_booking_prod 数据库
-- 执行前请先备份数据库
-- ============================================================

-- ============================================================
-- 1. booking_rule_config 表 (预约规则配置)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_rule_config (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '规则 ID',
  rule_key VARCHAR(100) NOT NULL UNIQUE COMMENT '规则键',
  rule_value VARCHAR(500) NOT NULL COMMENT '规则值',
  description VARCHAR(500) COMMENT '规则描述',
  category ENUM('booking','renewal','cancel','general') NOT NULL DEFAULT 'general' COMMENT '规则分类',
  enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
  created_by VARCHAR(255) COMMENT '创建人',
  updated_by VARCHAR(255) COMMENT '更新人',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约规则配置表';

-- 插入默认规则
INSERT IGNORE INTO booking_rule_config (rule_key, rule_value, description, category, enabled) VALUES
  ('max_booking_per_day', '3', '每人每天最大预约次数', 'booking', TRUE),
  ('max_booking_duration_hours', '4', '单次预约最大时长（小时）', 'booking', TRUE),
  ('advance_booking_days', '7', '可提前预约天数', 'booking', TRUE),
  ('cancel_before_minutes', '30', '预约开始前 N 分钟内不可取消', 'cancel', TRUE),
  ('late_cancel_penalty_credit', '5', '迟到取消扣除信用分', 'cancel', TRUE),
  ('max_renewal_count', '2', '每个预约最大续约次数', 'renewal', TRUE),
  ('renewal_extend_minutes', '60', '续约延长分钟数', 'renewal', TRUE),
  ('checkin_window_minutes', '15', '签到窗口期（分钟）', 'general', TRUE);

-- ============================================================
-- 2. booking_change_requests 表 (预约变更申请)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_change_requests (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '申请 ID',
  booking_id INT NOT NULL COMMENT '原预约 ID',
  user_id VARCHAR(255) NOT NULL COMMENT '用户 ID',
  change_type ENUM('reschedule','seat_change','cancel') NOT NULL COMMENT '变更类型',
  target_seat_id INT COMMENT '目标座位 ID',
  target_date DATE COMMENT '目标日期',
  target_time_slot TINYINT COMMENT '目标时间段',
  reason VARCHAR(500) COMMENT '申请原因',
  status ENUM('pending','approved','rejected','auto_approved') NOT NULL DEFAULT 'pending' COMMENT '审批状态',
  reviewer_id VARCHAR(255) COMMENT '审批人 ID',
  review_comment VARCHAR(500) COMMENT '审批备注',
  reviewed_at TIMESTAMP NULL COMMENT '审批时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约变更申请表';

CREATE INDEX idx_change_req_booking ON booking_change_requests(booking_id);
CREATE INDEX idx_change_req_user ON booking_change_requests(user_id);
CREATE INDEX idx_change_req_status ON booking_change_requests(status);
