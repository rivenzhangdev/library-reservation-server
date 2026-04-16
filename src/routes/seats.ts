import Router from 'koa-router';
import { Op } from 'sequelize';
import { CustomError } from '../middleware/error';
import { optionalAuthMiddleware } from '../middleware/auth';
import { Floor, Seat, TimeSlotStatus, Booking } from '../models/mysql';
import { compareFloorName } from '../utils/floor-order';
import { ErrorCodes } from '../utils/error-codes';
import {
    assignTimeSlotStatus,
    createTimeSlotStatusMap,
    getSeatAvailabilityStatus,
    normalizeSeatStatus,
} from '../utils/seat-status';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import {
    getTimeSlotConfigItems,
    getTimeSlotConfigItem,
} from '../utils/time-slot-config';

const router = new Router({ prefix: '/api/seats' });

/**
 * @route GET /api/seats/floors
 * @desc Get floors list interface
 */
router.get('/floors', async (ctx) => {
    try {
        const floors = await Floor.findAll({
            attributes: ['id', 'name', 'description', 'totalSeats'],
        });
        const sortedFloors = [...floors].sort((a, b) =>
            compareFloorName(a.name, b.name)
        );

        ctx.body = {
            success: true,
            data: sortedFloors.map((floor) => ({
                id: floor.id,
                name: floor.name,
                description: floor.description,
                totalSeats: floor.totalSeats,
            })),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get floors',
            ErrorCodes.FLOOR_NOT_FOUND
        );
    }
});

/**
 * @route GET /api/seats/floor/:floorId
 * @desc Get seats by floor interface
 */
router.get('/floor/:floorId', optionalAuthMiddleware, async (ctx) => {
    try {
        const floorId = ctx.params.floorId;
        const { date, timeSlot, filters } = ctx.query as any;

        // 查询楼层
        const floor = await Floor.findByPk(floorId);
        if (!floor) {
            throw new CustomError(
                'Floor not found',
                ErrorCodes.GET_SEATS_ERROR
            );
        }

        // 查询座位
        const where: any = { floorId };

        // 应用筛选条件
        if (filters) {
            const filterObj = JSON.parse(filters as string);
            if (filterObj.hasSocket !== undefined) {
                where.hasSocket = filterObj.hasSocket;
            }
            if (filterObj.isWindow !== undefined) {
                where.isWindow = filterObj.isWindow;
            }
            if (filterObj.type) {
                where.type = filterObj.type;
            }
            if (filterObj.zone) {
                where.zone = filterObj.zone;
            }
        }

        const seats = await Seat.findAll({ where });

        // 如果有日期和时间段，查询座位状态
        let seatWithStatus: any[] = [];
        if (date && timeSlot) {
            const currentUserId = (ctx as any).state.user?.id;
            for (const seat of seats) {
                const status = (await TimeSlotStatus.findOne({
                    where: {
                        seatId: seat.id,
                        date,
                        timeSlot,
                    },
                    include: [
                        {
                            model: Booking,
                            as: 'booking',
                            attributes: [
                                'userId',
                                'startTime',
                                'endTime',
                                'timeSlot',
                            ],
                        },
                    ],
                })) as any;

                const availability = getSeatAvailabilityStatus(
                    seat.status,
                    status?.status
                );
                const isMine =
                    availability === TimeSlotStatusValue.BOOKED &&
                    currentUserId !== undefined &&
                    status?.booking &&
                    String(status.booking.userId) === String(currentUserId);

                seatWithStatus.push({
                    id: seat.id,
                    row: seat.rowNum,
                    col: seat.colNum,
                    type: seat.type,
                    hasSocket: seat.hasSocket,
                    isWindow: seat.isWindow,
                    zone: seat.zone,
                    status: Number(availability),
                    isMine,
                    description: seat.description,
                    booking: status?.booking
                        ? {
                              userId: status.booking.userId,
                              startTime: status.booking.startTime,
                              endTime: status.booking.endTime,
                              timeSlot: status.booking.timeSlot,
                          }
                        : undefined,
                });
            }
        } else {
            seatWithStatus = seats.map((seat) => ({
                id: seat.id,
                row: seat.rowNum,
                col: seat.colNum,
                type: seat.type,
                hasSocket: seat.hasSocket,
                isWindow: seat.isWindow,
                zone: seat.zone,
                status: normalizeSeatStatus(seat.status),
                description: seat.description,
            }));
        }

        ctx.body = {
            success: true,
            data: {
                floorId: floor.id,
                floorName: floor.name,
                seats: seatWithStatus,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seats',
            ErrorCodes.SEARCH_SEATS_ERROR
        );
    }
});

/**
 * @route GET /api/seats/search
 * @desc Search seats interface (must be before /:id)
 */
router.get('/search', optionalAuthMiddleware, async (ctx) => {
    try {
        const { keyword, date, timeSlot } = ctx.query as any;

        if (!keyword) {
            const err = new CustomError('Search keyword is required', 1001);
            throw err;
        }

        // 模糊搜索座位
        const keywordLike = `%${keyword}%` as any;
        const seats = await Seat.findAll({
            where: {
                [Op.or]: [
                    {
                        description: {
                            [Op.like]: keywordLike,
                        },
                    },
                    {
                        zone: {
                            [Op.like]: keywordLike,
                        },
                    },
                    {
                        rowNum: {
                            [Op.like]: keywordLike,
                        },
                    },
                    {
                        colNum: {
                            [Op.like]: keywordLike,
                        },
                    },
                    {
                        '$floor.name$': {
                            [Op.like]: keywordLike,
                        },
                    },
                ],
            },
            include: [
                {
                    model: Floor,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
        });

        const currentUserId = (ctx as any).state.user?.id;
        const results = await Promise.all(
            seats.map(async (seat) => {
                let status = getSeatAvailabilityStatus(seat.status);
                let isMine = false;

                if (date && timeSlot) {
                    const slotStatus = (await TimeSlotStatus.findOne({
                        where: {
                            seatId: seat.id,
                            date,
                            timeSlot,
                        },
                        include: [
                            {
                                model: Booking,
                                as: 'booking',
                                attributes: ['userId'],
                            },
                        ],
                    })) as any;
                    const availability = getSeatAvailabilityStatus(
                        seat.status,
                        slotStatus?.status
                    );
                    status = Number(availability);
                    if (
                        availability === TimeSlotStatusValue.BOOKED &&
                        currentUserId !== undefined &&
                        slotStatus?.booking &&
                        String(slotStatus.booking.userId) ===
                            String(currentUserId)
                    ) {
                        isMine = true;
                    }
                }

                return {
                    id: seat.id,
                    row: seat.rowNum,
                    col: seat.colNum,
                    type: seat.type,
                    hasSocket: seat.hasSocket,
                    isWindow: seat.isWindow,
                    zone: seat.zone,
                    floorName: (seat as any).floor?.name,
                    description: seat.description,
                    status,
                    isMine,
                };
            })
        );

        ctx.body = {
            success: true,
            data: results,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to search seats',
            ErrorCodes.INVALID_KEYWORD
        );
    }
});

/**
 * @route GET /api/seats/:id
 * @desc Get seat details interface (must be after all static routes)
 */
router.get('/:id', async (ctx) => {
    try {
        const seatId = ctx.params.id;
        const { date } = ctx.query as any;

        const seat = await Seat.findByPk(seatId, {
            include: [
                {
                    model: Floor,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
        });

        if (!seat) {
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        }

        const result: any = {
            id: seat.id,
            row: seat.rowNum,
            col: seat.colNum,
            type: seat.type,
            hasSocket: seat.hasSocket,
            isWindow: seat.isWindow,
            zone: seat.zone,
            description: seat.description,
            floorId: seat.floorId,
            floorName: (seat as any).floor?.name,
        };

        // 如果提供了日期，查询时间段状态和预约区间
        if (date) {
            const [statuses, bookings] = await Promise.all([
                TimeSlotStatus.findAll({
                    where: {
                        seatId: seat.id,
                        date,
                    },
                }),
                Booking.findAll({
                    where: {
                        seatId: seat.id,
                        date,
                        status: {
                            [Op.ne]: BookingStatus.CANCELED,
                        },
                    },
                    attributes: ['timeSlot', 'startTime', 'endTime', 'status'],
                }),
            ]);

            result.timeSlotStatus = createTimeSlotStatusMap(seat.status);

            statuses.forEach((status) => {
                assignTimeSlotStatus(
                    result.timeSlotStatus,
                    status.timeSlot,
                    status.status
                );
            });

            const slotConfigs = await getTimeSlotConfigItems();
            result.bookings = bookings.map((booking) => {
                const config = getTimeSlotConfigItem(
                    booking.timeSlot,
                    slotConfigs
                );
                const startTime = booking.startTime
                    ? String(booking.startTime).slice(0, 5)
                    : config.startTime;
                const endTime = booking.endTime
                    ? String(booking.endTime).slice(0, 5)
                    : config.endTime;
                return {
                    timeSlot: booking.timeSlot,
                    startTime,
                    endTime,
                    status: booking.status,
                };
            });
        }

        ctx.body = {
            success: true,
            data: result,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat details',
            ErrorCodes.GET_SEAT_DETAILS_ERROR
        );
    }
});

export default router;
