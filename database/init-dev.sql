-- 图书馆座位预约系统 MySQL 数据库初始化脚本 - 开发环境

-- 创建数据库（使用 utf8mb4 字符集）
CREATE DATABASE IF NOT EXISTS library_booking_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE library_booking_dev;

-- 设置客户端字符集
SET NAMES utf8mb4;

-- 创建 floors 表 (楼层信息)
CREATE TABLE IF NOT EXISTS floors (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '楼层 ID',
  name VARCHAR(50) NOT NULL COMMENT '楼层名称',
  description TEXT COMMENT '楼层描述',
  total_seats INT DEFAULT 0 COMMENT '总座位数',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='楼层信息表';

-- 创建 seats 表 (座位信息)
CREATE TABLE IF NOT EXISTS seats (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '座位 ID',
  floor_id INT NOT NULL COMMENT '所属楼层 ID',
  row_num INT NOT NULL COMMENT '行号',
  col_num INT NOT NULL COMMENT '列号',
  status TINYINT DEFAULT 0 COMMENT '座位状态 (0:可用，1:维修中)',
  type TINYINT DEFAULT 0 COMMENT '座位类型 (0:单人间，1:双人间，2:多人间)',
  has_socket BOOLEAN DEFAULT FALSE COMMENT '是否有插座',
  is_window BOOLEAN DEFAULT FALSE COMMENT '是否靠窗',
  zone VARCHAR(50) COMMENT '所属区域',
  description TEXT COMMENT '座位描述',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='座位信息表';

-- 添加唯一索引，确保同一楼层的座位行列组合唯一
CREATE UNIQUE INDEX idx_seat_row_col ON seats(floor_id, row_num, col_num);

-- 创建 bookings 表 (预约信息)
CREATE TABLE IF NOT EXISTS bookings (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '预约 ID',
  user_id VARCHAR(255) NOT NULL COMMENT '用户 ID(MongoDB 中的 ObjectId)',
  seat_id INT NOT NULL COMMENT '座位 ID',
  date DATE NOT NULL COMMENT '预约日期',
  time_slot TINYINT NOT NULL COMMENT '时间段 (0:上午，1:下午，2:晚上)',
  start_time TIME COMMENT '自定义开始时间',
  end_time TIME COMMENT '自定义结束时间',
  status TINYINT DEFAULT 0 COMMENT '预约状态 (0:待使用，1:进行中，2:已完成，3:已取消，4:违约)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约信息表';

-- 添加索引优化查询
CREATE INDEX idx_booking_user_date ON bookings(user_id, date);
CREATE INDEX idx_booking_seat_date ON bookings(seat_id, date);
CREATE INDEX idx_booking_status ON bookings(status);

-- 创建 time_slot_status 表 (时间段座位状态表)
CREATE TABLE IF NOT EXISTS time_slot_status (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT 'ID',
  seat_id INT NOT NULL COMMENT '座位 ID',
  date DATE NOT NULL COMMENT '日期',
  time_slot TINYINT NOT NULL COMMENT '时间段 (0:上午，1:下午，2:晚上)',
  status TINYINT DEFAULT 0 COMMENT '状态 (0:可用，1:已预约，2:维修中)',
  booking_id INT COMMENT '预约 ID(如果已预约)',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='时间段座位状态表';

-- 添加唯一索引，确保同一座位在同一日期的同一时间段状态唯一
CREATE UNIQUE INDEX idx_time_slot_status ON time_slot_status(seat_id, date, time_slot);

-- 创建 time_slot_config 表 (时间段配置表)
CREATE TABLE IF NOT EXISTS time_slot_config (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT 'ID',
  time_slot TINYINT NOT NULL COMMENT '时间段编号 (0:上午，1:下午，2:晚上)',
  value VARCHAR(32) NOT NULL UNIQUE COMMENT '时间段标识',
  label VARCHAR(32) NOT NULL COMMENT '时间段标签',
  start_time VARCHAR(5) NOT NULL COMMENT '开始时间',
  end_time VARCHAR(5) NOT NULL COMMENT '结束时间',
  `order` INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='时间段配置表';

INSERT INTO time_slot_config (time_slot, value, label, start_time, end_time, `order`, enabled) VALUES
  (0, 'morning', '上午', '08:00', '12:00', 0, TRUE),
  (1, 'afternoon', '下午', '13:00', '17:00', 1, TRUE),
  (2, 'evening', '晚上', '18:00', '22:00', 2, TRUE);

-- 创建 booking_rule_config 表 (预约规则配置)
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

INSERT IGNORE INTO booking_rule_config (rule_key, rule_value, description, category, enabled) VALUES
  ('max_booking_per_day', '3', '每人每天最大预约次数', 'booking', TRUE),
  ('max_booking_duration_hours', '4', '单次预约最大时长（小时）', 'booking', TRUE),
  ('advance_booking_days', '7', '可提前预约天数', 'booking', TRUE),
  ('cancel_before_minutes', '30', '预约开始前 N 分钟内视为临近取消；若迟取消扣分大于 0，则允许取消并扣分，否则禁止取消', 'cancel', TRUE),
  ('late_cancel_penalty_credit', '5', '临近开始时取消所扣信用分（设为 0 表示窗口内禁止取消）', 'cancel', TRUE),
  ('renewal.maxExtraSlots', '2', '每个预约最大续约次数', 'renewal', TRUE),
  ('renewal.advanceDays', '0', '可提前续约天数（0 表示仅预约当天可续约）', 'renewal', TRUE),
  ('change_request.maxPerBooking', '3', '每条预约可提交的变更申请总次数上限', 'general', TRUE),
  ('renewal_extend_minutes', '60', '续约延长分钟数', 'renewal', TRUE),
  ('checkin_window_minutes', '15', '签到窗口期（分钟）', 'general', TRUE);

-- 插入示例数据
-- 插入楼层数据
INSERT INTO floors (name, description, total_seats) VALUES
('一楼', '主阅览室', 100),
('二楼', '期刊阅览室', 80),
('三楼', '电子阅览室', 60);

-- 插入座位数据（示例）
-- status: 0=可用，type: 0=单人间
INSERT INTO seats (floor_id, row_num, col_num, status, type, has_socket, is_window, zone, description) VALUES
(1, 1, 1, 0, 0, TRUE, TRUE, 'A 区', '靠窗有电源'),
(1, 1, 2, 0, 0, TRUE, FALSE, 'A 区', '有电源'),
(1, 2, 1, 0, 0, FALSE, TRUE, 'A 区', '靠窗'),
(1, 2, 2, 0, 0, FALSE, FALSE, 'A 区', '普通座位');
