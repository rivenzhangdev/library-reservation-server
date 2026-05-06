import Router from 'koa-router';
import { authMiddleware, ensureNotBlacklisted } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Booking, Floor, Seat, BookingRuleConfig } from '../models/mysql';
import { CreditRecord, User } from '../models/mongodb';
import { Op, UniqueConstraintError } from 'sequelize';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import { ErrorCodes } from '../utils/error-codes';
import { CreditReasons } from '../constants/credit';
import { getUserDisplayNameFromMap } from '../utils/user-display';
import {
    formatRouteDateTime,
    formatRouteDateTimes,
} from '../utils/route-time-serializer';
import {
    getChronologicalTimeSlots,
    getTimeSlotConfigItems,
} from '../utils/time-slot-config';
import { parseLocalDate, parseTimeToMinutes } from '../utils/booking-rules';
import { getBookingRuleNumber } from './booking-rules';
import { writeAuditLog } from '../services/audit-service';
import { notifyBookingSuccess } from '../services/subscription-message-service';
import {
    bookingRouteDependencies,
    buildRenewBookingData as buildRenewBookingDataService,
    checkBookingPermissions as checkBookingPermissionsService,
    expireBookingIfNeeded as expireBookingIfNeededService,
    getBookingEndSlot as getBookingEndSlotService,
    isBookingOverdue as isBookingOverdueService,
    markAllExpiredBookings as markAllExpiredBookingsService,
    markUserExpiredBookings as markUserExpiredBookingsService,
    performBookingCheckin as performBookingCheckinService,
    performBookingCheckout as performBookingCheckoutService,
    performBookingRenew as performBookingRenewService,
    getRenewalAdvanceDays as getRenewalAdvanceDaysService,
    isBookingWithinRenewalWindow as isBookingWithinRenewalWindowService,
    releaseBookingTimeSlot as releaseBookingTimeSlotService,
    validateBookingRequest as validateBookingRequestService,
} from '../services/booking-service';

const router = new Router({ prefix: '/api/booking' });

export { bookingRouteDependencies };

export const releaseBookingTimeSlot = releaseBookingTimeSlotService;
export const buildRenewBookingData = buildRenewBookingDataService;
export const validateBookingRequest = validateBookingRequestService;
export const checkBookingPermissions = checkBookingPermissionsService;
export const isBookingOverdue = isBookingOverdueService;
export const expireBookingIfNeeded = expireBookingIfNeededService;
export const markAllExpiredBookings = markAllExpiredBookingsService;
export const markUserExpiredBookings = markUserExpiredBookingsService;
export const performBookingCheckin = performBookingCheckinService;
export const performBookingCheckout = performBookingCheckoutService;
export const performBookingRenew = performBookingRenewService;
export const getBookingEndSlot = getBookingEndSlotService;
export const getRenewalAdvanceDays = getRenewalAdvanceDaysService;
export const isBookingWithinRenewalWindow = isBookingWithinRenewalWindowService;

function normalizeTimePart(value: any): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (raw.includes('T')) {
        return raw.split('T')[1]?.slice(0, 8) || '';
    }
    if (raw.includes(' ')) {
        return raw.split(' ')[1]?.slice(0, 8) || '';
    }
    return raw.slice(0, 8);
}

async function getBookingStartMinutesForRecord(
    booking: any
): Promise<number | undefined> {
    const startTimeMinutes = parseTimeToMinutes(
        normalizeTimePart(booking?.startTime)
    );
    if (startTimeMinutes !== undefined) {
        return startTimeMinutes;
    }
    const slotConfigs = await getTimeSlotConfigItems();
    const slotConfig = slotConfigs.find(
        (item) => item.timeSlot === Number(booking?.timeSlot)
    );
    return slotConfig
        ? parseTimeToMinutes(String(slotConfig.startTime))
        : undefined;
}

async function applyLateCancelPenalty(
    booking: any,
    operatorId: string,
    penaltyPointsRaw: number
): Promise<void> {
    const penaltyPoints = Math.max(
        0,
        Math.floor(Number(penaltyPointsRaw) || 0)
    );
    if (penaltyPoints <= 0) return;

    const existing = await CreditRecord.findOne({
        bookingId: booking.id,
        reason: CreditReasons.BOOKING_LATE_CANCEL_PENALTY,
    });
    if (existing) return;

    const user = await User.findById(booking.userId);
    if (!user) return;

    const currentScore = Number(user.creditScore ?? 100);
    user.creditScore = Math.max(0, currentScore - penaltyPoints);
    await user.save();

    await CreditRecord.create({
        userId: booking.userId,
        bookingId: booking.id,
        type: 1,
        points: penaltyPoints,
        reason: CreditReasons.BOOKING_LATE_CANCEL_PENALTY,
        updatedBy: operatorId,
    });
}

export async function createBooking(ctx: any) {
    try {
        ensureNotBlacklisted(ctx);
        const userId = (ctx as any).state.user.id;
        const { seatId, date, timeSlot, startTime, endTime } =
            bookingRouteDependencies.validateBookingRequest(
                (ctx.request.body ?? {}) as any
            );

        await bookingRouteDependencies.checkBookingPermissions(userId, {
            requireStudentId: true,
        });

        // Check if seat exists
        const seat = await bookingRouteDependencies.Seat.findByPk(seatId);
        if (!seat) {
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        }

        const normalizedTimeSlot =
            await bookingRouteDependencies.resolveTimeSlot(timeSlot);
        if (normalizedTimeSlot === undefined) {
            throw new CustomError(
                'Invalid timeSlot',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const { startTime: finalStartTime, endTime: finalEndTime } =
            await bookingRouteDependencies.validateBookingTimeRange({
                date,
                timeSlot: normalizedTimeSlot,
                startTime,
                endTime,
            });

        const maxBookingPerDay = await getBookingRuleNumber(
            'max_booking_per_day',
            3
        );
        const advanceBookingDays = await getBookingRuleNumber(
            'advance_booking_days',
            7
        );
        const maxBookingDurationHours = await getBookingRuleNumber(
            'max_booking_duration_hours',
            4
        );

        const bookingDate = parseLocalDate(date);
        if (!bookingDate) {
            throw new CustomError('Invalid date', ErrorCodes.INVALID_PARAMS);
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const maxAllowedDate = new Date(today);
        maxAllowedDate.setDate(
            maxAllowedDate.getDate() +
                Math.max(0, Math.floor(advanceBookingDays))
        );
        if (bookingDate.getTime() > maxAllowedDate.getTime()) {
            throw new CustomError(
                `Booking date exceeds advance booking limit (${Math.floor(
                    advanceBookingDays
                )} days)`,
                ErrorCodes.INVALID_PARAMS
            );
        }

        const durationMinutes =
            (parseTimeToMinutes(normalizeTimePart(finalEndTime)) ?? 0) -
            (parseTimeToMinutes(normalizeTimePart(finalStartTime)) ?? 0);
        const maxDurationMinutes =
            Math.max(1, Number(maxBookingDurationHours)) * 60;
        if (durationMinutes > maxDurationMinutes) {
            throw new CustomError(
                `Booking duration exceeds limit (${maxBookingDurationHours} hours)`,
                ErrorCodes.INVALID_PARAMS
            );
        }

        await bookingRouteDependencies.markUserExpiredBookings(
            userId,
            userId.toString()
        );

        // Create booking and time slot state inside a transaction
        let booking: any;
        await bookingRouteDependencies.sequelizeTransaction(async (t) => {
            const existingStatus =
                await bookingRouteDependencies.TimeSlotStatus.findOne({
                    where: {
                        seatId,
                        date,
                        timeSlot: normalizedTimeSlot,
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

            if (existingStatus?.status === TimeSlotStatusValue.BOOKED) {
                throw new CustomError(
                    'This time slot has been booked',
                    ErrorCodes.BOOKING_CONFLICT
                );
            }

            const existingBooking = await Booking.findOne({
                where: {
                    userId: userId.toString(),
                    date,
                    timeSlot: normalizedTimeSlot,
                    status: {
                        [Op.in]: [
                            BookingStatus.UPCOMING,
                            BookingStatus.ONGOING,
                        ],
                    },
                },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            if (existingBooking) {
                throw new CustomError(
                    'You have already booked this time slot',
                    5002
                );
            }

            const sameDayBookings = await Booking.findAll({
                where: {
                    userId: userId.toString(),
                    date,
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
                lock: t.LOCK.UPDATE,
            });

            if (
                Number.isFinite(maxBookingPerDay) &&
                maxBookingPerDay > 0 &&
                sameDayBookings.length >= Math.floor(maxBookingPerDay)
            ) {
                throw new CustomError(
                    'Daily booking limit exceeded',
                    ErrorCodes.BOOKING_DAILY_LIMIT_EXCEEDED
                );
            }

            const requestStartMinutes = parseTimeToMinutes(
                normalizeTimePart(finalStartTime)
            );
            const requestEndMinutes = parseTimeToMinutes(
                normalizeTimePart(finalEndTime)
            );

            if (
                requestStartMinutes !== undefined &&
                requestEndMinutes !== undefined
            ) {
                for (const item of sameDayBookings as any[]) {
                    const existStartMinutes = parseTimeToMinutes(
                        normalizeTimePart(item.startTime)
                    );
                    const existEndMinutes = parseTimeToMinutes(
                        normalizeTimePart(item.endTime)
                    );
                    if (
                        existStartMinutes === undefined ||
                        existEndMinutes === undefined
                    ) {
                        continue;
                    }

                    const overlapped =
                        requestStartMinutes < existEndMinutes &&
                        requestEndMinutes > existStartMinutes;
                    if (overlapped) {
                        throw new CustomError(
                            'You already have another booking in overlapping time range',
                            ErrorCodes.BOOKING_CONFLICT
                        );
                    }
                }
            }

            booking = await Booking.create(
                {
                    userId: userId.toString(),
                    seatId,
                    date: date as any,
                    timeSlot: normalizedTimeSlot,
                    startTime: finalStartTime as any,
                    endTime: finalEndTime as any,
                    status: BookingStatus.UPCOMING, // 使用数字枚举
                    ...buildAuditFields(ctx),
                },
                { transaction: t }
            );

            if (existingStatus) {
                await existingStatus.update(
                    {
                        status: TimeSlotStatusValue.BOOKED, // 使用数字枚举
                        bookingId: booking.id,
                    },
                    { transaction: t }
                );
            } else {
                await bookingRouteDependencies.TimeSlotStatus.create(
                    {
                        seatId,
                        date: date as any,
                        timeSlot: normalizedTimeSlot,
                        status: TimeSlotStatusValue.BOOKED, // 使用数字枚举
                        bookingId: booking.id,
                    },
                    { transaction: t }
                );
            }
        });

        // Send booking success notification + WeChat subscription message via service
        try {
            const seat = await bookingRouteDependencies.Seat.findByPk(seatId);
            const seatInfo = seat
                ? seat.description
                    ? seat.description
                    : `Floor ${seat.floorId} Row ${seat.rowNum} Col ${seat.colNum}`
                : `Seat ${seatId}`;
            const location =
                seat?.description ?? `Floor ${seat?.floorId ?? ''}`;
            await notifyBookingSuccess({
                userId,
                bookingId: booking.id.toString(),
                date,
                startTime: finalStartTime,
                endTime: finalEndTime,
                seatInfo,
                location,
            });
        } catch (err) {
            console.error('Failed to send booking success notification', err);
        }

        // try fetch createdBy display name
        let createdByName: string | undefined = undefined;
        try {
            if (booking.createdBy) {
                const cb = await bookingRouteDependencies.UserModel.findById(
                    booking.createdBy
                )
                    .select('name username')
                    .lean();
                createdByName = bookingRouteDependencies.getUserDisplayName(
                    cb ?? undefined
                );
            }
        } catch {
            // ignore lookup errors
        }

        ctx.body = {
            success: true,
            data: {
                id: booking.id,
                seatId: booking.seatId,
                date: booking.date,
                timeSlot: booking.timeSlot,
                status: booking.status,
                createdBy: booking.createdBy,
                createdByName,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        const mysqlCode = String(
            error?.original?.code || error?.parent?.code || ''
        ).toUpperCase();
        const mysqlErrno = Number(
            error?.original?.errno || error?.parent?.errno || NaN
        );
        if (
            error instanceof UniqueConstraintError ||
            error?.name === 'SequelizeUniqueConstraintError'
        ) {
            throw new CustomError(
                'This time slot has been booked',
                ErrorCodes.BOOKING_CONFLICT
            );
        }
        if (
            mysqlCode === 'ER_LOCK_DEADLOCK' ||
            mysqlCode === 'ER_LOCK_WAIT_TIMEOUT' ||
            mysqlErrno === 1213 ||
            mysqlErrno === 1205
        ) {
            throw new CustomError(
                'This time slot has been booked',
                ErrorCodes.BOOKING_CONFLICT
            );
        }
        throw new CustomError(
            'Failed to create booking',
            ErrorCodes.CREATE_BOOKING_ERROR
        );
    }
}

router.post('/', authMiddleware, async (ctx) => {
    ensureNotBlacklisted(ctx);
    await createBooking(ctx);
});

/**
                                }
 * @route GET /api/booking/my
 * @desc Get my bookings interface
 */
router.get('/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        await bookingRouteDependencies.markUserExpiredBookings(
            userId,
            userId.toString()
        );
        const {
            status,
            page = 1,
            pageSize: queryPageSize,
            limit,
        } = ctx.query as any;

        const where: any = { userId: userId.toString() };
        if (status !== undefined) {
            const normalizedStatus = normalizeNumericEnum(status);
            if (normalizedStatus !== undefined) {
                where.status = normalizedStatus;
            }
        }

        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(String(queryPageSize ?? limit ?? 20), 10);

        const { count, rows } = await Booking.findAndCountAll({
            where,
            include: [
                {
                    model: Seat,
                    as: 'seat',
                    include: [
                        {
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            model: require('../models/mysql/Floor').default,
                            as: 'floor',
                            attributes: ['id', 'name'],
                        },
                    ],
                },
            ],
            order: [['created_at', 'DESC']],
            limit: pageLimit,
            offset: (pageNum - 1) * pageLimit,
        });

        const slotConfigs = await getTimeSlotConfigItems();
        const maxRenewalExtraSlots = await getBookingRuleNumber(
            'renewal.maxExtraSlots',
            1
        );
        const renewalAdvanceDays = await getRenewalAdvanceDays();
        const orderedTimeSlots = getChronologicalTimeSlots(slotConfigs);
        const timeSlotIndexMap = new Map<number, number>(
            orderedTimeSlots.map((slot, index) => [slot, index])
        );
        const maxTimeSlotIndex = orderedTimeSlots.length - 1;

        const renewalStatusConditions: any[] = [];
        const bookingRenewalTargets: Array<{
            seatId: number;
            date: string;
            timeSlot: number;
        }> = [];

        for (const booking of rows) {
            const bookingStartSlot = Number(booking.timeSlot);
            const currentEndSlot =
                (await getBookingEndSlot(booking)) ?? bookingStartSlot;
            const currentEndSlotIndex = timeSlotIndexMap.get(
                Number(currentEndSlot)
            );
            if (
                booking.status === BookingStatus.UPCOMING &&
                currentEndSlotIndex !== undefined &&
                currentEndSlotIndex < maxTimeSlotIndex
            ) {
                const bookingDate = String(booking.date);
                for (
                    let slotIndex = currentEndSlotIndex + 1;
                    slotIndex <= maxTimeSlotIndex;
                    slotIndex += 1
                ) {
                    const slot = orderedTimeSlots[slotIndex];
                    bookingRenewalTargets.push({
                        seatId: booking.seatId,
                        date: bookingDate,
                        timeSlot: slot,
                    });
                }
            }
        }

        if (bookingRenewalTargets.length > 0) {
            bookingRenewalTargets.forEach((target) => {
                renewalStatusConditions.push({
                    seatId: target.seatId,
                    date: target.date,
                    timeSlot: target.timeSlot,
                });
            });
        }

        const renewalStatuses =
            renewalStatusConditions.length > 0
                ? await bookingRouteDependencies.TimeSlotStatus.findAll({
                      where: {
                          [Op.or]: renewalStatusConditions,
                      },
                  })
                : [];

        const renewalStatusMap: Record<string, number> = {};
        renewalStatuses.forEach((status) => {
            renewalStatusMap[
                `${String(status.seatId)}|${String(status.date)}|${String(
                    status.timeSlot
                )}`
            ] = status.status;
        });

        const bookingSlotRanges = await Promise.all(
            rows.map(async (booking) => {
                const startSlot = Number(booking.timeSlot);
                const startSlotIndex = timeSlotIndexMap.get(startSlot);
                if (startSlotIndex === undefined) {
                    return {
                        bookingId: String(booking.id),
                        date: String(booking.date),
                        startSlotIndex: -1,
                        endSlotIndex: -1,
                    };
                }
                const endSlot = (await getBookingEndSlot(booking)) ?? startSlot;
                const endSlotIndex = timeSlotIndexMap.get(Number(endSlot));
                return {
                    bookingId: String(booking.id),
                    date: String(booking.date),
                    startSlotIndex,
                    endSlotIndex:
                        endSlotIndex === undefined
                            ? startSlotIndex
                            : endSlotIndex,
                };
            })
        );

        const list = await Promise.all(
            rows.map(async (booking) => {
                const bookingDate = String(booking.date);
                const renewableTimeSlots: number[] = [];
                let renewalBlockedReason = '';
                if (
                    booking.status === BookingStatus.UPCOMING &&
                    Number.isFinite(booking.timeSlot)
                ) {
                    const withinRenewalWindow =
                        await isBookingWithinRenewalWindow(bookingDate);
                    if (!withinRenewalWindow) {
                        renewalBlockedReason = 'advance_window_not_reached';
                    }

                    const currentEndSlot =
                        (await getBookingEndSlot(booking)) ?? booking.timeSlot;
                    const currentStartSlot = Number(booking.timeSlot);
                    const currentStartSlotIndex =
                        timeSlotIndexMap.get(currentStartSlot);
                    const currentEndSlotIndex = timeSlotIndexMap.get(
                        Number(currentEndSlot)
                    );

                    if (
                        !renewalBlockedReason &&
                        (currentStartSlotIndex === undefined ||
                            currentEndSlotIndex === undefined)
                    ) {
                        renewalBlockedReason = 'invalid_time_slot';
                    } else if (!renewalBlockedReason) {
                        const startSlotIndex = currentStartSlotIndex as number;
                        const endSlotIndex = currentEndSlotIndex as number;

                        if (endSlotIndex >= maxTimeSlotIndex) {
                            renewalBlockedReason = 'no_later_time_slot';
                        }
                        const existingExtraSlots = Math.max(
                            0,
                            endSlotIndex - startSlotIndex
                        );
                        const remainingExtraSlots = Math.max(
                            0,
                            maxRenewalExtraSlots - existingExtraSlots
                        );
                        if (remainingExtraSlots <= 0 && !renewalBlockedReason) {
                            renewalBlockedReason = 'renewal_limit_reached';
                        }
                        const maxRenewTargetSlotIndex = Math.min(
                            maxTimeSlotIndex,
                            endSlotIndex + remainingExtraSlots
                        );
                        const sameUserRanges = bookingSlotRanges.filter(
                            (range) =>
                                range.bookingId !== String(booking.id) &&
                                range.date === bookingDate &&
                                range.startSlotIndex >= 0
                        );
                        for (
                            let slotIndex = endSlotIndex + 1;
                            slotIndex <= maxRenewTargetSlotIndex;
                            slotIndex += 1
                        ) {
                            const targetSlot = orderedTimeSlots[slotIndex];
                            let blocked = false;
                            for (
                                let checkSlotIndex = endSlotIndex + 1;
                                checkSlotIndex <= slotIndex;
                                checkSlotIndex += 1
                            ) {
                                const checkSlot =
                                    orderedTimeSlots[checkSlotIndex];
                                const key = `${String(
                                    booking.seatId
                                )}|${bookingDate}|${checkSlot}`;
                                const slotStatus = renewalStatusMap[key];
                                if (
                                    slotStatus !== undefined &&
                                    slotStatus !== TimeSlotStatusValue.AVAILABLE
                                ) {
                                    blocked = true;
                                    break;
                                }
                            }
                            if (!blocked) {
                                const hasSelfOverlap = sameUserRanges.some(
                                    (range) =>
                                        range.startSlotIndex <= slotIndex &&
                                        range.endSlotIndex >= startSlotIndex
                                );
                                if (hasSelfOverlap) {
                                    blocked = true;
                                }
                            }
                            if (!blocked) {
                                renewableTimeSlots.push(targetSlot);
                            }
                        }
                    }

                    if (
                        renewableTimeSlots.length === 0 &&
                        !renewalBlockedReason
                    ) {
                        renewalBlockedReason = 'slots_unavailable_or_conflict';
                    }
                } else if (booking.status !== BookingStatus.UPCOMING) {
                    renewalBlockedReason = 'status_not_upcoming';
                } else {
                    renewalBlockedReason = 'invalid_time_slot';
                }

                const canRenew =
                    booking.status === BookingStatus.UPCOMING &&
                    renewableTimeSlots.length > 0;

                return {
                    id: booking.id,
                    seatId: booking.seatId,
                    floorName: (booking as any).seat?.floor?.name ?? '',
                    rowNum: (booking as any).seat?.rowNum ?? 0,
                    colNum: (booking as any).seat?.colNum ?? 0,
                    zone: (booking as any).seat?.zone ?? '',
                    type: (booking as any).seat?.type ?? '',
                    description: (booking as any).seat?.description ?? '',
                    hasSocket: !!(booking as any).seat?.hasSocket,
                    isWindow: !!(booking as any).seat?.isWindow,
                    date: booking.date,
                    timeSlot: booking.timeSlot,
                    startTime: formatRouteDateTime(booking.startTime),
                    endTime: formatRouteDateTime(booking.endTime),
                    status: booking.status,
                    renewableTimeSlots,
                    canRenew,
                    renewalAdvanceDays,
                    renewalBlockedReason: canRenew ? '' : renewalBlockedReason,
                };
            })
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total: count,
                page: pageNum,
                pageSize: pageLimit,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get bookings',
            ErrorCodes.GET_BOOKINGS_ERROR
        );
    }
});

export async function cancelBooking(ctx: any) {
    try {
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const booking = await Booking.findOne({
            where: {
                id: bookingId,
                userId: userId.toString(),
            },
        });

        if (!booking) {
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );
        }

        const expired = await bookingRouteDependencies.expireBookingIfNeeded(
            booking,
            userId.toString()
        );
        if (expired) {
            ctx.body = {
                success: true,
            };
            return;
        }

        const cancelBeforeMinutes = await getBookingRuleNumber(
            'cancel_before_minutes',
            30
        );
        const lateCancelPenaltyCredit = await getBookingRuleNumber(
            'late_cancel_penalty_credit',
            5
        );

        const bookingDate = parseLocalDate(String(booking.date));
        const startMinutes = await getBookingStartMinutesForRecord(booking);
        let withinRestrictedWindow = false;
        let startedAlready = false;
        if (bookingDate && startMinutes !== undefined) {
            const now = new Date();
            const dayStart = new Date(now);
            dayStart.setHours(0, 0, 0, 0);
            const targetDay = new Date(bookingDate);
            targetDay.setHours(0, 0, 0, 0);
            if (targetDay.getTime() === dayStart.getTime()) {
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                startedAlready = nowMinutes >= startMinutes;
                withinRestrictedWindow =
                    !startedAlready &&
                    nowMinutes >=
                        startMinutes - Math.max(0, cancelBeforeMinutes);
            }
        }

        if (startedAlready) {
            throw new CustomError(
                'Cancellation is not allowed after booking start time',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (withinRestrictedWindow) {
            if (lateCancelPenaltyCredit <= 0) {
                throw new CustomError(
                    `Cancellation is not allowed within ${Math.max(
                        0,
                        Math.floor(cancelBeforeMinutes)
                    )} minutes before start`,
                    ErrorCodes.INVALID_PARAMS
                );
            }
            await applyLateCancelPenalty(
                booking,
                userId.toString(),
                lateCancelPenaltyCredit
            );
        }

        await booking.update({
            status: BookingStatus.CANCELED,
            ...buildUpdatedBy(ctx),
        });

        await bookingRouteDependencies.releaseBookingTimeSlot(booking);

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to cancel booking',
            ErrorCodes.CANCEL_BOOKING_ERROR
        );
    }
}

router.delete('/:id', authMiddleware, cancelBooking);

/**
 * 计算两点之间的球面距离（Haversine公式），单位：米
 */
function haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getGeofenceConfig(): Promise<{
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number;
    mode: 'soft' | 'strict';
}> {
    const keys = [
        'library_latitude',
        'library_longitude',
        'geofence_radius_meters',
        'geofence_mode',
    ];
    const rules = await BookingRuleConfig.findAll({
        where: { ruleKey: keys, enabled: true },
    });
    const map: Record<string, string> = {};
    for (const r of rules) map[r.ruleKey] = r.ruleValue;

    return {
        latitude: map['library_latitude']
            ? Number(map['library_latitude'])
            : null,
        longitude: map['library_longitude']
            ? Number(map['library_longitude'])
            : null,
        radiusMeters: map['geofence_radius_meters']
            ? Number(map['geofence_radius_meters'])
            : 500,
        mode: (map['geofence_mode'] as 'soft' | 'strict') ?? 'soft',
    };
}

export async function checkinBooking(ctx: any) {
    try {
        ensureNotBlacklisted(ctx);
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        await bookingRouteDependencies.markUserExpiredBookings(
            userId,
            userId.toString()
        );
        const booking = await Booking.findOne({
            where: {
                id: bookingId,
                userId: userId.toString(),
            },
        });

        if (!booking) {
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );
        }

        // 地理围栏校验（软警告或强拒绝）
        const body = ctx.request?.body as any;
        const clientLat = body?.latitude != null ? Number(body.latitude) : null;
        const clientLng =
            body?.longitude != null ? Number(body.longitude) : null;

        if (
            clientLat !== null &&
            clientLng !== null &&
            !Number.isNaN(clientLat) &&
            !Number.isNaN(clientLng)
        ) {
            const geo = await getGeofenceConfig();
            if (geo.latitude !== null && geo.longitude !== null) {
                const distance = haversineDistance(
                    clientLat,
                    clientLng,
                    geo.latitude,
                    geo.longitude
                );
                const outOfRange = distance > geo.radiusMeters;

                // 非阻塞写入审计日志
                writeAuditLog(ctx, {
                    action: 'CHECKIN_LOCATION',
                    targetType: 'booking',
                    targetId: String(bookingId),
                    metadata: {
                        latitude: clientLat,
                        longitude: clientLng,
                        distanceMeters: Math.round(distance),
                        radiusMeters: geo.radiusMeters,
                        outOfRange,
                        mode: geo.mode,
                    },
                }).catch(() => {});

                if (outOfRange && geo.mode === 'strict') {
                    throw new CustomError(
                        `Check-in location is too far from the library (${Math.round(
                            distance
                        )}m, limit ${geo.radiusMeters}m)`,
                        ErrorCodes.CHECKIN_NOT_ALLOWED
                    );
                }
            }
        }

        await bookingRouteDependencies.performBookingCheckin(
            booking,
            (ctx as any).state.user.id
        );
        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Check-in failed',
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
}

/**
 * @route POST /api/booking/checkin/:id
 * @desc Booking check-in interface
 */
router.post('/checkin/:id', authMiddleware, checkinBooking);

export async function checkoutBooking(ctx: any) {
    try {
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const booking = await Booking.findOne({
            where: {
                id: bookingId,
                userId: userId.toString(),
            },
        });

        if (!booking) {
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );
        }

        await bookingRouteDependencies.performBookingCheckout(
            booking,
            userId.toString()
        );
        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Check-out failed',
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
}

/**
 * @route POST /api/booking/checkout/:id
 * @desc Booking check-out interface
 */
router.post('/checkout/:id', authMiddleware, checkoutBooking);

export async function renewBooking(ctx: any) {
    try {
        ensureNotBlacklisted(ctx);
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;
        const requestTimeSlot = (ctx.request.body as any).timeSlot;
        if (requestTimeSlot === undefined || requestTimeSlot === null) {
            throw new CustomError(
                'Missing time slot parameter',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const booking = await Booking.findOne({
            where: {
                id: bookingId,
                userId: userId.toString(),
            },
        });

        if (!booking) {
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );
        }

        const newBooking = await bookingRouteDependencies.performBookingRenew(
            booking,
            requestTimeSlot,
            ctx
        );

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(newBooking),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Renewal failed', ErrorCodes.RENEW_BOOKING_ERROR);
    }
}

/**
 * @route POST /api/booking/renew/:id
 * @desc Booking renewal interface
 */
router.post('/renew/:id', authMiddleware, renewBooking);

/**
 * @route GET /api/booking/:id
 * @desc Get booking details interface
 */
router.get('/:id', authMiddleware, async (ctx) => {
    try {
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const booking = await Booking.findOne({
            where: {
                id: bookingId,
                userId: userId.toString(),
            },
            include: [
                {
                    model: Seat,
                    as: 'seat',
                    include: [
                        {
                            model: Floor,
                            as: 'floor',
                            attributes: ['id', 'name'],
                        },
                    ],
                },
            ],
        });

        if (!booking) {
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );
        }

        // fetch user display names for createdBy/updatedBy if present
        const userIdsToFetch: string[] = [];
        if (booking.userId) userIdsToFetch.push(booking.userId.toString());
        if ((booking as any).createdBy)
            userIdsToFetch.push((booking as any).createdBy);
        if ((booking as any).updatedBy)
            userIdsToFetch.push((booking as any).updatedBy);
        const uniq = Array.from(new Set(userIdsToFetch));
        const users = uniq.length
            ? await bookingRouteDependencies.UserModel.find({
                  _id: { $in: uniq },
              }).select('name username')
            : [];
        const userMap: Record<string, any> = {};
        users.forEach((u: any) => {
            userMap[u._id.toString()] = u;
        });

        ctx.body = {
            success: true,
            data: {
                id: booking.id,
                seatId: booking.seatId,
                floorName: (booking as any).seat?.floor?.name ?? '',
                rowNum: (booking as any).seat?.rowNum ?? 0,
                colNum: (booking as any).seat?.colNum ?? 0,
                zone: (booking as any).seat?.zone ?? '',
                type: (booking as any).seat?.type ?? '',
                description: (booking as any).seat?.description ?? '',
                hasSocket: !!(booking as any).seat?.hasSocket,
                isWindow: !!(booking as any).seat?.isWindow,
                date: booking.date,
                timeSlot: booking.timeSlot,
                startTime: formatRouteDateTime(booking.startTime),
                endTime: formatRouteDateTime(booking.endTime),
                status: booking.status,
                createdAt: formatRouteDateTime((booking as any).created_at),
                updatedAt: formatRouteDateTime((booking as any).updated_at),
                userName: getUserDisplayNameFromMap(booking.userId, userMap),
                createdBy: (booking as any).createdBy,
                createdByName: getUserDisplayNameFromMap(
                    (booking as any).createdBy,
                    userMap
                ),
                updatedBy: (booking as any).updatedBy,
                updatedByName: getUserDisplayNameFromMap(
                    (booking as any).updatedBy,
                    userMap
                ),
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get booking details',
            ErrorCodes.GET_BOOKING_ERROR
        );
    }
});

export default router;
