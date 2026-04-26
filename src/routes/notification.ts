/* eslint-disable */
import Router from 'koa-router';
import { Notification, User } from '../models/mongodb';
import { Booking, Seat } from '../models/mysql';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { Roles } from '../constants/roles';
import { normalizeNotificationType } from '../utils/enum-normalizers';
import {
    buildWechatTemplatePayload,
    wechatTemplateConfig,
    WechatTemplateType,
} from '../utils/wechat-template-config';
import {
    getUserDisplayName,
    getUserDisplayNameFromMap,
} from '../utils/user-display';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

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
            current,
            pageSize,
            userId: queryUserId,
            targetType,
            targetRole,
            floorId,
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

        if (type !== undefined && type !== null && type !== '') {
            const normalizedType = normalizeNotificationType(type);
            if (normalizedType !== undefined) query.type = normalizedType;
        }
        if (isRead !== undefined) query.isRead = isRead === 'true';
        if (targetType) query.targetType = targetType;
        if (
            targetRole !== undefined &&
            targetRole !== null &&
            targetRole !== ''
        ) {
            const parsedRole = Number(targetRole);
            if (!Number.isNaN(parsedRole)) query.targetRole = parsedRole;
        }
        if (floorId) query.floorId = floorId;

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

        const pageNum = parseInt((current || page) as string);
        const pageLimit = parseInt((pageSize || limit) as string);

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

        const mapped = (notifications || []).map((notif: any) => {
            const resolvedUserId = notif.userId?._id || notif.userId;
            const userName = resolvedUserId
                ? getUserDisplayNameFromMap(resolvedUserId, userMap) ||
                  getUserDisplayName(notif.userId as any)
                : undefined;
            return formatRouteDateTimes(
                {
                    id: String(notif._id),
                    title: notif.title,
                    content: notif.content,
                    type: notif.type,
                    time: notif.time,
                    isRead: notif.isRead,
                    relatedId: notif.relatedId,
                    userId: resolvedUserId,
                    userName,
                    userAvatar:
                        (resolvedUserId &&
                            userMap[String(resolvedUserId)]?.avatar) ||
                        notif.userId?.avatar ||
                        '' ||
                        '',
                    publisher: notif.createdBy?._id || notif.createdBy,
                    publisherName:
                        getUserDisplayName(notif.createdBy as any) ||
                        getUserDisplayNameFromMap(notif.createdBy, userMap),
                    updatedBy: notif.updatedBy?._id || notif.updatedBy,
                    updatedByName:
                        getUserDisplayName(notif.updatedBy as any) ||
                        getUserDisplayNameFromMap(notif.updatedBy, userMap),
                    targetType: notif.targetType,
                    targetRole: notif.targetRole,
                    floorId: notif.floorId,
                },
                ['time']
            );
        });

        ctx.body = {
            success: true,
            data: {
                list: mapped,
                total,
                page: pageNum,
                pageSize: pageLimit,
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
 * @route GET /api/notification/template-ids
 * @desc Get configured WeChat subscription template IDs
 */
router.get('/template-ids', authMiddleware, async (ctx) => {
    try {
        const bookingSuccessTemplateId =
            wechatTemplateConfig.BOOKING_SUCCESS.templateId;
        const bookingReminderTemplateId =
            wechatTemplateConfig.BOOKING_REMINDER.templateId;

        ctx.body = {
            success: true,
            data: {
                BOOKING_SUCCESS: bookingSuccessTemplateId.startsWith(
                    'TEMPLATE_ID_'
                )
                    ? ''
                    : bookingSuccessTemplateId,
                BOOKING_REMINDER: bookingReminderTemplateId.startsWith(
                    'TEMPLATE_ID_'
                )
                    ? ''
                    : bookingReminderTemplateId,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get template IDs',
            ErrorCodes.INTERNAL_ERROR
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
        const {
            targetType = 'user',
            userId,
            role,
            floorId,
            type,
            title,
            content,
            time,
            relatedId,
            data,
            templateType,
            templateData,
        } = body;

        if (type === undefined || !title || !content) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        let resolvedTemplateType: WechatTemplateType | undefined;
        let resolvedTemplateId: string | undefined;
        let resolvedTemplatePage: string | undefined;
        let resolvedTemplatePayload: any;
        let resolvedTemplateSourceData: any;

        if (templateType) {
            if (!wechatTemplateConfig[templateType as WechatTemplateType]) {
                throw new CustomError(
                    'Invalid template type',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            resolvedTemplateType = templateType as WechatTemplateType;
            const config = wechatTemplateConfig[resolvedTemplateType];
            resolvedTemplateId = config.templateId;
            resolvedTemplatePage = config.page;
            resolvedTemplateSourceData = templateData || data || {};
            resolvedTemplatePayload = buildWechatTemplatePayload(
                resolvedTemplateType,
                resolvedTemplateSourceData
            );
        }

        const normalizedType = normalizeNotificationType(type);
        const createdByFields = buildAuditFields(ctx);
        const timestamp = time ? new Date(time) : new Date();

        let recipients: Array<{ _id: any }> = [];
        let targetRoleValue: number | undefined;
        let targetFloorValue: string | undefined;

        if (targetType === 'all') {
            recipients = await User.find().select('_id').lean();
        } else if (targetType === 'role') {
            if (role === undefined || role === null) {
                throw new CustomError(
                    'Missing role for role audience',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            targetRoleValue = Number(role);
            recipients = await User.find({ role: targetRoleValue })
                .select('_id')
                .lean();
        } else if (targetType === 'floor') {
            if (!floorId) {
                throw new CustomError(
                    'Missing floorId for floor audience',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            targetFloorValue = floorId;
            const bookings = await Booking.findAll({
                include: [
                    {
                        model: Seat,
                        as: 'seat',
                        where: { floorId },
                        attributes: ['floorId'],
                    },
                ],
                attributes: ['userId'],
                group: ['userId'],
            });
            const userIds = Array.from(
                new Set(bookings.map((booking: any) => booking.userId))
            );
            if (userIds.length > 0) {
                recipients = await User.find({ _id: { $in: userIds } })
                    .select('_id')
                    .lean();
            }
        } else {
            if (!userId) {
                throw new CustomError(
                    'Missing userId for user audience',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            const targetUser = await User.findById(userId);
            if (!targetUser) {
                throw new CustomError(
                    'Target user not found',
                    ErrorCodes.USER_NOT_FOUND
                );
            }
            recipients = [targetUser];
        }

        if (!recipients.length) {
            throw new CustomError(
                'No target users matched the selected audience',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const docs = recipients.map((recipient) => ({
            userId: recipient._id,
            targetType,
            targetRole: targetRoleValue,
            floorId: targetFloorValue,
            ...createdByFields,
            type: normalizedType ?? type,
            title,
            content,
            relatedId,
            data,
            templateType: resolvedTemplateType,
            templateId: resolvedTemplateId,
            templatePage: resolvedTemplatePage,
            templateData: resolvedTemplateSourceData,
            templatePayload: resolvedTemplatePayload,
            time: timestamp,
        }));

        const created = await Notification.insertMany(docs as any[]);

        ctx.body = {
            success: true,
            data: { created: created.length },
        };
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
        Object.assign(notification, buildUpdatedBy(ctx));
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

        const result: any = await Notification.updateMany(
            { userId: currentUser.id, isRead: false },
            { $set: { isRead: true } }
        );

        ctx.body = {
            success: true,
            data: {
                matched: result?.matchedCount ?? result?.n ?? 0,
                modified: result?.modifiedCount ?? result?.nModified ?? 0,
            },
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
        const createdBy = notification.createdBy as any;
        const updatedBy = notification.updatedBy as any;
        const createdByKey = String(createdBy?._id ?? createdBy ?? '');
        const updatedByKey = String(updatedBy?._id ?? updatedBy ?? '');

        const resolvedUserId = notification.userId?._id || notification.userId;
        const userName = resolvedUserId
            ? getUserDisplayNameFromMap(resolvedUserId, userMap) ||
              getUserDisplayName(notification.userId as any)
            : undefined;

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(
                {
                    id: notification._id,
                    userId: resolvedUserId,
                    userName,
                    title: notification.title,
                    content: notification.content,
                    type: notification.type,
                    data: notification.data,
                    relatedId: notification.relatedId,
                    time: notification.time,
                    isRead: notification.isRead,
                    publisher: createdBy?._id || createdBy,
                    publisherName:
                        getUserDisplayName(createdBy as any) ||
                        getUserDisplayNameFromMap(createdByKey, userMap),
                    updatedBy: updatedBy?._id || updatedBy,
                    updatedByName:
                        getUserDisplayName(updatedBy as any) ||
                        getUserDisplayNameFromMap(updatedByKey, userMap),
                },
                ['time']
            ),
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
        if (body.userId !== undefined) {
            if (!body.userId) {
                throw new CustomError(
                    'Missing userId',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            const targetUser = await User.findById(body.userId);
            if (!targetUser) {
                throw new CustomError(
                    'Target user not found',
                    ErrorCodes.USER_NOT_FOUND
                );
            }
            allowed.userId = targetUser._id;
        }

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
