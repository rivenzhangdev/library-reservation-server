import Router from 'koa-router';
import { Notification } from '../models/mongodb';
import { authMiddleware } from '../middleware/auth';
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
 * @route POST /api/notification/:id/read
 * @desc Mark notification as read interface
 */
router.post('/:id/read', authMiddleware, async (ctx) => {
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

export default router;
