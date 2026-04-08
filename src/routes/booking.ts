import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Notification, User } from '../models/mongodb';
import { Booking, Floor, Seat, TimeSlotStatus } from '../models/mysql';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/booking' });

/**
 * @route POST /api/booking
 * @desc Create booking interface
 */
router.post('/', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { seatId, date, timeSlot, startTime, endTime } = ctx.request
            .body as any;

        // Validate required parameters
        if (!seatId || !date || !timeSlot) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        // Check if seat exists
        const seat = await Seat.findByPk(seatId);
        if (!seat) {
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        }

        // Check if time slot is available
        const existingStatus = await TimeSlotStatus.findOne({
            where: {
                seatId,
                date,
                timeSlot,
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
                timeSlot,
            },
        });

        if (existingBooking) {
            throw new CustomError(
                'You have already booked this time slot',
                5002
            );
        }

        // Create booking (server-authoritative audit fields)
        const booking = await Booking.create({
            userId: userId.toString(),
            seatId,
            date,
            timeSlot,
            startTime,
            endTime,
            status: BookingStatus.UPCOMING, // 使用数字枚举
            createdBy: userId.toString(),
            updatedBy: userId.toString(),
        });

        // Update time slot status
        if (existingStatus) {
            await existingStatus.update({
                status: TimeSlotStatusValue.BOOKED, // 使用数字枚举
                bookingId: booking.id,
            });
        } else {
            await TimeSlotStatus.create({
                seatId,
                date,
                timeSlot,
                status: TimeSlotStatusValue.BOOKED, // 使用数字枚举
                bookingId: booking.id,
            });
        }

        // Create notification
        await Notification.create({
            userId,
            createdBy: userId,
            type: 1, // NotificationType.BOOKING
            title: 'Booking successful',
            content: `You have successfully booked a seat on ${date}`,
            relatedId: booking.id.toString(),
            updatedBy: userId,
        });

        // try fetch createdBy display name
        let createdByName: string | undefined = undefined;
        try {
            if (booking.createdBy) {
                const cb = await User.findById(booking.createdBy)
                    .select('name username')
                    .lean();
                if (cb) createdByName = cb.username || cb.name;
            }
        } catch (e) {
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
});

/**
 * @route GET /api/booking/my
 * @desc Get my bookings interface
 */
router.get('/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { status, page = 1, limit = 20 } = ctx.query as any;

        const where: any = { userId: userId.toString() };
        if (status !== undefined) {
            where.status = parseInt(status as string); // 转换为数字
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

/**
 * @route DELETE /api/booking/:id
 * @desc Cancel booking interface
 */
router.delete('/:id', authMiddleware, async (ctx) => {
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

        // Update booking status
        await booking.update({
            status: BookingStatus.CANCELED,
            updatedBy: userId.toString(),
        }); // 使用数字枚举

        // Release time slot
        await TimeSlotStatus.update(
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
});

/**
 * @route POST /api/booking/checkin/:id
 * @desc Booking check-in interface
 */
router.post('/checkin/:id', authMiddleware, async (ctx) => {
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

        if (booking.status !== BookingStatus.UPCOMING) {
            // 使用数字枚举
            throw new CustomError(
                'Check-in is not allowed for this booking',
                5007
            );
        }

        // TODO: Validate location information

        // Update booking status
        await booking.update({
            status: BookingStatus.ONGOING,
            updatedBy: userId.toString(),
        });

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
});

/**
 * @route POST /api/booking/checkout/:id
 * @desc Booking check-out interface
 */
router.post('/checkout/:id', authMiddleware, async (ctx) => {
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

        if (booking.status !== BookingStatus.ONGOING) {
            throw new CustomError(
                'Check-out is not allowed for this booking',
                ErrorCodes.CHECKIN_NOT_ALLOWED
            );
        }

        await booking.update({
            status: BookingStatus.COMPLETED,
            updatedBy: userId.toString(),
        });

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
});

/**
 * @route POST /api/booking/renew/:id
 * @desc Booking renewal interface
 */
router.post('/renew/:id', authMiddleware, async (ctx) => {
    try {
        const bookingId = ctx.params.id;
        const userId = (ctx as any).state.user.id;
        const { timeSlot } = ctx.request.body as any;

        if (!timeSlot) {
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

        // Check if new time slot is available
        const existingStatus = await TimeSlotStatus.findOne({
            where: {
                seatId: booking.seatId,
                date: booking.date,
                timeSlot,
            },
        });

        if (existingStatus?.status === TimeSlotStatusValue.BOOKED) {
            throw new CustomError(
                '该时间段已被预约',
                ErrorCodes.BOOKING_CONFLICT
            );
        }

        // Create new booking for the renewed time slot
        const newBooking = await Booking.create({
            userId: userId.toString(),
            seatId: booking.seatId,
            date: booking.date,
            timeSlot,
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: BookingStatus.UPCOMING,
            createdBy: userId.toString(),
            updatedBy: userId.toString(),
        });

        // Mark the new time slot as booked
        await TimeSlotStatus.upsert({
            seatId: booking.seatId,
            date: booking.date,
            timeSlot,
            status: TimeSlotStatusValue.BOOKED,
        });

        ctx.body = {
            success: true,
            data: newBooking,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Renewal failed', ErrorCodes.RENEW_BOOKING_ERROR);
    }
});

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
                userName:
                    userMap[booking.userId]?.username ||
                    userMap[booking.userId]?.name ||
                    booking.userId,
                createdBy: (booking as any).createdBy,
                createdByName:
                    userMap[(booking as any).createdBy]?.username ||
                    userMap[(booking as any).createdBy]?.name ||
                    undefined,
                updatedBy: (booking as any).updatedBy,
                updatedByName:
                    userMap[(booking as any).updatedBy]?.username ||
                    userMap[(booking as any).updatedBy]?.name ||
                    undefined,
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
