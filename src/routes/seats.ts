import Router from 'koa-router';
import { Op } from 'sequelize';
import { CustomError } from '../middleware/error';
import { optionalAuthMiddleware } from '../middleware/auth';
import {
    Floor,
    Seat,
    TimeSlotStatus,
    Booking,
    SeatTypeConfig,
    SeatFacilityConfig,
} from '../models/mysql';
import { Zone as MongoZone } from '../models/mongodb';
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
import { formatRouteDateTime } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/seats' });

function toLocalDateOnly(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveFacilityField(rawKey: any) {
    const key = String(rawKey || '')
        .trim()
        .toLowerCase();
    if (!key) return '';
    if (['power', 'socket', 'hassocket', 'has_socket'].includes(key)) {
        return 'hasSocket';
    }
    if (['window', 'iswindow', 'is_window'].includes(key)) {
        return 'isWindow';
    }
    return '';
}

function normalizeConfigText(value: any) {
    return String(value ?? '').trim();
}

function resolveSeatTypeValueByCode(
    rawType: any,
    typeValueByCode: Record<string, string>
) {
    const rawKey = normalizeConfigText(rawType);
    if (!rawKey) return '';
    const numericKey = String(Number(rawKey));
    if (rawKey in typeValueByCode) return typeValueByCode[rawKey];
    if (numericKey !== 'NaN' && numericKey in typeValueByCode) {
        return typeValueByCode[numericKey];
    }
    return rawKey;
}

function resolveSeatTypeLabelByValue(
    rawType: any,
    typeValue: string,
    typeLabelByValue: Record<string, string>
) {
    if (typeValue && typeLabelByValue[typeValue]) {
        return typeLabelByValue[typeValue];
    }
    return typeValue || normalizeConfigText(rawType);
}

function resolveSeatFacilityFlag(seat: any, facilityKey: string) {
    const field = resolveFacilityField(facilityKey);
    if (field) {
        return Boolean(seat?.[field]);
    }
    return Boolean(seat?.[facilityKey]);
}

async function loadSeatConfigMaps() {
    const [seatTypeConfigs, seatFacilityConfigs] = await Promise.all([
        SeatTypeConfig.findAll(),
        SeatFacilityConfig.findAll(),
    ]);

    const enabledTypeConfigs = seatTypeConfigs.filter(
        (item: any) =>
            item &&
            item.enabled !== false &&
            normalizeConfigText(item.value) &&
            normalizeConfigText(item.label)
    );

    const typeValueByCode = enabledTypeConfigs.reduce(
        (acc: Record<string, string>, item: any) => {
            const typeKey = normalizeConfigText(item.type);
            const value = normalizeConfigText(item.value);
            if (typeKey && value) {
                acc[typeKey] = value;
            }
            return acc;
        },
        {} as Record<string, string>
    );

    const typeLabelByValue = enabledTypeConfigs.reduce(
        (acc: Record<string, string>, item: any) => {
            const value = normalizeConfigText(item.value);
            const label = normalizeConfigText(item.label);
            if (value && label) {
                acc[value] = label;
            }
            return acc;
        },
        {} as Record<string, string>
    );

    const typeCodeByValue = enabledTypeConfigs.reduce(
        (acc: Record<string, number>, item: any) => {
            const value = normalizeConfigText(item.value);
            const typeCode = Number(item.type);
            if (value && Number.isFinite(typeCode)) {
                acc[value] = typeCode;
            }
            return acc;
        },
        {} as Record<string, number>
    );

    const facilityOptions = seatFacilityConfigs
        .filter(
            (item: any) =>
                item && item.enabled !== false && normalizeConfigText(item.key)
        )
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((item: any) => ({
            key: normalizeConfigText(item.key),
            label:
                normalizeConfigText(item.label) ||
                normalizeConfigText(item.key),
        }));

    return {
        typeValueByCode,
        typeLabelByValue,
        typeCodeByValue,
        facilityOptions,
    };
}

function buildSeatMeta(
    seat: any,
    typeValueByCode: Record<string, string>,
    typeLabelByValue: Record<string, string>,
    facilityOptions: Array<{ key: string; label: string }>
) {
    const typeValue = resolveSeatTypeValueByCode(seat?.type, typeValueByCode);
    const typeLabel = resolveSeatTypeLabelByValue(
        seat?.type,
        typeValue,
        typeLabelByValue
    );

    const facilityFlags = facilityOptions.reduce(
        (acc, option) => {
            acc[option.key] = resolveSeatFacilityFlag(seat, option.key);
            return acc;
        },
        {} as Record<string, boolean>
    );
    const facilities = facilityOptions
        .filter((option) => facilityFlags[option.key])
        .map((option) => option.label);

    return {
        typeValue,
        typeLabel,
        facilityFlags,
        facilities,
    };
}

/**
 * @route GET /api/seats/floors
 * @desc Get floors list interface
 */
router.get('/floors', async (ctx) => {
    try {
        const { page = '1', pageSize, limit } = ctx.query as any;
        const floors = await Floor.findAll({
            attributes: ['id', 'name', 'description', 'totalSeats'],
        });
        const sortedFloors = [...floors].sort((a, b) =>
            compareFloorName(a.name, b.name)
        );
        const list = sortedFloors.map((floor) => ({
            id: floor.id,
            name: floor.name,
            description: floor.description,
            totalSeats: floor.totalSeats,
        }));
        const total = list.length;
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.max(
            1,
            Math.min(200, Number(pageSize ?? limit ?? 20) || 20)
        );
        const pagedList = list.slice(
            (safePage - 1) * safePageSize,
            safePage * safePageSize
        );

        ctx.body = {
            success: true,
            data: {
                list: pagedList,
                total,
                page: safePage,
                pageSize: safePageSize,
            },
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
 * @route GET /api/seats/zones
 * @desc Get public zone list configured by admin
 */
router.get('/zones', async (ctx) => {
    try {
        const zones = await MongoZone.find({})
            .sort({ name: 1 })
            .select('name description')
            .lean();

        ctx.body = {
            success: true,
            data: (zones || []).map((item: any) => ({
                id: String(item._id),
                name: String(item.name || '').trim(),
                description: String(item.description || '').trim(),
            })),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get zones',
            ErrorCodes.GET_SEATS_ERROR
        );
    }
});

/**
 * @route GET /api/seats/overview
 * @desc Get public seat overview summary using the same statistics logic as admin dashboard floor stats
 */
router.get('/overview', async (ctx) => {
    try {
        const queryDate = String(ctx.query.date || '').trim();
        const targetDate = queryDate || toLocalDateOnly(new Date());
        const floors = (await Floor.findAll()).sort((a, b) =>
            compareFloorName(a.name, b.name)
        );

        const floorStats = await Promise.all(
            floors.map(async (floor: any) => {
                const totalSeats = await Seat.count({
                    where: { floorId: floor.id },
                });
                const maintenanceSeats = await Seat.count({
                    where: { floorId: floor.id, status: 1 },
                });
                const availableSeats = totalSeats - maintenanceSeats;
                const occupiedSeats = await Booking.count({
                    where: {
                        date: targetDate,
                        status: {
                            [Op.in]: [
                                BookingStatus.UPCOMING,
                                BookingStatus.ONGOING,
                            ],
                        },
                    },
                    include: [
                        {
                            model: Seat,
                            as: 'seat',
                            where: { floorId: floor.id },
                            attributes: [],
                        },
                    ],
                });

                return {
                    floorId: String(floor.id),
                    floorName: floor.name,
                    totalSeats,
                    availableSeats,
                    occupiedSeats,
                    maintenanceSeats,
                    usageRate:
                        totalSeats > 0
                            ? Math.round((occupiedSeats / totalSeats) * 100)
                            : 0,
                };
            })
        );

        const totals = floorStats.reduce(
            (acc, item) => {
                acc.totalSeats += item.totalSeats;
                acc.availableSeats += item.availableSeats;
                acc.occupiedSeats += item.occupiedSeats;
                acc.maintenanceSeats += item.maintenanceSeats;
                return acc;
            },
            {
                totalSeats: 0,
                availableSeats: 0,
                occupiedSeats: 0,
                maintenanceSeats: 0,
            }
        );

        ctx.body = {
            success: true,
            data: {
                date: targetDate,
                ...totals,
                floorStats,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat overview',
            ErrorCodes.GET_SEATS_ERROR
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
        const { typeValueByCode, typeLabelByValue, facilityOptions } =
            await loadSeatConfigMaps();

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
                const seatMeta = buildSeatMeta(
                    seat,
                    typeValueByCode,
                    typeLabelByValue,
                    facilityOptions
                );
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
                    typeValue: seatMeta.typeValue,
                    typeLabel: seatMeta.typeLabel,
                    hasSocket: seat.hasSocket,
                    isWindow: seat.isWindow,
                    facilityFlags: seatMeta.facilityFlags,
                    facilities: seatMeta.facilities,
                    zone: seat.zone,
                    status: Number(availability),
                    isMine,
                    description: seat.description,
                    booking: status?.booking
                        ? {
                              userId: status.booking.userId,
                              startTime: formatRouteDateTime(
                                  status.booking.startTime
                              ),
                              endTime: formatRouteDateTime(
                                  status.booking.endTime
                              ),
                              timeSlot: status.booking.timeSlot,
                          }
                        : undefined,
                });
            }
        } else {
            seatWithStatus = seats.map((seat) => ({
                ...buildSeatMeta(
                    seat,
                    typeValueByCode,
                    typeLabelByValue,
                    facilityOptions
                ),
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
        const {
            keyword,
            date,
            timeSlot,
            typeValue,
            facilityKey,
            page,
            pageSize,
            limit,
        } = ctx.query as any;

        const normalizedKeyword = String(keyword || '').trim();
        const normalizedTypeValue = String(typeValue || '').trim();
        const normalizedFacilityKey = String(facilityKey || '').trim();
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.max(
            1,
            Math.min(200, Number(pageSize ?? limit ?? 20) || 20)
        );

        const {
            typeValueByCode,
            typeLabelByValue,
            typeCodeByValue,
            facilityOptions,
        } = await loadSeatConfigMaps();

        let targetTypeCode: number | null = null;
        if (normalizedTypeValue) {
            if (!(normalizedTypeValue in typeCodeByValue)) {
                ctx.body = {
                    success: true,
                    data: {
                        list: [],
                        total: 0,
                        page: safePage,
                        pageSize: safePageSize,
                    },
                };
                return;
            }
            targetTypeCode = Number(typeCodeByValue[normalizedTypeValue]);
        }

        const facilityField = resolveFacilityField(normalizedFacilityKey);
        if (normalizedFacilityKey && !facilityField) {
            ctx.body = {
                success: true,
                data: {
                    list: [],
                    total: 0,
                    page: safePage,
                    pageSize: safePageSize,
                },
            };
            return;
        }

        const where: any = {};
        const andConditions: any[] = [];

        if (normalizedKeyword) {
            const keywordLike = `%${normalizedKeyword}%` as any;
            andConditions.push({
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
            });
        }

        if (targetTypeCode !== null && Number.isFinite(targetTypeCode)) {
            andConditions.push({ type: targetTypeCode });
        }

        if (facilityField) {
            andConditions.push({ [facilityField]: true });
        }

        if (andConditions.length === 1) {
            Object.assign(where, andConditions[0]);
        } else if (andConditions.length > 1) {
            where[Op.and] = andConditions;
        }

        const { count, rows } = await Seat.findAndCountAll({
            where,
            include: [
                {
                    model: Floor,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
            order: [
                ['floorId', 'ASC'],
                ['rowNum', 'ASC'],
                ['colNum', 'ASC'],
                ['id', 'ASC'],
            ],
            offset: (safePage - 1) * safePageSize,
            limit: safePageSize,
        });

        const currentUserId = (ctx as any).state.user?.id;
        const results = await Promise.all(
            rows.map(async (seat) => {
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
                    ...buildSeatMeta(
                        seat,
                        typeValueByCode,
                        typeLabelByValue,
                        facilityOptions
                    ),
                    id: seat.id,
                    row: seat.rowNum,
                    col: seat.colNum,
                    type: seat.type,
                    hasSocket: seat.hasSocket,
                    isWindow: seat.isWindow,
                    zone: seat.zone,
                    floorId: seat.floorId,
                    floorName: (seat as any).floor?.name,
                    description: seat.description,
                    status,
                    isMine,
                };
            })
        );

        ctx.body = {
            success: true,
            data: {
                list: results,
                total: Number(count || 0),
                page: safePage,
                pageSize: safePageSize,
            },
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
