import Router from 'koa-router';
import {
    BookingChangeRequest,
    Booking,
    Seat,
    TimeSlotStatus,
} from '../models/mysql';
import {
    ChangeRequestStatus,
    ChangeRequestType,
    BookingStatus,
    TimeSlotStatusValue,
} from '../models/mysql/types';
import { User } from '../models/mongodb';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { ErrorCodes } from '../utils/error-codes';
import { writeAuditLog } from '../services/audit-service';
import { buildAuditFields } from '../utils/audit';
import { getUserDisplayNameFromMap } from '../utils/user-display';
import sequelize from '../database/mysql';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/booking/change-requests' });

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function toPlainRequest(item: any) {
    return typeof item?.toJSON === 'function' ? item.toJSON() : item;
}

function resolveUserName(
    userId: any,
    userMap: Record<string, any>
): string | undefined {
    if (!userId) return undefined;
    const fromMap = getUserDisplayNameFromMap(userId, userMap);
    if (fromMap) return fromMap;

    const raw = String(userId).trim();
    if (!raw || OBJECT_ID_PATTERN.test(raw)) return undefined;
    return raw;
}

async function buildUserMapForRequests(items: any[]) {
    const ids = Array.from(
        new Set(
            items
                .flatMap((item) => {
                    const plain = toPlainRequest(item);
                    return [
                        plain?.userId,
                        plain?.reviewerId,
                        plain?.createdBy,
                        plain?.updatedBy,
                    ];
                })
                .filter(Boolean)
                .map((id) => String(id))
        )
    );

    if (!ids.length) return {} as Record<string, any>;

    const users = await User.find({ _id: { $in: ids } })
        .select('name username')
        .lean();
    const userMap: Record<string, any> = {};
    users.forEach((user: any) => {
        userMap[String(user._id)] = user;
    });
    return userMap;
}

function normalizeRequestRecord(item: any, userMap: Record<string, any>) {
    const plain = toPlainRequest(item);
    const userId = plain?.userId ? String(plain.userId) : plain?.userId;
    const reviewerId = plain?.reviewerId
        ? String(plain.reviewerId)
        : plain?.reviewerId;
    const createdBy = plain?.createdBy
        ? String(plain.createdBy)
        : plain?.createdBy;
    const updatedBy = plain?.updatedBy
        ? String(plain.updatedBy)
        : plain?.updatedBy;

    const userName = resolveUserName(userId, userMap);
    return {
        ...plain,
        id: Number(plain.id),
        userId,
        userName,
        reviewerId,
        reviewerName: resolveUserName(reviewerId, userMap),
        createdBy,
        createdByName: resolveUserName(createdBy, userMap),
        updatedBy,
        updatedByName: resolveUserName(updatedBy, userMap),
    };
}

/**
 * POST /api/booking/change-requests - 提交变更申请
 * Body: { bookingId, changeType, targetSeatId?, targetDate?, targetTimeSlot?, reason }
 */
router.post('/', authMiddleware, async (ctx) => {
    try {
        const user = (ctx as any).state.user;
        const {
            bookingId,
            changeType,
            targetSeatId,
            targetDate,
            targetTimeSlot,
            reason,
        } = ctx.request.body as any;

        if (!bookingId || !changeType) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: '缺少必要参数',
                },
            };
            return;
        }

        // 校验 changeType
        if (!Object.values(ChangeRequestType).includes(changeType)) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: '无效的变更类型',
                },
            };
            return;
        }

        // 检查预约是否存在且属于当前用户
        const booking = await Booking.findByPk(bookingId);
        if (!booking) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_NOT_FOUND,
                    message: '预约不存在',
                },
            };
            return;
        }
        if (booking.userId !== user.id) {
            ctx.status = 403;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.FORBIDDEN,
                    message: '无权操作此预约',
                },
            };
            return;
        }

        // 只有 upcoming/ongoing 状态的预约可以变更
        if (
            ![BookingStatus.UPCOMING, BookingStatus.ONGOING].includes(
                booking.status
            )
        ) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: '当前预约状态不可变更',
                },
            };
            return;
        }

        // 检查是否有待处理的相同申请
        const existingRequest = await BookingChangeRequest.findOne({
            where: {
                bookingId,
                userId: user.id,
                status: ChangeRequestStatus.PENDING,
            },
        });
        if (existingRequest) {
            ctx.status = 409;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_DUPLICATE,
                    message: '已有待处理的变更申请',
                },
            };
            return;
        }

        const request = await BookingChangeRequest.create({
            bookingId,
            userId: user.id,
            changeType,
            targetSeatId: targetSeatId || null,
            targetDate: targetDate || null,
            targetTimeSlot:
                targetTimeSlot !== undefined ? targetTimeSlot : null,
            reason: reason || null,
            ...buildAuditFields(ctx),
        });

        await writeAuditLog(ctx, {
            action: 'change_request.create',
            targetType: 'booking',
            targetId: String(bookingId),
            metadata: { changeType, requestId: request.id },
        });

        const userMap = await buildUserMapForRequests([request]);
        ctx.body = {
            success: true,
            data: formatRouteDateTimes(
                normalizeRequestRecord(request, userMap)
            ),
        };
    } catch (error) {
        console.error('[change-requests] POST / error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: '提交变更申请失败',
            },
        };
    }
});

/**
 * GET /api/booking/change-requests - 查询我的变更申请
 */
router.get('/', authMiddleware, async (ctx) => {
    try {
        const user = (ctx as any).state.user;
        const { status, page = '1', pageSize = '20' } = ctx.query;

        const where: Record<string, any> = { userId: user.id };
        if (status) where.status = status;

        const safePage = Math.max(1, Number(page));
        const safePageSize = Math.min(100, Math.max(1, Number(pageSize)));

        const { rows, count } = await BookingChangeRequest.findAndCountAll({
            where,
            include: [
                {
                    model: Booking,
                    as: 'booking',
                    include: [{ model: Seat, as: 'seat' }],
                },
            ],
            order: [['createdAt', 'DESC']],
            limit: safePageSize,
            offset: (safePage - 1) * safePageSize,
        });

        const userMap = await buildUserMapForRequests(rows as any[]);
        const list = (rows as any[]).map((item) =>
            formatRouteDateTimes(normalizeRequestRecord(item, userMap))
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total: count,
                page: safePage,
                pageSize: safePageSize,
            },
        };
    } catch (error) {
        console.error('[change-requests] GET / error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: '查询变更申请失败',
            },
        };
    }
});

/**
 * GET /api/booking/change-requests/admin - 管理员查询所有申请
 */
router.get('/admin', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { status, userId, page = '1', pageSize = '20' } = ctx.query;
        const where: Record<string, any> = {};
        if (status) where.status = status;
        if (userId) where.userId = userId;

        const safePage = Math.max(1, Number(page));
        const safePageSize = Math.min(100, Math.max(1, Number(pageSize)));

        const { rows, count } = await BookingChangeRequest.findAndCountAll({
            where,
            include: [
                {
                    model: Booking,
                    as: 'booking',
                    include: [{ model: Seat, as: 'seat' }],
                },
            ],
            order: [['createdAt', 'DESC']],
            limit: safePageSize,
            offset: (safePage - 1) * safePageSize,
        });

        const userMap = await buildUserMapForRequests(rows as any[]);
        const list = (rows as any[]).map((item) =>
            formatRouteDateTimes(normalizeRequestRecord(item, userMap))
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total: count,
                page: safePage,
                pageSize: safePageSize,
            },
        };
    } catch (error) {
        console.error('[change-requests] GET /admin error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: '查询变更申请失败',
            },
        };
    }
});

/**
 * PUT /api/booking/change-requests/:id/approve - 批准申请
 * Body: { reviewComment? }
 */
router.put('/:id/approve', authMiddleware, adminMiddleware, async (ctx) => {
    const t = await sequelize.transaction();
    try {
        const reviewer = (ctx as any).state.user;
        const { id } = ctx.params;
        const { reviewComment } = ctx.request.body as any;

        const request = await BookingChangeRequest.findByPk(Number(id), {
            transaction: t,
        });
        if (!request) {
            await t.rollback();
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_NOT_FOUND,
                    message: '申请不存在',
                },
            };
            return;
        }

        if (request.status !== ChangeRequestStatus.PENDING) {
            await t.rollback();
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_ALREADY_REVIEWED,
                    message: '申请已审批',
                },
            };
            return;
        }

        // 执行变更
        const booking = await Booking.findByPk(request.bookingId, {
            transaction: t,
        });
        if (!booking) {
            await t.rollback();
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_NOT_FOUND,
                    message: '原预约不存在',
                },
            };
            return;
        }

        if (request.changeType === ChangeRequestType.CANCEL) {
            // 取消预约
            await booking.update(
                { status: BookingStatus.CANCELED },
                { transaction: t }
            );
            await TimeSlotStatus.update(
                {
                    status: TimeSlotStatusValue.AVAILABLE,
                    bookingId: undefined as any,
                },
                { where: { bookingId: booking.id }, transaction: t }
            );
        } else if (request.changeType === ChangeRequestType.RESCHEDULE) {
            // 检查目标时段可用性
            if (request.targetDate && request.targetTimeSlot !== null) {
                const targetSlot = await TimeSlotStatus.findOne({
                    where: {
                        seatId: booking.seatId,
                        date: request.targetDate,
                        timeSlot: request.targetTimeSlot!,
                        status: TimeSlotStatusValue.BOOKED,
                    },
                    transaction: t,
                });
                if (targetSlot) {
                    await t.rollback();
                    ctx.status = 400;
                    ctx.body = {
                        success: false,
                        error: {
                            code: ErrorCodes.CHANGE_REQUEST_TARGET_UNAVAILABLE,
                            message: '目标时段不可用',
                        },
                    };
                    return;
                }

                // 释放原时段
                await TimeSlotStatus.update(
                    {
                        status: TimeSlotStatusValue.AVAILABLE,
                        bookingId: undefined as any,
                    },
                    { where: { bookingId: booking.id }, transaction: t }
                );

                // 更新预约
                await booking.update(
                    {
                        date: request.targetDate,
                        timeSlot: request.targetTimeSlot!,
                        status: BookingStatus.UPCOMING,
                    },
                    { transaction: t }
                );

                // 占用新时段
                await TimeSlotStatus.upsert(
                    {
                        seatId: booking.seatId,
                        date: request.targetDate as any,
                        timeSlot: request.targetTimeSlot!,
                        status: TimeSlotStatusValue.BOOKED,
                        bookingId: booking.id,
                    },
                    { transaction: t }
                );
            }
        } else if (
            request.changeType === ChangeRequestType.SEAT_CHANGE &&
            request.targetSeatId
        ) {
            // 检查目标座位可用性
            const targetSlot = await TimeSlotStatus.findOne({
                where: {
                    seatId: request.targetSeatId,
                    date: booking.date,
                    timeSlot: booking.timeSlot,
                    status: TimeSlotStatusValue.BOOKED,
                },
                transaction: t,
            });
            if (targetSlot) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_TARGET_UNAVAILABLE,
                        message: '目标座位该时段不可用',
                    },
                };
                return;
            }

            // 释放原座位时段
            await TimeSlotStatus.update(
                {
                    status: TimeSlotStatusValue.AVAILABLE,
                    bookingId: undefined as any,
                },
                { where: { bookingId: booking.id }, transaction: t }
            );

            // 更新预约座位
            await booking.update(
                { seatId: request.targetSeatId },
                { transaction: t }
            );

            // 占用新座位时段
            await TimeSlotStatus.upsert(
                {
                    seatId: request.targetSeatId,
                    date: booking.date,
                    timeSlot: booking.timeSlot,
                    status: TimeSlotStatusValue.BOOKED,
                    bookingId: booking.id,
                },
                { transaction: t }
            );
        }

        // 更新申请状态
        await request.update(
            {
                status: ChangeRequestStatus.APPROVED,
                reviewerId: reviewer.id,
                reviewComment: reviewComment || null,
                reviewedAt: new Date(),
                ...buildAuditFields(ctx, { created: false, updated: true }),
            },
            { transaction: t }
        );

        await t.commit();

        await writeAuditLog(ctx, {
            action: 'change_request.approve',
            targetType: 'booking',
            targetId: String(request.bookingId),
            changes: { requestId: request.id, changeType: request.changeType },
        });

        const userMap = await buildUserMapForRequests([request]);
        ctx.body = {
            success: true,
            data: formatRouteDateTimes(
                normalizeRequestRecord(request, userMap)
            ),
        };
    } catch (error) {
        await t.rollback();
        console.error('[change-requests] PUT /:id/approve error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: { code: ErrorCodes.INTERNAL_ERROR, message: '审批失败' },
        };
    }
});

/**
 * PUT /api/booking/change-requests/:id/reject - 拒绝申请
 * Body: { reviewComment }
 */
router.put('/:id/reject', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const reviewer = (ctx as any).state.user;
        const { id } = ctx.params;
        const { reviewComment } = ctx.request.body as any;

        const request = await BookingChangeRequest.findByPk(Number(id));
        if (!request) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_NOT_FOUND,
                    message: '申请不存在',
                },
            };
            return;
        }

        if (request.status !== ChangeRequestStatus.PENDING) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_ALREADY_REVIEWED,
                    message: '申请已审批',
                },
            };
            return;
        }

        await request.update({
            status: ChangeRequestStatus.REJECTED,
            reviewerId: reviewer.id,
            reviewComment: reviewComment || null,
            reviewedAt: new Date(),
            ...buildAuditFields(ctx, { created: false, updated: true }),
        });

        await writeAuditLog(ctx, {
            action: 'change_request.reject',
            targetType: 'booking',
            targetId: String(request.bookingId),
            changes: { requestId: request.id, reviewComment },
        });

        const userMap = await buildUserMapForRequests([request]);
        ctx.body = {
            success: true,
            data: formatRouteDateTimes(
                normalizeRequestRecord(request, userMap)
            ),
        };
    } catch (error) {
        console.error('[change-requests] PUT /:id/reject error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: { code: ErrorCodes.INTERNAL_ERROR, message: '拒绝申请失败' },
        };
    }
});

export default router;
