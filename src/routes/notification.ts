/* eslint-disable */
import Router from 'koa-router';
import { Notification, User } from '../models/mongodb';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { Roles } from '../constants/roles';

const router = new Router({ prefix: '/api/notification' });

/**
 * @route GET /api/notification
 * @desc Get notification list interface
 */
router.get('/', authMiddleware, async (ctx) => {
    try {
        const currentUser: any = (ctx as any).state.user || {};
        const isAdmin = currentUser.role === Roles.ADMIN;
        const {
            type,
            isRead,
            page = 1,
            limit = 20,
            userId: queryUserId,
            timeRange,
            timeRangeStart,
            timeRangeEnd,
        } = ctx.query as any;

        const query: any = {};

        // For non-admin users default to their own notifications
        if (!isAdmin) {
            query.userId = currentUser.id;
        } else {
            // admin may pass userId to filter; otherwise list all
            if (queryUserId) query.userId = queryUserId;
        }

        if (type) query.type = type;
        if (isRead !== undefined) query.isRead = isRead === 'true';

        // Parse timeRange (array or string 'start~end' or csv)
        const parseRange = (dr: any) => {
            if (!dr) return null;
            if (Array.isArray(dr) && dr.length >= 2) return [dr[0], dr[1]];
            if (typeof dr === 'string') {
                if (dr.includes('~')) return dr.split('~').map((s) => s.trim());
                if (dr.includes(',')) return dr.split(',').map((s) => s.trim());
                return [dr.trim(), dr.trim()];
            }
            return null;
        };

        let trange = parseRange(timeRange);
        if (!trange && (timeRangeStart || timeRangeEnd)) {
            trange = [
                timeRangeStart || timeRangeEnd,
                timeRangeEnd || timeRangeStart,
            ];
        }
        if (trange && trange[0] && trange[1]) {
            query.time = {
                $gte: new Date(trange[0]),
                $lte: new Date(trange[1]),
            };
        } else if (trange && trange[0]) {
            query.time = new Date(trange[0]);
        }

        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);

        // Use lean fetch and manual user lookup to handle legacy records
        const notifications = await Notification.find(query)
            .sort({ time: -1 })
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

        const total = await Notification.countDocuments(query);

        const userIds = Array.from(
            new Set(
                (notifications || [])
                    .flatMap((n: any) => [n.userId, n.createdBy, n.updatedBy])
                    .filter(Boolean)
                    .map((x: any) => String(x))
            )
        );

        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } })
                .select('name username avatar')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const mapped = (notifications || []).map((notif: any) => ({
            id: notif._id,
            title: notif.title,
            content: notif.content,
            type: notif.type,
            time: notif.time,
            isRead: notif.isRead,
            relatedId: notif.relatedId,
            userId: notif.userId?._id || notif.userId,
            userAvatar:
                (notif.userId && userMap[String(notif.userId)]?.avatar) ||
                notif.userId?.avatar ||
                '' ||
                '',
            publisher: notif.createdBy?._id || notif.createdBy,
            publisherName:
                notif.createdBy?.username ||
                notif.createdBy?.name ||
                userMap[String(notif.createdBy)]?.username ||
                userMap[String(notif.createdBy)]?.name ||
                undefined,
            updatedBy: notif.updatedBy?._id || notif.updatedBy,
            updatedByName:
                notif.updatedBy?.username ||
                notif.updatedBy?.name ||
                userMap[String(notif.updatedBy)]?.username ||
                userMap[String(notif.updatedBy)]?.name ||
                undefined,
        }));

        ctx.body = {
            success: true,
            data: {
                notifications: mapped,
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
        const { type, title, content, time, relatedId, data } = body;

        if (type === undefined || !title || !content) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const currentUserId = (ctx as any).state.user.id;
        // Do NOT allow client to set recipient or publisher manually.
        // Use authenticated user as publisher; set recipient to current user by default.
        const obj: any = {
            userId: currentUserId,
            createdBy: currentUserId,
            type,
            title,
            content,
            updatedBy: currentUserId,
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
        const currentUser: any = (ctx as any).state.user || {};
        const isAdmin = currentUser.role === Roles.ADMIN;

        const notification = await Notification.findOne(
            isAdmin
                ? { _id: notificationId }
                : {
                      _id: notificationId,
                      userId: currentUser.id,
                  }
        );

        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.GET_NOTIFICATIONS_ERROR
            );
        }

        notification.isRead = true;
        await notification.save();

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
        const currentUser: any = (ctx as any).state.user || {};
        const isAdmin = currentUser.role === Roles.ADMIN;

        await Notification.updateMany(
            isAdmin
                ? { isRead: false }
                : { userId: currentUser.id, isRead: false },
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
        const currentUser: any = (ctx as any).state.user || {};
        const isAdmin = currentUser.role === Roles.ADMIN;

        const notification = await Notification.findOneAndDelete(
            isAdmin
                ? { _id: notificationId }
                : {
                      _id: notificationId,
                      userId: currentUser.id,
                  }
        );

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
 * @desc Get notification detail
 */
router.get('/:id', authMiddleware, async (ctx) => {
    try {
        const notificationId = ctx.params.id;
        const currentUser: any = (ctx as any).state.user || {};
        // lean fetch + manual lookup for compatibility
        const notification = await Notification.findById(notificationId).lean();

        if (!notification) {
            throw new CustomError(
                'Notification not found',
                ErrorCodes.NOTIFICATION_NOT_FOUND
            );
        }

        const isAdmin = currentUser.role === Roles.ADMIN;
        if (
            !isAdmin &&
            String(notification.userId) !== String(currentUser.id)
        ) {
            throw new CustomError('Access denied', ErrorCodes.FORBIDDEN);
        }

        const lookupIds = Array.from(
            new Set(
                [
                    notification.userId,
                    notification.createdBy,
                    notification.updatedBy,
                ]
                    .filter(Boolean)
                    .map((x: any) => String(x))
            )
        );
        const users = lookupIds.length
            ? await User.find({ _id: { $in: lookupIds } })
                  .select('name username avatar')
                  .lean()
            : [];
        const userMap: Record<string, any> = {};
        users.forEach((u: any) => (userMap[String(u._id)] = u));

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
                publisher:
                    notification.createdBy?._id || notification.createdBy,
                publisherName:
                    notification.createdBy?.username ||
                    notification.createdBy?.name ||
                    userMap[String(notification.createdBy)]?.username ||
                    userMap[String(notification.createdBy)]?.name ||
                    undefined,
                updatedBy:
                    notification.updatedBy?._id || notification.updatedBy,
                updatedByName:
                    notification.updatedBy?.username ||
                    notification.updatedBy?.name ||
                    userMap[String(notification.updatedBy)]?.username ||
                    userMap[String(notification.updatedBy)]?.name ||
                    undefined,
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

        // apply updates
        Object.assign(notification, allowed);
        // set updatedBy to current user
        try {
            const currentUserId = (ctx as any).state.user.id;
            (notification as any).updatedBy = currentUserId;
        } catch (e) {
            // ignore
        }
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
