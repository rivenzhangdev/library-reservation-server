import Router from 'koa-router';
import {
    BookingChangeRequest,
    Booking,
    Floor,
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
import {
    authMiddleware,
    adminMiddleware,
    ensureNotBlacklisted,
} from '../middleware/auth';
import { ErrorCodes } from '../utils/error-codes';
import { writeAuditLog } from '../services/audit-service';
import { buildAuditFields } from '../utils/audit';
import { getUserDisplayNameFromMap } from '../utils/user-display';
import sequelize from '../database/mysql';
import { formatRouteDateTimes } from '../utils/route-time-serializer';
import { Op } from 'sequelize';
import { getBookingEndSlot } from '../services/booking-service';
import {
    getTimeSlotConfigItem,
    getTimeSlotConfigItems,
} from '../utils/time-slot-config';
import { getBookingRuleNumber } from './booking-rules';

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

    const objectIds = ids.filter((id) => OBJECT_ID_PATTERN.test(id));
    if (!objectIds.length) return {} as Record<string, any>;

    const users = await User.find({ _id: { $in: objectIds } })
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

function buildTargetSeatLabel(seat: any): string {
    if (!seat) return '';
    const floorName = String(seat?.floor?.name || seat?.floorName || '').trim();
    const zone = String(seat?.zone || '').trim();
    const row = Number(seat?.rowNum ?? seat?.row ?? 0);
    const col = Number(seat?.colNum ?? seat?.col ?? 0);
    const position = row > 0 && col > 0 ? `R${row}C${col}` : '';
    return [floorName || zone, position].filter(Boolean).join(' ');
}

async function enrichRequestDisplayFields(items: any[]) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return list;

    const slotConfigs = await getTimeSlotConfigItems();
    const slotLabelMap: Record<number, string> = {};
    for (const config of slotConfigs) {
        const slot = Number(config?.timeSlot);
        if (!Number.isInteger(slot) || slot < 0) continue;
        const label = String(config?.label || '').trim();
        const start = normalizeTimeText(config?.startTime);
        const end = normalizeTimeText(config?.endTime);
        const rangeText = start && end ? `${start}-${end}` : '';
        slotLabelMap[slot] =
            [label, rangeText].filter(Boolean).join(' ').trim() || String(slot);
    }

    const targetSeatIds = Array.from(
        new Set(
            list
                .map((item) => Number(item?.targetSeatId))
                .filter((id) => Number.isInteger(id) && id > 0)
        )
    );

    const seatLabelMap: Record<number, string> = {};
    if (targetSeatIds.length > 0) {
        const seats = await Seat.findAll({
            where: {
                id: {
                    [Op.in]: targetSeatIds,
                },
            },
            include: [
                {
                    model: Floor,
                    as: 'floor',
                    required: false,
                },
            ],
        });

        for (const seat of seats as any[]) {
            const seatId = Number(seat?.id);
            if (!Number.isInteger(seatId) || seatId <= 0) continue;
            seatLabelMap[seatId] = buildTargetSeatLabel(seat);
        }
    }

    return list.map((item) => {
        const targetTimeSlot = Number(item?.targetTimeSlot);
        const targetSeatId = Number(item?.targetSeatId);
        return {
            ...item,
            targetTimeSlotLabel:
                Number.isInteger(targetTimeSlot) && targetTimeSlot >= 0
                    ? slotLabelMap[targetTimeSlot] || String(targetTimeSlot)
                    : '',
            targetSeatLabel:
                Number.isInteger(targetSeatId) && targetSeatId > 0
                    ? seatLabelMap[targetSeatId] || ''
                    : '',
        };
    });
}

function normalizeDateText(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeTimeText(value: unknown): string {
    const text = String(value ?? '').trim();
    return text.length >= 5 ? text.slice(0, 5) : text;
}

function parseDateOnlyText(value: string): Date | null {
    const m = String(value || '')
        .trim()
        .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
}

function getTodayStart() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
}

function getMinutesNow() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

function parseClockMinutes(value: string): number | null {
    const m = String(value || '')
        .trim()
        .match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
}

function isTargetSlotAlreadyPast(
    targetDateText: string,
    targetSlot: number,
    slotConfigs: any[]
) {
    const targetDate = parseDateOnlyText(targetDateText);
    if (!targetDate) return true;

    const today = getTodayStart();
    if (targetDate.getTime() > today.getTime()) return false;
    if (targetDate.getTime() < today.getTime()) return true;

    const slotConfig = getTimeSlotConfigItem(targetSlot, slotConfigs);
    const endMinutes = parseClockMinutes(String(slotConfig?.endTime || ''));
    if (endMinutes === null) {
        return false;
    }
    return endMinutes <= getMinutesNow();
}

/**
 * POST /api/booking/change-requests - 提交变更申请
 * Body: { bookingId, changeType, targetSeatId?, targetDate?, targetTimeSlot?, reason }
 */
router.post('/', authMiddleware, async (ctx) => {
    try {
        ensureNotBlacklisted(ctx);
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
                    message: 'Missing required parameters',
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
                    message: 'Invalid change request type',
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
                    message: 'Booking not found',
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
                    message: 'Permission denied to operate on this booking',
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
                    message: 'Current booking status does not allow changes',
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
            const userMap = await buildUserMapForRequests([existingRequest]);
            const [displayRequest] = await enrichRequestDisplayFields([
                formatRouteDateTimes(
                    normalizeRequestRecord(existingRequest, userMap)
                ),
            ]);
            ctx.status = 409;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.CHANGE_REQUEST_DUPLICATE,
                    message:
                        'Pending change request already exists for this booking',
                },
                data: {
                    existingRequest: displayRequest,
                },
            };
            return;
        }

        const maxChangePerBooking = await getBookingRuleNumber(
            'change_request.maxPerBooking',
            3
        );
        if (Number.isFinite(maxChangePerBooking) && maxChangePerBooking > 0) {
            const totalRequestCount = await BookingChangeRequest.count({
                where: {
                    bookingId,
                    userId: user.id,
                },
            });
            if (totalRequestCount >= Math.floor(maxChangePerBooking)) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_LIMIT_EXCEEDED,
                        message: `Change request limit reached (${Math.floor(
                            maxChangePerBooking
                        )} per booking)`,
                    },
                };
                return;
            }
        }

        const normalizedReason = String(reason ?? '').trim();
        if (!normalizedReason) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: 'Reason is required',
                },
            };
            return;
        }

        const normalizedTargetDate = normalizeDateText(targetDate);
        const normalizedTargetTimeSlot =
            targetTimeSlot === undefined || targetTimeSlot === null
                ? NaN
                : Number(targetTimeSlot);

        if (changeType === ChangeRequestType.RESCHEDULE) {
            if (
                !normalizedTargetDate ||
                !Number.isInteger(normalizedTargetTimeSlot) ||
                normalizedTargetTimeSlot < 0
            ) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.INVALID_PARAMS,
                        message:
                            'targetDate and targetTimeSlot are required for reschedule request',
                    },
                };
                return;
            }

            const bookingDateText = normalizeDateText(booking.date);
            const targetDateObj = parseDateOnlyText(normalizedTargetDate);
            if (!targetDateObj) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: 'Invalid target date',
                    },
                };
                return;
            }

            const today = getTodayStart();
            const maxAdvanceBookingDays = await getBookingRuleNumber(
                'advance_booking_days',
                7
            );
            const maxDate = new Date(today);
            maxDate.setDate(
                maxDate.getDate() +
                    Math.max(0, Math.floor(maxAdvanceBookingDays))
            );

            if (targetDateObj.getTime() < today.getTime()) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: 'Target date cannot be earlier than today',
                    },
                };
                return;
            }

            if (targetDateObj.getTime() > maxDate.getTime()) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: `Target date exceeds advance booking limit (${Math.floor(
                            maxAdvanceBookingDays
                        )} days)`,
                    },
                };
                return;
            }

            const currentStartSlot = Number(booking.timeSlot);
            const currentEndSlot =
                (await getBookingEndSlot(booking)) ?? currentStartSlot;
            const targetStartSlot = normalizedTargetTimeSlot;
            const targetEndSlot =
                targetStartSlot +
                Math.max(0, currentEndSlot - currentStartSlot);

            if (
                normalizedTargetDate === bookingDateText &&
                targetStartSlot === currentStartSlot
            ) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.INVALID_PARAMS,
                        message:
                            'Target time slot cannot be the same as current time slot',
                    },
                };
                return;
            }

            if (
                normalizedTargetDate === bookingDateText &&
                targetStartSlot > currentEndSlot
            ) {
                ctx.status = 409;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.BOOKING_CONFLICT,
                        message:
                            'Please use renewal for extending booking to later slots',
                    },
                };
                return;
            }

            const timeSlotConfigs = await getTimeSlotConfigItems();
            if (
                isTargetSlotAlreadyPast(
                    normalizedTargetDate,
                    targetStartSlot,
                    timeSlotConfigs
                )
            ) {
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: 'Target time slot has already passed',
                    },
                };
                return;
            }

            const sameDayBookings = await Booking.findAll({
                where: {
                    userId: user.id,
                    date: normalizedTargetDate,
                    id: { [Op.ne]: booking.id },
                    status: {
                        [Op.in]: [
                            BookingStatus.UPCOMING,
                            BookingStatus.ONGOING,
                            BookingStatus.COMPLETED,
                            BookingStatus.VIOLATED,
                        ],
                    },
                },
            });

            for (const item of sameDayBookings as any[]) {
                const existingStartSlot = Number(item.timeSlot);
                const existingEndSlot =
                    (await getBookingEndSlot(item)) ?? existingStartSlot;

                const slotOverlapped =
                    targetStartSlot <= existingEndSlot &&
                    targetEndSlot >= existingStartSlot;
                if (slotOverlapped) {
                    ctx.status = 409;
                    ctx.body = {
                        success: false,
                        error: {
                            code: ErrorCodes.BOOKING_CONFLICT,
                            message:
                                'Target time slot overlaps with your other booking',
                        },
                    };
                    return;
                }
            }
        }

        const request = await BookingChangeRequest.create({
            bookingId,
            userId: user.id,
            changeType,
            targetSeatId: targetSeatId || null,
            targetDate: targetDate || null,
            targetTimeSlot:
                targetTimeSlot !== undefined ? targetTimeSlot : null,
            reason: normalizedReason,
            ...buildAuditFields(ctx),
        });

        await writeAuditLog(ctx, {
            action: 'change_request.create',
            targetType: 'booking',
            targetId: String(bookingId),
            metadata: { changeType, requestId: request.id },
        });

        const userMap = await buildUserMapForRequests([request]);
        const [displayRequest] = await enrichRequestDisplayFields([
            formatRouteDateTimes(normalizeRequestRecord(request, userMap)),
        ]);
        ctx.body = {
            success: true,
            data: displayRequest,
        };
    } catch (error) {
        console.error('[change-requests] POST / error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: 'Failed to submit change request',
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
        const normalizedStatus = String(status ?? '').trim();
        if (
            normalizedStatus &&
            normalizedStatus !== 'undefined' &&
            normalizedStatus !== 'null'
        ) {
            where.status = normalizedStatus;
        }

        const safePage = Math.max(1, Number(page));
        const safePageSize = Math.min(100, Math.max(1, Number(pageSize)));

        const { rows, count } = await BookingChangeRequest.findAndCountAll({
            where,
            include: [
                {
                    model: Booking,
                    as: 'booking',
                    required: false,
                    include: [{ model: Seat, as: 'seat', required: false }],
                },
            ],
            order: [['id', 'DESC']],
            limit: safePageSize,
            offset: (safePage - 1) * safePageSize,
        });

        const userMap = await buildUserMapForRequests(rows as any[]);
        const normalizedList = (rows as any[]).map((item) =>
            formatRouteDateTimes(normalizeRequestRecord(item, userMap))
        );
        const list = await enrichRequestDisplayFields(normalizedList);

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
        const detail =
            error instanceof Error && error.message ? `：${error.message}` : '';
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: `Failed to query change requests${detail}`,
            },
        };
    }
});

/**
 * POST /api/booking/change-requests/:id/withdraw - 撤回变更申请
 */
router.post('/:id/withdraw', authMiddleware, async (ctx) => {
    try {
        const user = (ctx as any).state.user;
        const requestId = ctx.params.id;

        const request = await BookingChangeRequest.findByPk(requestId);
        if (!request) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.NOT_FOUND,
                    message: 'Change request not found',
                },
            };
            return;
        }

        if (request.userId !== user.id) {
            ctx.status = 403;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.FORBIDDEN,
                    message: 'Permission denied to withdraw this request',
                },
            };
            return;
        }

        if (request.status !== ChangeRequestStatus.PENDING) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: 'Only pending requests can be withdrawn',
                },
            };
            return;
        }

        await request.destroy(); // Hard delete or update status based on preference, here hard delete to free up slot

        await writeAuditLog(ctx, {
            action: 'change_request.withdraw',
            targetType: 'booking',
            targetId: String(request.bookingId),
            metadata: { requestId: request.id },
        });

        ctx.body = {
            success: true,
            data: { id: requestId },
        };
    } catch (error) {
        console.error('[change-requests] POST /:id/withdraw error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: 'Failed to withdraw change request',
            },
        };
    }
});

/**
 * GET /api/booking/change-requests/admin - 管理员查询所有申请
 */
router.get('/admin', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const {
            status,
            userId,
            changeType,
            page = '1',
            pageSize = '20',
        } = ctx.query;
        const where: Record<string, any> = {};
        const normalizedStatus = String(status ?? '').trim();
        const normalizedUserId = String(userId ?? '').trim();
        const normalizedChangeType = String(changeType ?? '').trim();

        if (
            normalizedStatus &&
            normalizedStatus !== 'undefined' &&
            normalizedStatus !== 'null'
        ) {
            where.status = normalizedStatus;
        }
        if (
            normalizedUserId &&
            normalizedUserId !== 'undefined' &&
            normalizedUserId !== 'null'
        ) {
            where.userId = normalizedUserId;
        }
        if (
            normalizedChangeType &&
            normalizedChangeType !== 'undefined' &&
            normalizedChangeType !== 'null'
        ) {
            where.changeType = normalizedChangeType;
        }

        const safePage = Math.max(1, Number(page));
        const safePageSize = Math.min(100, Math.max(1, Number(pageSize)));

        const { rows, count } = await BookingChangeRequest.findAndCountAll({
            where,
            include: [
                {
                    model: Booking,
                    as: 'booking',
                    required: false,
                    include: [{ model: Seat, as: 'seat', required: false }],
                },
            ],
            order: [['id', 'DESC']],
            limit: safePageSize,
            offset: (safePage - 1) * safePageSize,
        });

        const userMap = await buildUserMapForRequests(rows as any[]);
        const normalizedList = (rows as any[]).map((item) =>
            formatRouteDateTimes(normalizeRequestRecord(item, userMap))
        );
        const list = await enrichRequestDisplayFields(normalizedList);

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
        const detail =
            error instanceof Error && error.message ? `：${error.message}` : '';
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: `查询变更申请失败${detail}`,
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
            if (!request.targetDate || request.targetTimeSlot === null) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.INVALID_PARAMS,
                        message: '改时段申请缺少目标日期或目标时段',
                    },
                };
                return;
            }

            const bookingDateText = normalizeDateText(booking.date);
            const targetDateText = normalizeDateText(request.targetDate);
            const targetStartSlot = Number(request.targetTimeSlot);
            const currentStartSlot = Number(booking.timeSlot);
            const currentEndSlot =
                (await getBookingEndSlot(booking)) ?? currentStartSlot;
            const slotSpan = Math.max(0, currentEndSlot - currentStartSlot);
            const targetEndSlot = targetStartSlot + slotSpan;

            if (!Number.isInteger(targetStartSlot) || targetStartSlot < 0) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: '改时段目标日期或时段无效',
                    },
                };
                return;
            }

            const targetDateObj = parseDateOnlyText(targetDateText);
            if (!targetDateObj) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: '目标日期格式无效',
                    },
                };
                return;
            }

            const today = getTodayStart();
            const maxAdvanceBookingDays = await getBookingRuleNumber(
                'advance_booking_days',
                7
            );
            const maxDate = new Date(today);
            maxDate.setDate(
                maxDate.getDate() +
                    Math.max(0, Math.floor(maxAdvanceBookingDays))
            );
            if (
                targetDateObj.getTime() < today.getTime() ||
                targetDateObj.getTime() > maxDate.getTime()
            ) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: '目标日期超出可预约范围',
                    },
                };
                return;
            }

            if (
                targetDateText === bookingDateText &&
                targetStartSlot > currentEndSlot
            ) {
                await t.rollback();
                ctx.status = 409;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.BOOKING_CONFLICT,
                        message: '与续约规则冲突，请使用续约功能',
                    },
                };
                return;
            }

            const timeSlotConfigs = await getTimeSlotConfigItems();
            if (
                isTargetSlotAlreadyPast(
                    targetDateText,
                    targetStartSlot,
                    timeSlotConfigs
                )
            ) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.CHANGE_REQUEST_INVALID_TARGET,
                        message: '目标时段已过，不可审批通过',
                    },
                };
                return;
            }

            const targetSlots: number[] = [];
            for (let slot = targetStartSlot; slot <= targetEndSlot; slot += 1) {
                targetSlots.push(slot);
            }

            const targetSlotRecords = await TimeSlotStatus.findAll({
                where: {
                    seatId: booking.seatId,
                    date: request.targetDate,
                    timeSlot: { [Op.in]: targetSlots },
                    status: TimeSlotStatusValue.BOOKED,
                    bookingId: { [Op.ne]: booking.id },
                },
                transaction: t,
            });

            if (targetSlotRecords.length > 0) {
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

            const sameDayBookings = await Booking.findAll({
                where: {
                    userId: booking.userId,
                    date: request.targetDate,
                    id: { [Op.ne]: booking.id },
                    status: {
                        [Op.in]: [
                            BookingStatus.UPCOMING,
                            BookingStatus.ONGOING,
                            BookingStatus.COMPLETED,
                            BookingStatus.VIOLATED,
                        ],
                    },
                },
                transaction: t,
            });

            for (const item of sameDayBookings as any[]) {
                const existingStartSlot = Number(item.timeSlot);
                const existingEndSlot =
                    (await getBookingEndSlot(item)) ?? existingStartSlot;
                const slotOverlapped =
                    targetStartSlot <= existingEndSlot &&
                    targetEndSlot >= existingStartSlot;
                if (slotOverlapped) {
                    await t.rollback();
                    ctx.status = 409;
                    ctx.body = {
                        success: false,
                        error: {
                            code: ErrorCodes.BOOKING_CONFLICT,
                            message: '目标时段与用户已有预约冲突',
                        },
                    };
                    return;
                }
            }

            const targetStartConfig = getTimeSlotConfigItem(
                targetStartSlot,
                timeSlotConfigs
            );
            const targetEndConfig = getTimeSlotConfigItem(
                targetEndSlot,
                timeSlotConfigs
            );

            const fallbackStartTime = normalizeTimeText(booking.startTime);
            const fallbackEndTime = normalizeTimeText(booking.endTime);
            const targetStartTime =
                targetStartConfig?.startTime || fallbackStartTime;
            const targetEndTime = targetEndConfig?.endTime || fallbackEndTime;

            // 释放原时段
            await TimeSlotStatus.update(
                {
                    status: TimeSlotStatusValue.AVAILABLE,
                    bookingId: undefined as any,
                },
                { where: { bookingId: booking.id }, transaction: t }
            );

            await booking.update(
                {
                    date: request.targetDate,
                    timeSlot: targetStartSlot,
                    startTime: targetStartTime as any,
                    endTime: targetEndTime as any,
                    status: BookingStatus.UPCOMING,
                },
                { transaction: t }
            );

            for (const slot of targetSlots) {
                await TimeSlotStatus.upsert(
                    {
                        seatId: booking.seatId,
                        date: request.targetDate as any,
                        timeSlot: slot,
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
            if (Number(request.targetSeatId) === Number(booking.seatId)) {
                await t.rollback();
                ctx.status = 400;
                ctx.body = {
                    success: false,
                    error: {
                        code: ErrorCodes.INVALID_PARAMS,
                        message: '目标座位不能与当前座位相同',
                    },
                };
                return;
            }

            const startSlot = Number(booking.timeSlot);
            const endSlot =
                (await getBookingEndSlot(booking)) ??
                (Number.isFinite(startSlot) ? startSlot : 0);
            const slotsToCheck: number[] = [];
            for (let slot = startSlot; slot <= endSlot; slot += 1) {
                if (Number.isFinite(slot)) {
                    slotsToCheck.push(slot);
                }
            }

            // 检查目标座位可用性
            const targetSlots = await TimeSlotStatus.findAll({
                where: {
                    seatId: request.targetSeatId,
                    date: booking.date,
                    timeSlot: {
                        [Op.in]:
                            slotsToCheck.length > 0
                                ? slotsToCheck
                                : [booking.timeSlot],
                    },
                    status: TimeSlotStatusValue.BOOKED,
                },
                transaction: t,
            });
            if (targetSlots.length > 0) {
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
            const slotsToOccupy =
                slotsToCheck.length > 0 ? slotsToCheck : [booking.timeSlot];
            for (const slot of slotsToOccupy) {
                await TimeSlotStatus.upsert(
                    {
                        seatId: request.targetSeatId,
                        date: booking.date,
                        timeSlot: slot,
                        status: TimeSlotStatusValue.BOOKED,
                        bookingId: booking.id,
                    },
                    { transaction: t }
                );
            }
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
