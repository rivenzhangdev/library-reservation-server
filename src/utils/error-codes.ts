/**
 * 全局错误码定义（数字类型）
 * 遵循 RESTful 规范，使用数字错误码代替字符串
 */

export const ErrorCodes = {
    // ==================== 通用错误 (1000-1999) ====================
    SUCCESS: 0, // 成功
    INVALID_PARAMS: 1001, // 参数错误
    UNAUTHORIZED: 1002, // 未授权
    FORBIDDEN: 1003, // 禁止访问
    NOT_FOUND: 1004, // 资源不存在
    INTERNAL_ERROR: 1005, // 服务器内部错误
    METHOD_NOT_ALLOWED: 1006, // 方法不允许

    // ==================== 认证相关错误 (2000-2999) ====================
    INVALID_CODE: 2001, // 微信 code 无效
    WX_API_ERROR: 2002, // 微信 API 错误
    WX_LOGIN_ERROR: 2003, // 微信登录失败
    INVALID_TOKEN: 2004, // Token 无效
    TOKEN_EXPIRED: 2005, // Token 过期
    STUDENT_ID_EXISTS: 2006, // 学号已被绑定
    BIND_STUDENT_ID_ERROR: 2007, // 绑定学号失败
    STUDENT_ID_ALREADY_BOUND: 2008, // 学号已绑定，无法重复绑定
    USERNAME_EXISTS: 2009, // 用户名已存在
    STUDENT_ID_CHANGE_REQUEST_ERROR: 2010, // 学号改绑申请失败
    STUDENT_ID_CHANGE_REQUEST_EXISTS: 2011, // 已存在待处理改绑申请
    PHONE_CHANGE_REQUEST_ERROR: 2012, // 手机号改绑申请失败
    STUDENT_ID_CHANGE_REQUEST_NOT_FOUND: 2013, // 改绑申请不存在
    PHONE_CHANGE_REQUEST_EXISTS: 2014, // 已存在手机号改绑申请
    PHONE_ALREADY_EXISTS: 2015, // 手机号已被占用
    STUDENT_ID_CHANGE_REQUEST_APPROVE_ERROR: 2016, // 批准改绑申请失败
    STUDENT_ID_CHANGE_REQUEST_REJECT_ERROR: 2017, // 拒绝改绑申请失败

    // ==================== 用户相关错误 (3000-3999) ====================
    USER_NOT_FOUND: 3001, // 用户不存在
    UPDATE_PROFILE_ERROR: 3002, // 更新用户信息失败
    FAVORITE_ERROR: 3003, // 收藏操作失败
    GET_CREDIT_ERROR: 3004, // 获取信用积分失败
    GET_SETTINGS_ERROR: 3005, // 获取设置失败
    UPDATE_SETTINGS_ERROR: 3006, // 更新设置失败
    GET_FEEDBACK_ERROR: 3007, // 获取反馈失败
    USER_BLACKLISTED: 3008, // 用户已被列入黑名单
    CREDIT_SCORE_MAXED: 3009, // 信用分已达上限

    // ==================== 座位相关错误 (4000-4999) ====================
    SEAT_NOT_FOUND: 4001, // 座位不存在
    FLOOR_NOT_FOUND: 4002, // 楼层不存在
    GET_SEATS_ERROR: 4003, // 获取座位列表失败
    SEARCH_SEATS_ERROR: 4004, // 搜索座位失败
    INVALID_KEYWORD: 4005, // 关键词无效
    GET_SEAT_DETAILS_ERROR: 4006, // 获取座位详情失败
    GET_CONFIG_ERROR: 4007, // 获取配置失败

    // ==================== 预约相关错误 (5000-5999) ====================
    BOOKING_CONFLICT: 5001, // 预约冲突
    ALREADY_BOOKED: 5002, // 已预约过
    CREATE_BOOKING_ERROR: 5003, // 创建预约失败
    GET_BOOKINGS_ERROR: 5004, // 获取预约列表失败
    BOOKING_NOT_FOUND: 5005, // 预约不存在
    CANCEL_BOOKING_ERROR: 5006, // 取消预约失败
    CHECKIN_ERROR: 5007, // 签到失败
    CHECKIN_NOT_ALLOWED: 5008, // 不允许签到
    RENEW_BOOKING_ERROR: 5009, // 续约失败
    GET_BOOKING_ERROR: 5010, // 获取预约详情失败

    // ==================== 通知相关错误 (6000-6999) ====================
    NOTIFICATION_NOT_FOUND: 6001, // 通知不存在
    GET_NOTIFICATIONS_ERROR: 6002, // 获取通知列表失败
    MARK_READ_ERROR: 6003, // 标记为已读失败
    MARK_ALL_READ_ERROR: 6004, // 全部标记为已读失败
    DELETE_NOTIFICATION_ERROR: 6005, // 删除通知失败
    UPDATE_NOTIFICATION_ERROR: 6006, // 更新通知失败

    // ==================== 活动相关错误 (7000-7999) ====================
    ACTIVITY_NOT_FOUND: 7001, // 活动不存在
    GET_ACTIVITIES_ERROR: 7002, // 获取活动列表失败
    JOIN_ACTIVITY_ERROR: 7003, // 报名活动失败
    QUIT_ACTIVITY_ERROR: 7004, // 退出活动失败
    ACTIVITY_ENDED: 7005, // 活动已结束
    ACTIVITY_IN_PROGRESS: 7006, // 活动正在进行中
    ALREADY_JOINED: 7007, // 已报名活动
    ACTIVITY_FULL: 7008, // 活动人数已满
    NOT_JOINED: 7009, // 未报名活动
    CANCEL_JOIN_ERROR: 7010, // 取消报名失败
    ACTIVITY_NOT_STARTED: 7011, // 活动未开始
    ACTIVITY_CHECKIN_ERROR: 7012, // 活动签到失败
    ACTIVITY_CHECKOUT_ERROR: 7013, // 活动签退失败
    ACTIVITY_NOT_SIGNED_IN: 7014, // 未签到活动

    // ==================== 反馈相关错误 (8000-8999) ====================
    FEEDBACK_NOT_FOUND: 8001, // 反馈不存在
    FEEDBACK_ALREADY_RESOLVED: 8004, // 反馈已解决
    GET_FEEDBACKS_ERROR: 8002, // 获取反馈列表失败
    SUBMIT_FEEDBACK_ERROR: 8003, // 提交反馈失败

    // ==================== 变更申请错误 (5200-5299) ====================
    CHANGE_REQUEST_NOT_FOUND: 5201, // 申请不存在
    CHANGE_REQUEST_ALREADY_REVIEWED: 5202, // 申请已审批
    CHANGE_REQUEST_DUPLICATE: 5203, // 重复提交
    CHANGE_REQUEST_TARGET_UNAVAILABLE: 5204, // 目标时段/座位不可用
    CHANGE_REQUEST_LIMIT_EXCEEDED: 5205, // 变更申请次数已达上限
    CHANGE_REQUEST_INVALID_TARGET: 5206, // 变更目标无效（日期/时段）

    // ==================== 预约续约错误 (5300-5399) ====================
    RENEWAL_LIMIT_EXCEEDED: 5301, // 续约次数已达上限
    RENEWAL_SLOT_UNAVAILABLE: 5302, // 续约目标时段不可用
    BOOKING_DAILY_LIMIT_EXCEEDED: 5303, // 每日预约次数已达上限

    ACTIVITY_REGISTRATION_CLOSED: 7103, // 报名已截止

    // ==================== 审计日志错误 (9000-9099) ====================
    AUDIT_LOG_ERROR: 9001, // 审计日志写入失败
    AUDIT_LOG_QUERY_ERROR: 9002, // 审计日志查询失败

    // ==================== 预约规则配置错误 (5400-5499) ====================
    BOOKING_RULE_NOT_FOUND: 5401, // 规则不存在
    BOOKING_RULE_UPDATE_ERROR: 5402, // 规则更新失败
    BOOKING_RULE_INVALID_VALUE: 5403, // 规则值格式错误

    // ==================== 运营看板错误 (9100-9199) ====================
    DASHBOARD_STATS_ERROR: 9101, // 获取看板数据失败
} as const;

export type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes];
