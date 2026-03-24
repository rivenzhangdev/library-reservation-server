import Router from 'koa-router';
import { Op } from 'sequelize';
import { CustomError } from '../middleware/error';
import { Floor, Seat, TimeSlotStatus } from '../models/mysql';
import { ErrorCodes } from '../utils/error-codes';

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

        ctx.body = {
            success: true,
            data: floors.map((floor) => ({
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
router.get('/floor/:floorId', async (ctx) => {
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
            for (const seat of seats) {
                const status = await TimeSlotStatus.findOne({
                    where: {
                        seatId: seat.id,
                        date,
                        timeSlot,
                    },
                });

                seatWithStatus.push({
                    id: seat.id,
                    row: seat.rowNum,
                    col: seat.colNum,
                    type: seat.type,
                    hasSocket: seat.hasSocket,
                    isWindow: seat.isWindow,
                    zone: seat.zone,
                    status: status?.status ?? 'available',
                    description: seat.description,
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
                status: seat.status,
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
router.get('/search', async (ctx) => {
    try {
        const { keyword, date, timeSlot } = ctx.query as any;

        if (!keyword) {
            const err = new CustomError('Search keyword is required', 1001);
            throw err;
        }

        // 模糊搜索座位
        const seats = await Seat.findAll({
            where: {
                description: {
                    [Op.like]: `%${keyword}%`,
                },
            },
            include: [
                {
                    model: Floor,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
        });

        const results = await Promise.all(
            seats.map(async (seat) => {
                let status = 'available';

                if (date && timeSlot) {
                    const slotStatus = await TimeSlotStatus.findOne({
                        where: {
                            seatId: seat.id,
                            date,
                            timeSlot,
                        },
                    });
                    status = slotStatus?.status ?? 'available';
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
                    status,
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

        // 如果提供了日期，查询时间段状态
        if (date) {
            const statuses = await TimeSlotStatus.findAll({
                where: {
                    seatId: seat.id,
                    date,
                },
            });

            result.timeSlotStatus = {
                morning: 'available',
                afternoon: 'available',
                evening: 'available',
            };

            statuses.forEach((status) => {
                result.timeSlotStatus[status.timeSlot] = status.status;
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
