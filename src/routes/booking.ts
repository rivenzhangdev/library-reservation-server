import Router from 'koa-router';
import { authMiddleware, ensureNotBlacklisted } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Booking, Floor, Seat } from '../models/mysql';
import { Op } from 'sequelize';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import { ErrorCodes } from '../utils/error-codes';
import { getUserDisplayNameFromMap } from '../utils/user-display';
import {
    formatRouteDateTime,
    formatRouteDateTimes,
} from '../utils/route-time-serializer';
import { getTimeSlotConfigItems } from '../utils/time-slot-config';
import {
    bookingRouteDependencies,
    buildRenewBookingData as buildRenewBookingDataService,
    checkBookingPermissions as checkBookingPermissionsService,
    expireBookingIfNeeded as expireBookingIfNeededService,
    getBookingEndSlot as getBookingEndSlotService,
    isBookingOverdue as isBookingOverdueService,
    markAllExpiredBookings as markAllExpiredBookingsService,
    performBookingCheckin as performBookingCheckinService,
    performBookingCheckout as performBookingCheckoutService,
    performBookingRenew as performBookingRenewService,
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
export const performBookingCheckin = performBookingCheckinService;
export const performBookingCheckout = performBookingCheckoutService;
export const performBookingRenew = performBookingRenewService;
export const getBookingEndSlot = getBookingEndSlotService;

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
        const maxTimeSlot = slotConfigs.reduce(
            (max, item) => Math.max(max, item.timeSlot),
            -1
        );

        const renewalStatusConditions: any[] = [];
        const bookingRenewalTargets: Array<{
            seatId: number;
            date: string;
            timeSlot: number;
        }> = [];

        rows.forEach((booking) => {
            if (
                booking.status === BookingStatus.UPCOMING &&
                Number.isFinite(booking.timeSlot) &&
                booking.timeSlot < maxTimeSlot
            ) {
                const bookingDate = String(booking.date);
                for (
                    let slot = booking.timeSlot + 1;
                    slot <= maxTimeSlot;
                    slot += 1
                ) {
                    bookingRenewalTargets.push({
                        seatId: booking.seatId,
                        date: bookingDate,
                        timeSlot: slot,
                    });
                }
            }
        });

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

        const list = await Promise.all(
            rows.map(async (booking) => {
                const bookingDate = String(booking.date);
                const renewableTimeSlots: number[] = [];
                if (
                    booking.status === BookingStatus.UPCOMING &&
                    Number.isFinite(booking.timeSlot)
                ) {
                    const currentEndSlot =
                        (await getBookingEndSlot(booking)) ?? booking.timeSlot;
                    for (
                        let slot = currentEndSlot + 1;
                        slot <= maxTimeSlot;
                        slot += 1
                    ) {
                        let blocked = false;
                        for (
                            let checkSlot = currentEndSlot + 1;
                            checkSlot <= slot;
                            checkSlot += 1
                        ) {
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
                            renewableTimeSlots.push(slot);
                        }
                    }
                }

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
                    canRenew:
                        booking.status === BookingStatus.UPCOMING &&
                        renewableTimeSlots.length > 0,
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
