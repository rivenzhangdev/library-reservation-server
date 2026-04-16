/**
 * MySQL 数据库枚举类型的数字映射
 */

/**
 * 座位状态
 * 0: 可用
 * 1: 维修中
 */
export enum SeatStatus {
    AVAILABLE = 0,
    MAINTENANCE = 1,
}

/**
 * 座位类型
 * 0: 单人间
 * 1: 双人间
 * 2: 多人间
 */
export enum SeatType {
    SINGLE = 0,
    DOUBLE = 1,
    GROUP = 2,
}

/**
 * 时间段
 * 0: 上午 (8:00-12:00)
 * 1: 下午 (13:00-17:00)
 * 2: 晚上 (18:00-22:00)
 */
export enum TimeSlot {
    MORNING = 0,
    AFTERNOON = 1,
    EVENING = 2,
}

/**
 * 预约状态
 * 0: 待使用
 * 1: 进行中
 * 2: 已完成
 * 3: 已取消
 * 4: 违约
 */
export enum BookingStatus {
    UPCOMING = 0,
    ONGOING = 1,
    COMPLETED = 2,
    CANCELED = 3,
    VIOLATED = 4,
}

/**
 * 时间段状态
 * 0: 可用
 * 1: 已预约
 * 2: 维修中
 */
export enum TimeSlotStatusValue {
    AVAILABLE = 0,
    BOOKED = 1,
    MAINTENANCE = 2,
}

/**
 * 用户类型 (MongoDB)
 * 0: 普通用户
 * 1: 管理员
 */
export enum UserType {
    NORMAL = 0,
    ADMIN = 1,
}

/**
 * 通知类型 (MongoDB)
 * 0: 系统通知
 * 1: 预约通知
 * 2: 活动通知
 * 3: 营销通知
 */
export enum NotificationType {
    SYSTEM = 0,
    BOOKING = 1,
    ACTIVITY = 2,
    MARKETING = 3,
}

/**
 * 活动状态 (MongoDB)
 * 0: 未开始
 * 1: 进行中
 * 2: 已结束
 */
export enum ActivityStatus {
    UPCOMING = 0,
    ONGOING = 1,
    ENDED = 2,
}

/**
 * 信用记录类型
 * 0: 加分
 * 1: 减分
 */
export enum CreditType {
    ADD = 0,
    DEDUCT = 1,
}
