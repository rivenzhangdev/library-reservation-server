/**
 * 订阅消息服务
 * 统一封装所有微信订阅消息发送场景，避免业务逻辑散落在各路由中。
 */
import { User } from '../models/mongodb';
import {
    buildWechatTemplatePayload,
    wechatTemplateConfig,
    WechatTemplateType,
} from '../utils/wechat-template-config';
import { sendWechatSubscribeMessage } from '../utils/wechat';
import { Notification } from '../models/mongodb';

export type SubscriptionScene =
    | 'BOOKING_SUCCESS'
    | 'BOOKING_REMINDER'
    | 'CHECKIN_REMINDER'
    | 'ACTIVITY_JOIN_SUCCESS';

export interface SubscriptionMessageData {
    /** 场景标识 */
    scene: SubscriptionScene;
    /** 接收消息的用户 MongoDB _id */
    userId: string;
    /** 模板所需业务字段（与 wechat-template-config 中 fields 对应） */
    payload: Record<string, any>;
    /** 消息跳转页（可选，不传则使用模板默认） */
    page?: string;
    /** 是否同时写入系统通知表（默认 true） */
    writeNotification?: boolean;
    /** 通知表所需额外字段 */
    notificationMeta?: {
        title: string;
        content: string;
        type: number;
        relatedId?: string;
    };
}

/** 场景 → 模板类型映射（未来扩展的场景可先 fallback 到 BOOKING_REMINDER） */
const SCENE_TEMPLATE_MAP: Partial<
    Record<SubscriptionScene, WechatTemplateType>
> = {
    BOOKING_SUCCESS: 'BOOKING_SUCCESS',
    BOOKING_REMINDER: 'BOOKING_REMINDER',
    CHECKIN_REMINDER: 'BOOKING_REMINDER',
};

/**
 * 发送订阅消息（含系统通知写入）。
 * 任何步骤失败均不抛出，仅打印错误，以保证主业务不中断。
 */
const SCENE_NOTIFICATION_PREFERENCE_MAP: Record<
    SubscriptionScene,
    string | null
> = {
    BOOKING_SUCCESS: 'bookingSuccess',
    BOOKING_REMINDER: 'bookingReminder',
    CHECKIN_REMINDER: 'checkinReminder',
    ACTIVITY_JOIN_SUCCESS: 'activityNotice',
};

function getUserNotificationPreference(
    scene: SubscriptionScene,
    settings: any
): boolean {
    const key = SCENE_NOTIFICATION_PREFERENCE_MAP[scene];
    if (!key) return false;
    return settings?.notifications?.[key] !== false;
}

function shouldWriteSystemNotification(settings: any): boolean {
    return settings?.notifications?.systemNotice !== false;
}

function parseTimeToMinutes(value: unknown): number | null {
    const text = String(value ?? '').trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(text)) {
        return null;
    }
    const [hourText, minuteText] = text.split(':');
    return Number(hourText) * 60 + Number(minuteText);
}

function isWithinDoNotDisturb(settings: any, now = new Date()): boolean {
    const dnd = settings?.doNotDisturb;
    if (!dnd?.enabled) return false;

    const start = parseTimeToMinutes(dnd.startTime);
    const end = parseTimeToMinutes(dnd.endTime);
    if (start === null || end === null) return false;

    const current = now.getHours() * 60 + now.getMinutes();
    if (start === end) {
        return true;
    }

    if (start < end) {
        return current >= start && current < end;
    }

    return current >= start || current < end;
}

export async function sendSubscriptionMessage(
    input: SubscriptionMessageData
): Promise<void> {
    const {
        scene,
        userId,
        payload,
        page,
        writeNotification = true,
        notificationMeta,
    } = input;
    const user = await User.findById(userId).select('username settings').lean();

    if (!user) {
        return;
    }

    const userSettings = (user as any)?.settings ?? {};

    // 1. 写入系统通知表
    if (
        writeNotification &&
        notificationMeta &&
        shouldWriteSystemNotification(userSettings)
    ) {
        try {
            await (Notification as any).create({
                userId,
                createdBy: userId,
                type: notificationMeta.type,
                title: notificationMeta.title,
                content: notificationMeta.content,
                relatedId: notificationMeta.relatedId ?? '',
                updatedBy: userId,
            });
        } catch (err) {
            console.error(
                `[subscription-message] Failed to write notification (scene=${scene}):`,
                err
            );
        }
    }

    // 2. 发送微信订阅消息
    const templateType = SCENE_TEMPLATE_MAP[scene];
    if (!templateType) {
        // 该场景暂无对应模板配置，跳过发送订阅消息
        return;
    }

    if (!getUserNotificationPreference(scene, userSettings)) {
        // 用户已关闭该类型订阅消息
        return;
    }

    if (isWithinDoNotDisturb(userSettings)) {
        // 命中免打扰时间段，跳过微信订阅消息
        return;
    }

    try {
        const config = wechatTemplateConfig[templateType];
        if (
            !config?.templateId ||
            config.templateId.startsWith('TEMPLATE_ID_')
        ) {
            // 模板 ID 未配置，跳过
            return;
        }

        const openId = (user as any)?.username;
        if (!openId) return;

        const builtPayload = buildWechatTemplatePayload(templateType, payload);
        if (!builtPayload) return;

        await sendWechatSubscribeMessage(
            openId,
            config.templateId,
            page ?? config.page,
            builtPayload
        );
    } catch (err) {
        console.error(
            `[subscription-message] Failed to send WeChat message (scene=${scene}):`,
            err
        );
    }
}

/**
 * 便捷方法：预约成功
 */
export async function notifyBookingSuccess(params: {
    userId: string;
    bookingId: string;
    date: string;
    startTime: string;
    endTime: string;
    seatInfo: string;
    location: string;
}): Promise<void> {
    await sendSubscriptionMessage({
        scene: 'BOOKING_SUCCESS',
        userId: params.userId,
        payload: {
            title: 'Booking successful',
            bookingTime: `${params.date} ${params.startTime}-${params.endTime}`,
            seatInfo: params.seatInfo,
            location: params.location,
            remark: 'Your seat reservation is confirmed.',
        },
        writeNotification: true,
        notificationMeta: {
            title: 'Booking successful',
            content: `You have successfully booked a seat on ${params.date}`,
            type: 1,
            relatedId: params.bookingId,
        },
    });
}

/**
 * 便捷方法：预约提醒（签到前 N 分钟）
 */
export async function notifyBookingReminder(params: {
    userId: string;
    bookingId: string;
    date: string;
    startTime: string;
    endTime: string;
    seatInfo: string;
    location: string;
}): Promise<void> {
    await sendSubscriptionMessage({
        scene: 'BOOKING_REMINDER',
        userId: params.userId,
        payload: {
            title: 'Upcoming booking reminder',
            bookingTime: `${params.date} ${params.startTime}-${params.endTime}`,
            seatInfo: params.seatInfo,
            location: params.location,
            remark: 'Please check in on time to avoid violation.',
        },
        writeNotification: true,
        notificationMeta: {
            title: 'Upcoming booking reminder',
            content: `Your booking on ${params.date} starts soon. Please check in on time.`,
            type: 1,
            relatedId: params.bookingId,
        },
    });
}

/**
 * 便捷方法：签到提醒（签到窗口开启）
 */
export async function notifyCheckinReminder(params: {
    userId: string;
    bookingId: string;
    date: string;
    startTime: string;
    seatInfo: string;
}): Promise<void> {
    await sendSubscriptionMessage({
        scene: 'CHECKIN_REMINDER',
        userId: params.userId,
        payload: {
            title: 'Check-in window is now open',
            bookingTime: `${params.date} ${params.startTime}`,
            seatInfo: params.seatInfo,
            location: '',
            remark: 'Please check in now to confirm your seat.',
        },
        writeNotification: true,
        notificationMeta: {
            title: 'Check-in window is now open',
            content: `Your check-in window for ${params.date} is now open. Please check in.`,
            type: 1,
            relatedId: params.bookingId,
        },
    });
}

/**
 * 便捷方法：活动报名成功
 */
export async function notifyActivityJoinSuccess(params: {
    userId: string;
    activityId: string;
    activityTitle: string;
    activityTime: string;
    location: string;
}): Promise<void> {
    await sendSubscriptionMessage({
        scene: 'ACTIVITY_JOIN_SUCCESS',
        userId: params.userId,
        payload: {
            title: `Registration successful: ${params.activityTitle}`,
            bookingTime: params.activityTime,
            seatInfo: params.activityTitle,
            location: params.location,
            remark: 'Please arrive on time.',
        },
        writeNotification: true,
        notificationMeta: {
            title: 'Activity registration successful',
            content: `You have successfully registered for "${params.activityTitle}".`,
            type: 2,
            relatedId: params.activityId,
        },
    });
}
