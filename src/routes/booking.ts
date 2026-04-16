import Router from 'koa-router';
import { authMiddleware, ensureNotBlacklisted } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Notification, User, CreditRecord } from '../models/mongodb';
import { Booking, Floor, Seat, TimeSlotStatus } from '../models/mysql';
import { Op, Transaction } from 'sequelize';
import sequelize from '../database/mysql';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import { ErrorCodes } from '../utils/error-codes';
import {
    buildWechatTemplatePayload,
    wechatTemplateConfig,
} from '../utils/wechat-template-config';
import { sendWechatSubscribeMessage } from '../utils/wechat';
import {
    getUserDisplayName,
    getUserDisplayNameFromMap,
} from '../utils/user-display';
import { resolveTimeSlot } from '../utils/time-slot-config';
import {
    CHECKIN_WINDOW_MINUTES,
    getBookingEndMinutes,
    validateBookingTimeRange,
    isCheckinAllowed,
    isSameDay,
    parseLocalDate,
} from '../utils/booking-rules';

const router = new Router({ prefix: '/api/booking' });

async function ensureViolationCreditRecord(booking: any, operatorId?: string) {
    if (!booking?.id || !booking.userId) return;

    const existingRecord = await CreditRecord.findOne({
        bookingId: booking.id,
        type: 1,
    }).lean();
    if (existingRecord) return;

    const user = await User.findById(booking.userId);
    if (!user) return;

    const penaltyPoints = Number(process.env.VIOLATION_DEDUCT_POINTS ?? 5);
    user.creditScore = Math.max(0, (user.creditScore ?? 100) - penaltyPoints);
    await user.save();

    await CreditRecord.create({
        userId: booking.userId,
        bookingId: booking.id,
        type: 1,
        points: penaltyPoints,
        reason: 'Violation penalty',
        updatedBy: operatorId,
    });
}

export async function releaseBookingTimeSlot(
    booking: any,
    transaction?: Transaction
) {
    if (!booking?.seatId || !booking.date) return;
    await TimeSlotStatus.update(
        { status: TimeSlotStatusValue.AVAILABLE, bookingId: undefined },
        {
            where: {
                seatId: booking.seatId,
                date: booking.date,
                timeSlot: booking.timeSlot,
            },
            transaction,
        }
    );
}

export async function performBookingCheckin(
    booking: any,
    userId: string,
    creditRecordModel = CreditRecord
): Promise<void> {
    if (!booking) {
        throw new CustomError(
            'Booking not found',
            ErrorCodes.BOOKING_NOT_FOUND
        );
    }
    if (booking.status !== BookingStatus.UPCOMING) {
        throw new CustomError(
            'Check-in is not allowed for this booking',
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
    if (!(await isCheckinAllowed(booking))) {
        throw new CustomError(
            `Check-in is only allowed within ${CHECKIN_WINDOW_MINUTES} minutes before start and before the end time`,
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
    await booking.update({
        status: BookingStatus.ONGOING,
    });
    await creditRecordModel.create({
        userId: booking.userId,
        bookingId: booking.id,
        type: 0,
        points: 0,
        reason: 'Booking check-in',
        updatedBy: userId,
    });
}

export async function performBookingCheckout(
    booking: any,
    userId: string,
    releaseFn = releaseBookingTimeSlot,
    expireFn = expireBookingIfNeeded
): Promise<void> {
    if (!booking) {
        throw new CustomError(
            'Booking not found',
            ErrorCodes.BOOKING_NOT_FOUND
        );
    }
    if (booking.status !== BookingStatus.ONGOING) {
        throw new CustomError(
            'Check-out is not allowed for this booking',
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
    if (await isBookingOverdue(booking)) {
        await expireFn(booking, userId);
        throw new CustomError(
            'Booking has expired and is marked as violated; check-out is not allowed',
            ErrorCodes.CHECKIN_NOT_ALLOWED
        );
    }
    await booking.update({
        status: BookingStatus.COMPLETED,
    });
    await releaseFn(booking);
}

export async function isBookingOverdue(booking: any): Promise<boolean> {
    if (!booking) return false;
    const bookingDate =
        parseLocalDate(String(booking.date)) ?? new Date(String(booking.date));
    if (Number.isNaN(bookingDate.getTime())) return false;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const checkDate = new Date(bookingDate);
    checkDate.setHours(0, 0, 0, 0);

    if (checkDate.getTime() < todayStart.getTime()) {
        return true;
    }
    if (!isSameDay(String(booking.date), now)) {
        return false;
    }

    const endMinutes = await getBookingEndMinutes(booking);
    if (endMinutes === undefined) return false;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes > endMinutes;
}

export async function buildRenewBookingData(
    booking: any,
    timeSlot: number,
    validateFn: typeof validateBookingTimeRange = validateBookingTimeRange
): Promise<{
    date: Date;
    timeSlot: number;
    startTime?: string;
    endTime?: string;
}> {
    const bookingDateString =
        typeof booking.date === 'string'
            ? booking.date
            : new Date(booking.date).toISOString().split('T')[0];
    const bookingDate = new Date(bookingDateString);

    const { startTime, endTime } = await validateFn({
        date: bookingDateString,
        timeSlot,
    });

    return {
        date: bookingDate,
        timeSlot,
        startTime,
        endTime,
    };
}

export async function performBookingRenew(
    booking: any,
    requestTimeSlot: any,
    ctx: any,
    options: {
        resolveTimeSlot?: (value: any) => Promise<number | undefined>;
        validateBookingTimeRange?: typeof validateBookingTimeRange;
        bookingModel?: typeof Booking;
        timeSlotStatusModel?: typeof TimeSlotStatus;
        transactionProvider?: (
            callback: (t: Transaction) => Promise<any>
        ) => Promise<any>;
        releaseFn?: typeof releaseBookingTimeSlot;
        buildAuditFieldsFn?: typeof buildAuditFields;
        buildUpdatedByFn?: typeof buildUpdatedBy;
    } = {}
): Promise<any> {
    const resolveTimeSlotFn = options.resolveTimeSlot ?? resolveTimeSlot;
    const validateFn =
        options.validateBookingTimeRange ?? validateBookingTimeRange;
    const bookingModel = options.bookingModel ?? Booking;
    const timeSlotStatusModel = options.timeSlotStatusModel ?? TimeSlotStatus;
    const transactionProvider =
        options.transactionProvider ??
        ((callback: (t: Transaction) => Promise<any>) =>
            sequelize.transaction(callback));
    const releaseFn = options.releaseFn ?? releaseBookingTimeSlot;
    const buildAuditFieldsFn = options.buildAuditFieldsFn ?? buildAuditFields;
    const buildUpdatedByFn = options.buildUpdatedByFn ?? buildUpdatedBy;

    const normalizedTimeSlot = await resolveTimeSlotFn(requestTimeSlot);
    if (normalizedTimeSlot === undefined) {
        throw new CustomError('Invalid timeSlot', ErrorCodes.INVALID_PARAMS);
    }
    if (normalizedTimeSlot === booking.timeSlot) {
        throw new CustomError(
            'Cannot renew to the same time slot',
            ErrorCodes.INVALID_PARAMS
        );
    }
    if (normalizedTimeSlot < booking.timeSlot) {
        throw new CustomError(
            'Renewal must move to a later time slot',
            ErrorCodes.INVALID_PARAMS
        );
    }
    if (
        ![BookingStatus.UPCOMING, BookingStatus.ONGOING].includes(
            booking.status
        )
    ) {
        throw new CustomError(
            'Only active bookings can be renewed',
            ErrorCodes.INVALID_PARAMS
        );
    }

    const renewalData = await buildRenewBookingData(
        booking,
        normalizedTimeSlot,
        validateFn
    );

    const newBooking = await transactionProvider(async (t) => {
        if (booking.status === BookingStatus.UPCOMING) {
            await booking.update(
                {
                    status: BookingStatus.CANCELED,
                    ...buildUpdatedByFn(ctx),
                },
                { transaction: t }
            );
            await releaseFn(booking, t);
        }

        const existingStatus = await timeSlotStatusModel.findOne({
            where: {
                seatId: booking.seatId,
                date: renewalData.date,
                timeSlot: normalizedTimeSlot,
            },
            transaction: t,
        });

        if (existingStatus?.status === TimeSlotStatusValue.BOOKED) {
            throw new CustomError(
                'This time slot has been booked',
                ErrorCodes.BOOKING_CONFLICT
            );
        }

        const createdBooking = await bookingModel.create(
            {
                userId: booking.userId,
                seatId: booking.seatId,
                date: renewalData.date,
                timeSlot: renewalData.timeSlot,
                startTime: renewalData.startTime as any,
                endTime: renewalData.endTime as any,
                status: BookingStatus.UPCOMING,
                ...buildAuditFieldsFn(ctx),
            },
            { transaction: t }
        );

        await timeSlotStatusModel.upsert(
            {
                seatId: booking.seatId,
                date: renewalData.date,
                timeSlot: normalizedTimeSlot,
                status: TimeSlotStatusValue.BOOKED,
                bookingId: createdBooking.id,
            },
            { transaction: t }
        );

        return createdBooking;
    });

    return newBooking;
}

export async function expireBookingIfNeeded(
    booking: any,
    operatorId?: string
): Promise<boolean> {
    if (!booking) return false;
    if (
        ![BookingStatus.UPCOMING, BookingStatus.ONGOING].includes(
            booking.status
        )
    ) {
        return false;
    }

    const today = new Date();
    const bookingDate = new Date(booking.date);
    bookingDate.setHours(0, 0, 0, 0);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const datePassed = bookingDate.getTime() < todayStart.getTime();
    const sameDay = bookingDate.getTime() === todayStart.getTime();
    let expired = false;

    if (datePassed) {
        expired = true;
    } else if (sameDay) {
        const endMinutes = await getBookingEndMinutes(booking);
        if (endMinutes !== undefined) {
            const nowMinutes = today.getHours() * 60 + today.getMinutes();
            if (nowMinutes >= endMinutes) {
                expired = true;
            }
        }
    }

    if (!expired) return false;

    await booking.update({
        status: BookingStatus.VIOLATED,
        ...(operatorId ? { updatedBy: operatorId } : {}),
    });
    await releaseBookingTimeSlot(booking);
    await ensureViolationCreditRecord(booking, operatorId);
    return true;
}

async function markUserExpiredBookings(userId: string, operatorId?: string) {
    const bookings = await Booking.findAll({
        where: {
            userId: userId.toString(),
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
    });

    for (const booking of bookings) {
        await expireBookingIfNeeded(booking, operatorId);
    }
}

export async function markAllExpiredBookings() {
    const bookings = await Booking.findAll({
        where: {
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
    });

    for (const booking of bookings) {
        await expireBookingIfNeeded(booking);
    }
}

export async function createBooking(ctx: any) {
    try {
        ensureNotBlacklisted(ctx);
        const userId = (ctx as any).state.user.id;
        const { seatId, date, timeSlot, startTime, endTime } = ctx.request
            .body as any;

        // Validate required parameters
        if (!seatId || !date || timeSlot === undefined || timeSlot === null) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

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

        // expire stale bookings before checking availability, to avoid holding slots forever
        await bookingRouteDependencies.markAllExpiredBookings();

        // Check if time slot is available
        const existingStatus =
            await bookingRouteDependencies.TimeSlotStatus.findOne({
                where: {
                    seatId,
                    date,
                    timeSlot: normalizedTimeSlot,
                },
            });

        if (existingStatus?.status === TimeSlotStatusValue.BOOKED) {
            throw new CustomError(
                'This time slot has been booked',
                ErrorCodes.BOOKING_CONFLICT
            );
        }

        // Check if user has already booked this time slot
        const existingBooking = await Booking.findOne({
            where: {
                userId: userId.toString(),
                date,
                timeSlot: normalizedTimeSlot,
                status: {
                    [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
                },
            },
        });

        if (existingBooking) {
            throw new CustomError(
                'You have already booked this time slot',
                5002
            );
        }

        // Create booking and time slot state inside a transaction
        let booking: any;
        await bookingRouteDependencies.sequelizeTransaction(async (t) => {
            booking = await Booking.create(
                {
                    userId: userId.toString(),
                    seatId,
                    date,
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
                        date,
                        timeSlot: normalizedTimeSlot,
                        status: TimeSlotStatusValue.BOOKED, // 使用数字枚举
                        bookingId: booking.id,
                    },
                    { transaction: t }
                );
            }
        });

        // Create notification
        await bookingRouteDependencies.Notification.create({
            userId,
            createdBy: userId,
            type: 1, // NotificationType.BOOKING
            title: 'Booking successful',
            content: `You have successfully booked a seat on ${date}`,
            relatedId: booking.id.toString(),
            updatedBy: userId,
        });

        // Send WeChat subscription message for booking success if available.
        try {
            const config =
                bookingRouteDependencies.wechatTemplateConfig.BOOKING_SUCCESS;
            if (
                config?.templateId &&
                !config.templateId.startsWith('TEMPLATE_ID_')
            ) {
                const seat =
                    await bookingRouteDependencies.Seat.findByPk(seatId);
                const seatInfo = seat
                    ? `${
                          seat.description
                              ? seat.description
                              : `Floor ${seat.floorId} Row ${seat.rowNum} Col ${seat.colNum}`
                      }`
                    : `Seat ${seatId}`;
                const payload =
                    bookingRouteDependencies.buildWechatTemplatePayload(
                        'BOOKING_SUCCESS',
                        {
                            title: 'Booking successful',
                            bookingTime: `${date} ${finalStartTime}-${finalEndTime}`,
                            seatInfo,
                            location:
                                seat?.description ??
                                `Floor ${seat?.floorId ?? ''}`,
                            remark: 'Your seat reservation is confirmed.',
                        }
                    );

                if (payload) {
                    const currentUser =
                        await bookingRouteDependencies.UserModel.findById(
                            userId
                        )
                            .select('username')
                            .lean();
                    const targetOpenId = currentUser?.username;
                    if (targetOpenId) {
                        await bookingRouteDependencies.sendWechatSubscribeMessage(
                            targetOpenId,
                            config.templateId,
                            config.page,
                            payload
                        );
                    }
                }
            }
        } catch (err) {
            console.error('Failed to send WeChat subscription message', err);
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
        throw new CustomError(
            'Failed to create booking',
            ErrorCodes.CREATE_BOOKING_ERROR
        );
    }
}

router.post('/', authMiddleware, createBooking);

/**
 * @route GET /api/booking/my
 * @desc Get my bookings interface
 */
router.get('/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        await markUserExpiredBookings(userId, userId.toString());
        const { status, page = 1, limit = 20 } = ctx.query as any;

        const where: any = { userId: userId.toString() };
        if (status !== undefined) {
            const normalizedStatus = normalizeNumericEnum(status);
            if (normalizedStatus !== undefined) {
                where.status = normalizedStatus;
            }
        }

        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);

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

        const bookings = rows.map((booking) => ({
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
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status,
        }));

        ctx.body = {
            success: true,
            data: {
                bookings,
                total: count,
                page: pageNum,
                limit: pageLimit,
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

        await booking.update({
            status: BookingStatus.CANCELED,
            ...buildUpdatedBy(ctx),
        });

        await bookingRouteDependencies.TimeSlotStatus.update(
            { status: TimeSlotStatusValue.AVAILABLE, bookingId: undefined },
            {
                where: {
                    seatId: booking.seatId,
                    date: booking.date,
                    timeSlot: booking.timeSlot,
                },
            }
        );

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

export async function checkinBooking(ctx: any) {
    try {
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        await markUserExpiredBookings(userId, userId.toString());
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
            data: newBooking,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Renewal failed', ErrorCodes.RENEW_BOOKING_ERROR);
    }
}

export const bookingRouteDependencies = {
    performBookingCheckin: async (booking: any, userId: string) =>
        performBookingCheckin(booking, userId),
    performBookingCheckout: async (booking: any, userId: string) =>
        performBookingCheckout(booking, userId),
    performBookingRenew: async (booking: any, requestTimeSlot: any, ctx: any) =>
        performBookingRenew(booking, requestTimeSlot, ctx),
    sequelizeTransaction: async (callback: (t: Transaction) => Promise<any>) =>
        sequelize.transaction(callback),
    markAllExpiredBookings: markAllExpiredBookings,
    resolveTimeSlot,
    validateBookingTimeRange,
    buildWechatTemplatePayload,
    wechatTemplateConfig,
    sendWechatSubscribeMessage,
    getUserDisplayName,
    UserModel: User,
    Seat,
    TimeSlotStatus,
    Notification,
};

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
            ? await User.find({ _id: { $in: uniq } }).select('name username')
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
                startTime: booking.startTime,
                endTime: booking.endTime,
                status: booking.status,
                createdAt: (booking as any).created_at,
                updatedAt: (booking as any).updated_at,
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
