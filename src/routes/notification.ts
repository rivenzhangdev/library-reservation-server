/* eslint-disable */
import Router from 'koa-router';
import { Notification } from '../models/mongodb';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/notification' });

/**
 * @route GET /api/notification
 * @desc Get notification list interface
 */
router.get('/', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { type, isRead, page = 1, limit = 20 } = ctx.query as any;

        const query: any = { userId };

        if (type) {
            query.type = type;
        }

        if (isRead !== undefined) {
            query.isRead = isRead === 'true';
        }

        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);

        const notifications = await Notification.find(query)
            .sort({ time: -1 })
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit);

        const total = await Notification.countDocuments(query);

        ctx.body = {
            success: true,
            data: {
                notifications: notifications.map((notif) => ({
                    id: notif._id,
                    title: notif.title,
                    content: notif.content,
                    type: notif.type,
                    time: notif.time,
                    isRead: notif.isRead,
                    relatedId: notif.relatedId,
                })),
                total,
                page: pageNum,
                limit: pageLimit,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get notifications',
            ErrorCodes.NOTIFICATION_NOT_FOUND
        );
    }
});

/**
 * @route POST /api/notification
 * @desc Create notification (admin only)
 */
router.post('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const body: any = ctx.request.body || {};
        const { userId, type, title, content, time, relatedId, data } = body;

        if (type === undefined || !title || !content) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const obj: any = {
            userId,
            type,
            title,
            content,
        };
        if (relatedId) obj.relatedId = relatedId;
        if (data) obj.data = data;
        if (time) obj.time = new Date(time);

        const created = await Notification.create(obj as any);

        ctx.body = { success: true, data: { id: created._id } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create notification',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route POST /api/notification/read/:id
 * @desc Mark notification as read interface
 */
router.post('/read/:id', authMiddleware, async (ctx) => {
    try {
        const notificationId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const notification = await Notification.findOne({
            _id: notificationId,
            userId,
        });

        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.GET_NOTIFICATIONS_ERROR
            );
        }

        await notification.update({ isRead: true });

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to mark as read',
            ErrorCodes.MARK_READ_ERROR
        );
    }
});

/**
 * @route POST /api/notification/read-all
 * @desc Mark all as read interface
 */
router.post('/read-all', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;

        await Notification.updateMany(
            { userId, isRead: false },
            { $set: { isRead: true } }
        );

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to mark all as read',
            ErrorCodes.MARK_ALL_READ_ERROR
        );
    }
});

/**
 * @route DELETE /api/notification/:id
 * @desc Delete notification interface
 */
router.delete('/:id', authMiddleware, async (ctx) => {
    try {
        const notificationId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const notification = await Notification.findOneAndDelete({
            _id: notificationId,
            userId,
        });

        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.GET_NOTIFICATIONS_ERROR
            );
        }

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete notification',
            ErrorCodes.DELETE_NOTIFICATION_ERROR
        );
    }
});

/**
 * @route GET /api/notification/:id
 * @desc Get notification detail (admin)
 */
router.get('/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const notificationId = ctx.params.id;

        const notification = await Notification.findById(notificationId);

        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.NOTIFICATION_NOT_FOUND
            );
        }

        ctx.body = {
            success: true,
            data: {
                id: notification._id,
                userId: notification.userId,
                title: notification.title,
                content: notification.content,
                type: notification.type,
                data: notification.data,
                relatedId: notification.relatedId,
                time: notification.time,
                isRead: notification.isRead,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get notification detail',
            ErrorCodes.GET_NOTIFICATIONS_ERROR
        );
    }
});

/**
 * @route PATCH /api/notification/:id
 * @desc Update notification (admin only)
 */
router.patch('/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const notificationId = ctx.params.id;
        const body: any = ctx.request.body || {};

        const notification = await Notification.findById(notificationId);
        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.NOTIFICATION_NOT_FOUND
            );
        }

        const allowed: any = {};
        if (body.title !== undefined) allowed.title = body.title;
        if (body.content !== undefined) allowed.content = body.content;
        if (body.type !== undefined) allowed.type = body.type;
        if (body.relatedId !== undefined) allowed.relatedId = body.relatedId;
        if (body.data !== undefined) allowed.data = body.data;
        if (body.time !== undefined) allowed.time = new Date(body.time);
        if (body.userId !== undefined) allowed.userId = body.userId;

        // apply updates
        Object.assign(notification, allowed);
        await notification.save();

        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update notification',
            ErrorCodes.UPDATE_NOTIFICATION_ERROR
        );
    }
});

export default router;
