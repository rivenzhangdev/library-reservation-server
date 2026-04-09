/* eslint-disable */
/* eslint-disable @typescript-eslint/no-require-imports */
import Router from 'koa-router';
import dotenv from 'dotenv';

dotenv.config();
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import {
    Notification,
    User,
    Activity,
    Zone,
    CreditRecord,
} from '../models/mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Booking, Floor, Seat, TimeSlotStatus } from '../models/mysql';
import { Op } from 'sequelize';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';
import { normalizeUploadUrl, saveBase64Image } from '../utils/upload';
import { compareFloorName } from '../utils/floor-order';
import { normalizeSeatStatus } from '../utils/seat-status';

const router = new Router({ prefix: '/api' });

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';
import { Roles } from '../constants/roles';

function requireAdmin(ctx: any) {
    const user = ctx.state.user;
    if (user?.role !== Roles.ADMIN) {
        throw new CustomError('Forbidden', ErrorCodes.FORBIDDEN);
    }
}

function toAuditId(value: any) {
    if (!value) return undefined;
    if (typeof value === 'object') {
        return String(value._id ?? value.id ?? '');
    }
    return String(value);
}

function getDisplayName(value: any, userMap: Record<string, any>) {
    if (!value) return undefined;
    if (typeof value === 'object') {
        return (
            value.username ||
            value.name ||
            userMap[toAuditId(value) || '']?.username ||
            userMap[toAuditId(value) || '']?.name
        );
    }
    const id = String(value);
    return userMap[id]?.username || userMap[id]?.name || undefined;
}

// ---- Bookings compatibility (admin expects /api/bookings) ----
router.get('/bookings', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const {
            status,
            page = 1,
            limit = 20,
            q,
            from,
            date,
            dateRange,
            dateRangeStart,
            dateRangeEnd,
            timeSlot,
            userId,
            seatId,
        } = ctx.query as any;

        const where: any = {};
        if (status !== undefined) where.status = parseInt(status as string);
        if (typeof userId !== 'undefined' && userId) where.userId = userId;
        if (typeof seatId !== 'undefined' && seatId !== '') {
            const sid = Number(seatId);
            if (!Number.isNaN(sid)) where.seatId = sid;
        }
        if (typeof timeSlot !== 'undefined' && timeSlot !== '') {
            const ts = Number(timeSlot);
            if (!Number.isNaN(ts)) where.timeSlot = ts;
        }

        const keyword = (q || from || '').toString().trim();
        if (keyword) {
            const searchConditions: any[] = [{ userId: keyword }];
            const seatIdCandidate = Number(keyword);
            if (!Number.isNaN(seatIdCandidate)) {
                searchConditions.push({ seatId: seatIdCandidate });
            }
            searchConditions.push({
                '$seat.name$': { [Op.like]: `%${keyword}%` },
            });
            searchConditions.push({
                '$seat.zone$': { [Op.like]: `%${keyword}%` },
            });
            where[Op.or] = searchConditions;
        }

        // dateRange can be an array, or a string like "2026-01-01~2026-01-05" or csv
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

        const normalizeDateParam = (value: any) => {
            if (value === undefined || value === null) return undefined;
            if (Array.isArray(value) && value.length > 0)
                return String(value[0]);
            if (typeof value === 'object' && value?.toISOString)
                return value.toISOString().split('T')[0];
            if (typeof value === 'string') {
                if (value.includes('T')) return value.split('T')[0];
                return value;
            }
            return String(value);
        };

        const exactDate = normalizeDateParam(date);
        if (exactDate) {
            where.date = exactDate;
        } else {
            let drange = parseRange(dateRange);
            if (!drange && (dateRangeStart || dateRangeEnd)) {
                drange = [
                    dateRangeStart || dateRangeEnd,
                    dateRangeEnd || dateRangeStart,
                ];
            }
            if (drange && drange[0] && drange[1]) {
                // Booking.date is DATEONLY (YYYY-MM-DD)
                where.date = { [Op.between]: [drange[0], drange[1]] };
            } else if (drange && drange[0]) {
                where.date = drange[0];
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

        // Fetch user display names for bookings (collect userId, createdBy, updatedBy)
        const userIds = Array.from(
            new Set(
                rows
                    .flatMap((r: any) => [
                        r.userId,
                        (r as any).createdBy,
                        (r as any).updatedBy,
                    ])
                    .filter(Boolean)
                    .map(String)
            )
        );

        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => {
                userMap[String(u._id)] = u;
            });
        }

        const bookings = rows.map((booking) => {
            const createdById = (booking as any).createdBy
                ? String((booking as any).createdBy)
                : undefined;
            const updatedById = (booking as any).updatedBy
                ? String((booking as any).updatedBy)
                : undefined;
            const userIdStr = booking.userId
                ? String(booking.userId)
                : undefined;
            return {
                id: booking.id,
                seatId: booking.seatId,
                floorName: (booking as any).seat?.floor?.name ?? '',
                rowNum: (booking as any).seat?.rowNum ?? 0,
                colNum: (booking as any).seat?.colNum ?? 0,
                zone: (booking as any).seat?.zone ?? '',
                type: (booking as any).seat?.type ?? '',
                date: booking.date,
                timeSlot: booking.timeSlot,
                startTime: booking.startTime,
                endTime: booking.endTime,
                status: booking.status,
                userId: booking.userId,
                userName: userIdStr
                    ? userMap[userIdStr]?.username || userMap[userIdStr]?.name
                    : booking.userId,
                createdBy: createdById,
                createdByName: createdById
                    ? userMap[createdById]?.username ||
                      userMap[createdById]?.name
                    : undefined,
                updatedBy: updatedById,
                updatedByName: updatedById
                    ? userMap[updatedById]?.username ||
                      userMap[updatedById]?.name
                    : undefined,
            };
        });

        ctx.body = {
            success: true,
            data: {
                list: bookings,
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

router.get('/bookings/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const bookingId = ctx.params.id;

        const booking = await Booking.findOne({
            where: { id: bookingId },
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

        // fetch display names for createdBy/updatedBy (if any)
        const uIds = Array.from(
            new Set(
                [
                    booking.userId,
                    (booking as any).createdBy,
                    (booking as any).updatedBy,
                ]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const uMap: Record<string, any> = {};
        if (uIds.length) {
            const us = await User.find({ _id: { $in: uIds } })
                .select('name username')
                .lean();
            us.forEach((u: any) => {
                uMap[String(u._id)] = u;
            });
        }

        const createdById = (booking as any).createdBy
            ? String((booking as any).createdBy)
            : undefined;
        const updatedById = (booking as any).updatedBy
            ? String((booking as any).updatedBy)
            : undefined;

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
                date: booking.date,
                timeSlot: booking.timeSlot,
                startTime: booking.startTime,
                endTime: booking.endTime,
                status: booking.status,
                createdAt: (booking as any).created_at,
                updatedAt: (booking as any).updated_at,
                createdBy: createdById,
                createdByName: createdById
                    ? uMap[createdById]?.username || uMap[createdById]?.name
                    : undefined,
                updatedBy: updatedById,
                updatedByName: updatedById
                    ? uMap[updatedById]?.username || uMap[updatedById]?.name
                    : undefined,
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

router.post('/bookings/cancel/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const bookingId = ctx.params.id;

        const booking = await Booking.findOne({
            where: { id: bookingId },
        });

        if (!booking)
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );

        const currentUserId = (ctx as any).state.user.id;
        await booking.update({
            status: BookingStatus.CANCELED,
            updatedBy: currentUserId,
        });

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

        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to cancel booking',
            ErrorCodes.CANCEL_BOOKING_ERROR
        );
    }
});

router.delete('/bookings/:id', authMiddleware, async (ctx) => {
    try {
        const bookingId = ctx.params.id;
        const user = (ctx as any).state.user;

        if (user?.role !== Roles.ADMIN) {
            throw new CustomError('Forbidden', ErrorCodes.FORBIDDEN);
        }

        const booking = await Booking.findByPk(bookingId);
        if (!booking)
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );

        await booking.destroy();

        // release timeslot
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

        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete booking',
            ErrorCodes.CANCEL_BOOKING_ERROR
        );
    }
});

// ---- Simple admin login compatibility (/api/login) ----
router.post('/login', async (ctx) => {
    try {
        const { username, password } = ctx.request.body as any;
        if (!username) {
            throw new CustomError(
                'username required',
                ErrorCodes.INVALID_PARAMS,
                400
            );
        }

        const user = await User.findOne({ username }).lean();
        if (!user) {
            throw new CustomError(
                'Invalid credentials',
                ErrorCodes.UNAUTHORIZED,
                401
            );
        }

        let ok = false;
        if (user.password) {
            try {
                ok = await bcrypt.compare(password || '', user.password);
            } catch (_e) {
                // if compare fails, fallback to direct equality (dev only)
                ok = user.password === password;
            }
        } else {
            ok = true; // user created without password (mock), allow login
        }

        if (!ok) {
            throw new CustomError(
                'Invalid credentials',
                ErrorCodes.UNAUTHORIZED,
                401
            );
        }

        const normalizeRole = (r: any) => {
            if (typeof r === 'number') return r;
            return Roles.USER;
        };

        const roleForToken = normalizeRole(user.role);

        const token = jwt.sign(
            {
                id: user._id?.toString ? user._id.toString() : user._id,
                username: user.username,
                role: roleForToken,
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        ctx.body = {
            success: true,
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name ?? user.username,
                    avatar:
                        normalizeUploadUrl(String(user.avatar || '')) || null,
                    username: user.username,
                    role: roleForToken,
                },
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Login failed', ErrorCodes.INTERNAL_ERROR);
    }
});

// ---- Seat compatibility (/api/seat/* expected by admin) ----
router.get('/seat/list', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const {
            floorId,
            keyword,
            q,
            status,
            type,
            page = 1,
            limit = 20,
        } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const where: any = {};
        if (floorId) where.floorId = floorId;
        if (typeof status !== 'undefined' && status !== '') {
            const parsedStatus = Number(status);
            if (!Number.isNaN(parsedStatus)) {
                where.status = parsedStatus;
            }
        }
        if (typeof type !== 'undefined' && type !== '') {
            where.type = type;
        }
        const seats = await Seat.findAll({
            where,
            include: [
                {
                    model: (require('../models/mysql/Floor') as any).default,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
        });

        const searchKeyword = String(keyword || q || '')
            .trim()
            .toLowerCase();
        let filteredSeats = searchKeyword
            ? seats.filter((seat: any) => {
                  const floorName = (seat as any).floor?.name || '';
                  const searchValues = [
                      seat.id,
                      floorName,
                      seat.zone,
                      (seat as any).zoneObj?.name,
                      seat.description,
                      `R${seat.rowNum}`,
                      `C${seat.colNum}`,
                      `${seat.rowNum}-${seat.colNum}`,
                  ]
                      .filter(Boolean)
                      .map((value) => String(value).toLowerCase());
                  return searchValues.some((value) =>
                      value.includes(searchKeyword)
                  );
              })
            : seats;

        const total = filteredSeats.length;
        const pagedSeats = filteredSeats.slice(
            (pageNum - 1) * pageLimit,
            pageNum * pageLimit
        );

        // collect audit user ids from seats and fetch display names
        const seatUserIds = Array.from(
            new Set(
                pagedSeats
                    .flatMap((s: any) => [s.createdBy, s.updatedBy])
                    .filter(Boolean)
            )
        );
        const seatUserMap: Record<string, any> = {};
        if (seatUserIds.length) {
            const users = await User.find({ _id: { $in: seatUserIds } }).select(
                'name username'
            );
            users.forEach((u: any) => {
                seatUserMap[u._id.toString()] = u;
            });
        }

        const mappedSeats = pagedSeats.map((seat) => ({
            id: seat.id,
            floorId: seat.floorId,
            floorName: (seat as any).floor?.name || '',
            rowNum: seat.rowNum,
            colNum: seat.colNum,
            status: normalizeSeatStatus(seat.status),
            type: seat.type,
            hasSocket: seat.hasSocket,
            isWindow: seat.isWindow,
            zone: seat.zone,
            zoneId: (seat as any).zoneId || (seat as any).zoneObj?.id,
            zoneName: (seat as any).zoneObj?.name || seat.zone,
            description: seat.description,
            createdBy: (seat as any).createdBy,
            createdByName:
                seatUserMap[(seat as any).createdBy]?.username ||
                seatUserMap[(seat as any).createdBy]?.name,
            updatedBy: (seat as any).updatedBy,
            updatedByName:
                seatUserMap[(seat as any).updatedBy]?.username ||
                seatUserMap[(seat as any).updatedBy]?.name,
        }));

        ctx.body = {
            success: true,
            data: {
                list: mappedSeats,
                total,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat list',
            ErrorCodes.GET_SEATS_ERROR
        );
    }
});

router.get('/seat/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const seatId = ctx.params.id;
        const seat = await Seat.findByPk(seatId, {
            include: [
                {
                    model: (require('../models/mysql/Floor') as any).default,
                    attributes: ['id', 'name'],
                    as: 'floor',
                },
            ],
        });
        if (!seat)
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        // fetch audit user display names for this seat
        const userIds = Array.from(
            new Set(
                [(seat as any).createdBy, (seat as any).updatedBy].filter(
                    Boolean
                )
            )
        );
        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } }).select(
                'name username'
            );
            users.forEach((u: any) => {
                userMap[u._id.toString()] = u;
            });
        }

        ctx.body = {
            success: true,
            data: {
                id: seat.id,
                floorId: seat.floorId,
                floorName: (seat as any).floor?.name || '',
                rowNum: seat.rowNum,
                colNum: seat.colNum,
                status: normalizeSeatStatus(seat.status),
                type: seat.type,
                hasSocket: seat.hasSocket,
                isWindow: seat.isWindow,
                zone: seat.zone,
                description: seat.description,
                zoneId: (seat as any).zoneId || (seat as any).zoneObj?.id,
                zoneName: (seat as any).zoneObj?.name || seat.zone,
                createdBy: (seat as any).createdBy,
                createdByName:
                    userMap[(seat as any).createdBy]?.username ||
                    userMap[(seat as any).createdBy]?.name,
                updatedBy: (seat as any).updatedBy,
                updatedByName:
                    userMap[(seat as any).updatedBy]?.username ||
                    userMap[(seat as any).updatedBy]?.name,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat',
            ErrorCodes.GET_SEAT_DETAILS_ERROR
        );
    }
});

router.post('/seat', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        // Remove zoneId if present (column does not exist in DB)
        delete data.zoneId;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) data.createdBy = user.id;
        } catch (e) {}
        const seat = await Seat.create(data);

        // resolve createdBy/updatedBy display names
        const seatPlain = (seat as any).get
            ? (seat as any).get({ plain: true })
            : seat;
        const seatUserIds = Array.from(
            new Set(
                [seatPlain.createdBy, seatPlain.updatedBy]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const seatUserMap: Record<string, any> = {};
        if (seatUserIds.length) {
            const users = await User.find({ _id: { $in: seatUserIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (seatUserMap[String(u._id)] = u));
        }

        const seatResp = Object.assign({}, seatPlain, {
            status: normalizeSeatStatus(seatPlain.status),
            createdBy: seatPlain.createdBy,
            createdByName: seatPlain.createdBy
                ? seatUserMap[String(seatPlain.createdBy)]?.username ||
                  seatUserMap[String(seatPlain.createdBy)]?.name
                : undefined,
            updatedBy: seatPlain.updatedBy,
            updatedByName: seatPlain.updatedBy
                ? seatUserMap[String(seatPlain.updatedBy)]?.username ||
                  seatUserMap[String(seatPlain.updatedBy)]?.name
                : undefined,
        });

        ctx.body = { success: true, data: seatResp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('[Seat Create Error]', error.message || error);
        throw new CustomError(
            error.message || 'Failed to create seat',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/seat/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const seatId = ctx.params.id;
        const data = ctx.request.body as any;
        const seat = await Seat.findByPk(seatId);
        if (!seat)
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        // Remove zoneId if present (column does not exist in DB)
        delete data.zoneId;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) data.updatedBy = user.id;
        } catch (e) {}
        await seat.update(data);

        const seatPlain = (seat as any).get
            ? (seat as any).get({ plain: true })
            : seat;
        const ids = Array.from(
            new Set(
                [seatPlain.createdBy, seatPlain.updatedBy]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const userMap: Record<string, any> = {};
        if (ids.length) {
            const users = await User.find({ _id: { $in: ids } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const resp = Object.assign({}, seatPlain, {
            status: normalizeSeatStatus(seatPlain.status),
            createdBy: seatPlain.createdBy,
            createdByName: seatPlain.createdBy
                ? userMap[String(seatPlain.createdBy)]?.username ||
                  userMap[String(seatPlain.createdBy)]?.name
                : undefined,
            updatedBy: seatPlain.updatedBy,
            updatedByName: seatPlain.updatedBy
                ? userMap[String(seatPlain.updatedBy)]?.username ||
                  userMap[String(seatPlain.updatedBy)]?.name
                : undefined,
        });

        ctx.body = { success: true, data: resp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        // Handle common Sequelize validation/unique constraint errors to return clearer messages
        if (error?.name === 'SequelizeUniqueConstraintError') {
            throw new CustomError(
                'Validation error: unique constraint',
                ErrorCodes.INVALID_PARAMS
            );
        }
        if (error?.name === 'SequelizeValidationError') {
            const details = (error.errors || [])
                .map((e: any) => e.message)
                .join('; ');
            throw new CustomError(
                `Validation error${details ? ': ' + details : ''}`,
                ErrorCodes.INVALID_PARAMS
            );
        }
        throw new CustomError(
            error.message || 'Failed to update seat',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/seat/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const seatId = ctx.params.id;
        const seat = await Seat.findByPk(seatId);
        if (!seat)
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);
        await seat.destroy();
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete seat',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Floors compatibility (/api/floors) ----
router.get('/floors', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const floors = (await Floor.findAll()).sort((a, b) =>
            compareFloorName(a.name, b.name)
        );

        // fetch audit user names for floors
        const userIds = Array.from(
            new Set(
                floors
                    .flatMap((f: any) => [
                        (f as any).createdBy,
                        (f as any).updatedBy,
                    ])
                    .filter(Boolean)
            )
        );
        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } }).select(
                'name username'
            );
            users.forEach((u: any) => {
                userMap[u._id.toString()] = u;
            });
        }

        const mapped = floors.map((floor: any) => ({
            id: floor.id,
            name: floor.name,
            description: floor.description,
            totalSeats: floor.totalSeats,
            createdBy: (floor as any).createdBy,
            createdByName:
                userMap[(floor as any).createdBy]?.username ||
                userMap[(floor as any).createdBy]?.name,
            updatedBy: (floor as any).updatedBy,
            updatedByName:
                userMap[(floor as any).updatedBy]?.username ||
                userMap[(floor as any).updatedBy]?.name,
        }));

        ctx.body = {
            success: true,
            data: { list: mapped, total: mapped.length },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get floors',
            ErrorCodes.FLOOR_NOT_FOUND
        );
    }
});

router.post('/floors', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) {
                data.createdBy = user.id;
                data.updatedBy = user.id;
            }
        } catch (e) {}
        const floor = await Floor.create(data);

        const floorPlain = (floor as any).get
            ? (floor as any).get({ plain: true })
            : floor;
        const floorUserIds = Array.from(
            new Set(
                [floorPlain.createdBy, floorPlain.updatedBy]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const floorUserMap: Record<string, any> = {};
        if (floorUserIds.length) {
            const users = await User.find({ _id: { $in: floorUserIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (floorUserMap[String(u._id)] = u));
        }

        const floorResp = Object.assign({}, floorPlain, {
            createdBy: floorPlain.createdBy,
            createdByName: floorPlain.createdBy
                ? floorUserMap[String(floorPlain.createdBy)]?.username ||
                  floorUserMap[String(floorPlain.createdBy)]?.name
                : undefined,
            updatedBy: floorPlain.updatedBy,
            updatedByName: floorPlain.updatedBy
                ? floorUserMap[String(floorPlain.updatedBy)]?.username ||
                  floorUserMap[String(floorPlain.updatedBy)]?.name
                : undefined,
        });

        ctx.body = { success: true, data: floorResp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create floor',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/floors/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const data = ctx.request.body as any;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) data.updatedBy = user.id;
        } catch (e) {}
        const floor = await Floor.findByPk(id);
        if (!floor)
            throw new CustomError(
                'Floor not found',
                ErrorCodes.FLOOR_NOT_FOUND
            );
        await floor.update(data);

        const floorPlain = (floor as any).get
            ? (floor as any).get({ plain: true })
            : floor;
        const ids = Array.from(
            new Set(
                [floorPlain.createdBy, floorPlain.updatedBy]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const userMap: Record<string, any> = {};
        if (ids.length) {
            const users = await User.find({ _id: { $in: ids } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const resp = Object.assign({}, floorPlain, {
            createdBy: floorPlain.createdBy,
            createdByName: floorPlain.createdBy
                ? userMap[String(floorPlain.createdBy)]?.username ||
                  userMap[String(floorPlain.createdBy)]?.name
                : undefined,
            updatedBy: floorPlain.updatedBy,
            updatedByName: floorPlain.updatedBy
                ? userMap[String(floorPlain.updatedBy)]?.username ||
                  userMap[String(floorPlain.updatedBy)]?.name
                : undefined,
        });

        ctx.body = { success: true, data: resp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update floor',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/floors/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const floor = await Floor.findByPk(id);
        if (!floor)
            throw new CustomError(
                'Floor not found',
                ErrorCodes.FLOOR_NOT_FOUND
            );
        await floor.destroy();
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete floor',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Activity compatibility (/api/activity/list) ----
router.get('/activity/list', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const {
            page = 1,
            limit = 20,
            q,
            title,
            floorId,
            status,
            startTime,
        } = ctx.query as any;

        // Try populate first (for documents that reference User properly)
        let activities = await Activity.find()
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();

        const filterTitle = String(title || q || '').trim();
        if (filterTitle) {
            const lowerTitle = filterTitle.toLowerCase();
            activities = (activities || []).filter((a: any) => {
                const searchValues = [a.title, a.description, a.location]
                    .filter(Boolean)
                    .map((val: any) => String(val).toLowerCase());
                return searchValues.some((value: string) =>
                    value.includes(lowerTitle)
                );
            });
        }

        if (typeof floorId !== 'undefined' && floorId !== '') {
            activities = (activities || []).filter(
                (a: any) => String(a.floorId) === String(floorId)
            );
        }

        if (typeof status !== 'undefined' && status !== '') {
            const statusValue = Number(status);
            if (!Number.isNaN(statusValue)) {
                activities = (activities || []).filter(
                    (a: any) => Number(a.status) === statusValue
                );
            }
        }

        if (typeof startTime !== 'undefined' && startTime !== '') {
            const parseRange = (value: any) => {
                if (!value) return null;
                if (Array.isArray(value) && value.length >= 2)
                    return [value[0], value[1]];
                if (typeof value === 'string') {
                    if (value.includes('~'))
                        return value.split('~').map((s) => s.trim());
                    if (value.includes(','))
                        return value.split(',').map((s) => s.trim());
                    return [value.trim(), value.trim()];
                }
                return null;
            };
            const range = parseRange(startTime);
            if (range && range[0] && range[1]) {
                activities = (activities || []).filter((a: any) => {
                    const start = a.startTime
                        ? String(a.startTime).slice(0, 10)
                        : '';
                    return start >= range[0] && start <= range[1];
                });
            } else if (Array.isArray(startTime) && startTime.length === 1) {
                const single = String(startTime[0]).slice(0, 10);
                activities = (activities || []).filter(
                    (a: any) => String(a.startTime).slice(0, 10) === single
                );
            } else if (typeof startTime === 'string') {
                const single = String(startTime).slice(0, 10);
                activities = (activities || []).filter(
                    (a: any) => String(a.startTime).slice(0, 10) === single
                );
            }
        }

        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const total = (activities || []).length;
        const pagedActivities = (activities || []).slice(
            (pageNum - 1) * pageLimit,
            pageNum * pageLimit
        );

        // Collect any audit ids that still lack a display name (could be stored as plain id)
        const missingUserIds = new Set<string>();
        (pagedActivities || []).forEach((a: any) => {
            // createdBy may be populated object or raw id
            if (a.createdBy && !(a.createdBy.name || a.createdBy.username)) {
                try {
                    missingUserIds.add(String(a.createdBy));
                } catch (e) {}
            }
            if (a.updatedBy && !(a.updatedBy.name || a.updatedBy.username)) {
                try {
                    missingUserIds.add(String(a.updatedBy));
                } catch (e) {}
            }
        });

        const userMap: Record<string, any> = {};
        if (missingUserIds.size) {
            const lookup = await User.find({
                _id: { $in: Array.from(missingUserIds) },
            })
                .select('name username')
                .lean();
            lookup.forEach((u: any) => {
                userMap[String(u._id)] = u;
            });
        }

        const mapped = (pagedActivities || []).map((a: any) => ({
            ...a,
            createdByName:
                a.createdBy?.username ||
                a.createdBy?.name ||
                userMap[String(a.createdBy)]?.username ||
                userMap[String(a.createdBy)]?.name ||
                undefined,
            updatedBy: a.updatedBy?._id || a.updatedBy,
            updatedByName:
                a.updatedBy?.username ||
                a.updatedBy?.name ||
                userMap[String(a.updatedBy)]?.username ||
                userMap[String(a.updatedBy)]?.name ||
                undefined,
        }));

        ctx.body = { success: true, data: { list: mapped, total } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get activities',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- User management for admin (/api/user/*) ----
router.get('/user/list', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const {
            page = 1,
            limit = 20,
            q,
            blacklisted,
            role,
            creditScore,
            minCreditScore,
            maxCreditScore,
        } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const filter: any = {};
        if (q) {
            filter.$or = [
                { username: { $regex: q, $options: 'i' } },
                { name: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ];
        }

        if (typeof blacklisted !== 'undefined') {
            const isBlacklisted = Number(blacklisted) === 1;
            filter.blacklisted = isBlacklisted;
        }

        if (typeof role !== 'undefined' && role !== null && role !== '') {
            const parsedRole = Number(role);
            if (!Number.isNaN(parsedRole)) {
                filter.role = parsedRole;
            } else if (typeof role === 'string') {
                const lower = role.toLowerCase();
                if (lower === 'admin') filter.role = Roles.ADMIN;
                else if (lower === 'user') filter.role = Roles.USER;
            }
        }

        if (
            typeof creditScore !== 'undefined' &&
            creditScore !== null &&
            creditScore !== ''
        ) {
            const parsedScore = Number(creditScore);
            if (!Number.isNaN(parsedScore)) {
                filter.creditScore = parsedScore;
            }
        }

        if (
            (typeof minCreditScore !== 'undefined' &&
                minCreditScore !== null &&
                minCreditScore !== '') ||
            (typeof maxCreditScore !== 'undefined' &&
                maxCreditScore !== null &&
                maxCreditScore !== '')
        ) {
            filter.creditScore = filter.creditScore || {};
            if (
                typeof minCreditScore !== 'undefined' &&
                minCreditScore !== null &&
                minCreditScore !== ''
            ) {
                const minScore = Number(minCreditScore);
                if (!Number.isNaN(minScore)) {
                    filter.creditScore.$gte = minScore;
                }
            }
            if (
                typeof maxCreditScore !== 'undefined' &&
                maxCreditScore !== null &&
                maxCreditScore !== ''
            ) {
                const maxScore = Number(maxCreditScore);
                if (!Number.isNaN(maxScore)) {
                    filter.creditScore.$lte = maxScore;
                }
            }
        }

        const total = await User.countDocuments(filter);
        let list = await User.find(filter)
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

        const normalizeRoleValue = (r: any) => {
            if (typeof r === 'number') return r;
            return Roles.USER;
        };

        list = (list || []).map((u: any) => ({
            ...u,
            role: normalizeRoleValue(u.role),
            avatar: normalizeUploadUrl(String(u.avatar || ''), ctx.origin),
        }));

        ctx.body = { success: true, data: { list, total } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get users',
            ErrorCodes.GET_SETTINGS_ERROR
        );
    }
});

router.get('/user/:id', authMiddleware, async (ctx) => {
    try {
        const id = ctx.params.id;
        const user = await User.findById(id).select('-password').lean();
        if (!user)
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        user.avatar = normalizeUploadUrl(String(user.avatar || ''), ctx.origin);
        ctx.body = { success: true, data: user };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Failed to get user', ErrorCodes.INTERNAL_ERROR);
    }
});

router.post('/user', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        if (data.password) {
            // hash password
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const bcrypt = require('bcryptjs');
            data.password = await bcrypt.hash(data.password, 10);
        }
        // basic validation: password required when creating a user
        if (!data.password) {
            throw new CustomError('密码不能为空', ErrorCodes.INVALID_PARAMS);
        }
        if (
            data.role !== undefined &&
            data.role !== null &&
            typeof data.role !== 'number'
        ) {
            delete data.role;
        }
        try {
            if (
                data.avatar &&
                typeof data.avatar === 'string' &&
                data.avatar.startsWith('data:')
            ) {
                data.avatar = await saveBase64Image(
                    data.avatar,
                    ctx.state?.user?.id,
                    ctx.state?.user?.username
                );
                data.avatar = normalizeUploadUrl(
                    String(data.avatar || ''),
                    ctx.origin
                );
            }
            const user = new User(data);
            await user.save();
            user.avatar = normalizeUploadUrl(
                String(user.avatar || ''),
                ctx.origin
            );
            ctx.body = { success: true, data: user };
        } catch (err: any) {
            // handle duplicate key errors (unique indexes)
            if (err?.code === 11000) {
                throw new CustomError(
                    '用户名或唯一字段已存在',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            throw err;
        }
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create user',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/user/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const data = ctx.request.body as any;
        if (data.password) {
            const bcrypt = require('bcryptjs');
            data.password = await bcrypt.hash(data.password, 10);
        }
        if (
            data.role !== undefined &&
            data.role !== null &&
            typeof data.role !== 'number'
        ) {
            delete data.role;
        }
        if (
            data.avatar &&
            typeof data.avatar === 'string' &&
            data.avatar.startsWith('data:')
        ) {
            data.avatar = await saveBase64Image(
                data.avatar,
                ctx.state?.user?.id,
                ctx.state?.user?.username
            );
        }
        const user = await User.findByIdAndUpdate(id, data, {
            new: true,
        })
            .select('-password')
            .lean();
        if (!user)
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        user.avatar = normalizeUploadUrl(String(user.avatar || ''), ctx.origin);
        ctx.body = { success: true, data: user };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update user',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/user/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        await User.findByIdAndDelete(id);
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete user',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/user/status/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const { status, reason } = ctx.request.body as any;
        const update: any = {};
        const isBlacklisted = Number(status) === 1;
        if (isBlacklisted) {
            update.blacklisted = true;
            if (reason) update.blacklistReason = reason;
        } else {
            update.blacklisted = false;
            update.blacklistReason = undefined;
        }
        const user = await User.findByIdAndUpdate(id, update, {
            new: true,
        }).select('-password');
        if (!user)
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        // 返回简洁的成功结果，客户端无需依赖完整用户对象
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update user status',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/user/batch/status', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { userIds, status } = ctx.request.body as any;
        if (!Array.isArray(userIds))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        const update: any = {};
        const isBlacklisted = Number(status) === 1;
        update.blacklisted = isBlacklisted;
        await User.updateMany({ _id: { $in: userIds } }, { $set: update });
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch update user status',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Zones management (/api/zones) ----
router.get('/zones', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { page = 1, limit = 20, q } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const filter: any = {};
        if (q) filter.name = { $regex: q, $options: 'i' };

        const total = await Zone.countDocuments(filter);
        const list = await Zone.find(filter)
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

        const mapped = (list || []).map((z: any) => ({
            ...z,
            createdBy: z.createdBy?._id || z.createdBy,
            createdByName:
                z.createdBy?.username || z.createdBy?.name || undefined,
            updatedBy: z.updatedBy?._id || z.updatedBy,
            updatedByName:
                z.updatedBy?.username || z.updatedBy?.name || undefined,
        }));

        ctx.body = { success: true, data: { list: mapped, total } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Failed to get zones', ErrorCodes.INTERNAL_ERROR);
    }
});

router.post('/zones', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) {
                data.createdBy = user.id;
                data.updatedBy = user.id;
            }
        } catch (e) {}
        const zone = new Zone(data);
        await zone.save();

        const zoneObj: any = zone.toObject ? zone.toObject() : zone;
        const creatorId = toAuditId(zoneObj.createdBy);
        const updaterId = toAuditId(zoneObj.updatedBy);
        const lookupIds = Array.from(
            new Set([creatorId, updaterId].filter(Boolean))
        );
        const userMap: Record<string, any> = {};
        if (lookupIds.length) {
            const users = await User.find({ _id: { $in: lookupIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => {
                userMap[String(u._id)] = u;
            });
        }

        ctx.body = {
            success: true,
            data: Object.assign(zoneObj, {
                createdBy: creatorId,
                createdByName: creatorId
                    ? getDisplayName(creatorId, userMap)
                    : undefined,
                updatedBy: updaterId,
                updatedByName: updaterId
                    ? getDisplayName(updaterId, userMap)
                    : undefined,
            }),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create zone',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/zones/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const data = ctx.request.body as any;
        try {
            const user = (ctx as any).state.user;
            if (user?.id) data.updatedBy = user.id;
        } catch (e) {}
        const zone: any = await Zone.findByIdAndUpdate(id, data, {
            new: true,
        })
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();
        if (!zone)
            throw new CustomError('Zone not found', ErrorCodes.NOT_FOUND);

        const creatorObj: any = zone.createdBy;
        const updaterObj: any = zone.updatedBy;
        zone.createdBy = creatorObj?._id || creatorObj;
        zone.createdByName =
            creatorObj?.username || creatorObj?.name || undefined;
        zone.updatedBy = updaterObj?._id || updaterObj;
        zone.updatedByName =
            updaterObj?.username || updaterObj?.name || undefined;

        ctx.body = { success: true, data: zone };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update zone',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/zones/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        await Zone.findByIdAndDelete(id);
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete zone',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/zones/batch/status', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { ids, status } = ctx.request.body as any;
        if (!Array.isArray(ids))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        // For compatibility, we'll store status as a numeric field if provided
        await Zone.updateMany({ _id: { $in: ids } }, { $set: { status } });
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch update zones',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Activity Admin CRUD ----
router.post('/activity', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        // Set createdBy from authenticated user
        const user = (ctx as any).state.user;
        if (user?.id) {
            data.createdBy = user.id;
        }
        // also mark updatedBy on creation
        try {
            if (user?.id) data.updatedBy = user.id;
        } catch (e) {}
        const activity = new Activity(data);
        await activity.save();

        // populate createdBy/updatedBy for admin-friendly response
        const saved: any = await Activity.findById(activity._id)
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();

        const mapped = {
            ...saved,
            createdByName:
                saved?.createdBy?.username ||
                saved?.createdBy?.name ||
                undefined,
            updatedBy: saved?.updatedBy?._id || saved?.updatedBy,
            updatedByName:
                saved?.updatedBy?.username ||
                saved?.updatedBy?.name ||
                undefined,
        };

        if (process.env.NODE_ENV !== 'production') {
            try {
                console.debug('[compat-debug] activity created', {
                    adminId: user?.id,
                    createdBy: mapped.createdBy,
                    updatedBy: mapped.updatedBy,
                });
            } catch (e) {}
        }

        ctx.body = { success: true, data: mapped };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('[Activity Create Error]', error.message || error);
        throw new CustomError(
            error.message || 'Failed to create activity',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/activity/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const data = ctx.request.body as any;
        // mark updatedBy
        try {
            const user = (ctx as any).state.user;
            if (user?.id) data.updatedBy = user.id;
        } catch (e) {
            // ignore
        }
        const activity = await Activity.findByIdAndUpdate(id, data, {
            new: true,
            runValidators: true,
        });
        if (!activity)
            throw new CustomError('Activity not found', ErrorCodes.NOT_FOUND);

        // return populated document for admin
        const updated: any = await Activity.findById(activity._id)
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();

        const mapped = {
            ...updated,
            createdByName:
                updated?.createdBy?.username ||
                updated?.createdBy?.name ||
                undefined,
            updatedBy: updated?.updatedBy?._id || updated?.updatedBy,
            updatedByName:
                updated?.updatedBy?.username ||
                updated?.updatedBy?.name ||
                undefined,
        };

        if (process.env.NODE_ENV !== 'production') {
            try {
                const user = (ctx as any).state.user;
                console.debug('[compat-debug] activity updated', {
                    adminId: user?.id,
                    id: activity._id,
                    updatedBy: mapped.updatedBy,
                });
            } catch (e) {}
        }

        ctx.body = { success: true, data: mapped };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update activity',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/activity/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        await Activity.findByIdAndDelete(id);
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete activity',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Notification Admin ----
router.post('/notification', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        // Do not allow client to specify recipient/publisher fields.
        // Use authenticated admin as publisher and default recipient.
        try {
            const user = (ctx as any).state.user;
            data.userId = user.id;
            data.createdBy = user.id;
            data.updatedBy = user.id;
        } catch (e) {}
        const notification = new Notification(data);
        await notification.save();

        const notifObj: any = notification.toObject
            ? notification.toObject()
            : notification;
        const publisherId = notifObj.createdBy?._id || notifObj.createdBy;
        const updatedById = notifObj.updatedBy?._id || notifObj.updatedBy;
        const lookup = Array.from(
            new Set([publisherId, updatedById].filter(Boolean).map(String))
        );
        const userMap: Record<string, any> = {};
        if (lookup.length) {
            const users = await User.find({ _id: { $in: lookup } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const resp = {
            id: notifObj._id,
            userId: notifObj.userId,
            type: notifObj.type,
            title: notifObj.title,
            content: notifObj.content,
            relatedId: notifObj.relatedId,
            time: notifObj.time,
            createdBy: publisherId,
            publisherName: publisherId
                ? userMap[String(publisherId)]?.username ||
                  userMap[String(publisherId)]?.name
                : undefined,
            updatedBy: updatedById,
            updatedByName: updatedById
                ? userMap[String(updatedById)]?.username ||
                  userMap[String(updatedById)]?.name
                : undefined,
        };

        ctx.body = { success: true, data: resp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('[Notification Create Error]', error.message || error);
        throw new CustomError(
            error.message || 'Failed to create notification',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.post('/notification/batch-read', authMiddleware, async (ctx) => {
    try {
        const { ids } = ctx.request.body as any;
        if (!Array.isArray(ids))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        await Notification.updateMany(
            { _id: { $in: ids } },
            { $set: { isRead: true } }
        );
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch mark read',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Booking Admin Create + Batch ----
router.post('/bookings', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;

        // Resolve userName to userId
        let userId = data.userId;
        if (!userId && data.userName) {
            const targetUser = await User.findOne({ username: data.userName });
            if (!targetUser)
                throw new CustomError(
                    '找不到该用户',
                    ErrorCodes.INVALID_PARAMS
                );
            userId = targetUser._id.toString();
        }
        if (!userId)
            throw new CustomError('用户不能为空', ErrorCodes.INVALID_PARAMS);

        // Resolve seatId
        let seatId = data.seatId;
        if (!seatId && data.seatName) {
            seatId = parseInt(data.seatName, 10);
        }
        if (!seatId)
            throw new CustomError('座位不能为空', ErrorCodes.INVALID_PARAMS);

        // Validate seat exists to avoid FK errors
        const seat = await Seat.findByPk(seatId);
        if (!seat)
            throw new CustomError('Seat not found', ErrorCodes.SEAT_NOT_FOUND);

        // Format date
        let date = data.date;
        if (date && typeof date === 'object') {
            date = new Date(date).toISOString().split('T')[0];
        } else if (date && typeof date === 'string' && date.includes('T')) {
            date = date.split('T')[0];
        }

        // timeSlot: accept string or number
        let timeSlot = data.timeSlot;
        if (typeof timeSlot === 'string') {
            const tsMap: Record<string, number> = {
                '0': 0,
                '1': 1,
                '2': 2,
                morning: 0,
                afternoon: 1,
                evening: 2,
            };
            timeSlot = tsMap[timeSlot.toLowerCase()] ?? parseInt(timeSlot, 10);
        }

        const currentAdminId = (ctx as any).state.user.id;
        const booking = await Booking.create({
            userId,
            seatId,
            date,
            timeSlot,
            startTime: data.startTime,
            endTime: data.endTime,
            status: BookingStatus.UPCOMING,
            createdBy: currentAdminId,
            updatedBy: currentAdminId,
        });

        const existingStatus = await TimeSlotStatus.findOne({
            where: {
                seatId,
                date,
                timeSlot,
            },
        });
        if (existingStatus) {
            await existingStatus.update({
                status: TimeSlotStatusValue.BOOKED,
                bookingId: booking.id,
            });
        } else {
            await TimeSlotStatus.create({
                seatId,
                date,
                timeSlot,
                status: TimeSlotStatusValue.BOOKED,
                bookingId: booking.id,
            });
        }

        // Resolve display names for createdBy/updatedBy/userId
        const bCreatedBy = booking.createdBy
            ? String(booking.createdBy)
            : undefined;
        const bUpdatedBy = booking.updatedBy
            ? String(booking.updatedBy)
            : undefined;
        const lookupIds = Array.from(
            new Set(
                [booking.userId, bCreatedBy, bUpdatedBy]
                    .filter(Boolean)
                    .map(String)
            )
        );
        const users = lookupIds.length
            ? await User.find({ _id: { $in: lookupIds } })
                  .select('name username')
                  .lean()
            : [];
        const userMap: Record<string, any> = {};
        users.forEach((u: any) => (userMap[String(u._id)] = u));

        const resp = {
            id: booking.id,
            userId: booking.userId,
            seatId: booking.seatId,
            date: booking.date,
            timeSlot: booking.timeSlot,
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status,
            createdBy: bCreatedBy,
            createdByName: bCreatedBy
                ? userMap[bCreatedBy]?.username || userMap[bCreatedBy]?.name
                : undefined,
            updatedBy: bUpdatedBy,
            updatedByName: bUpdatedBy
                ? userMap[bUpdatedBy]?.username || userMap[bUpdatedBy]?.name
                : undefined,
        };

        ctx.body = { success: true, data: resp };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('[Booking Create Error]', error.message || error);
        throw new CustomError(
            error.message || 'Failed to create booking',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/bookings/batch/cancel', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { bookingIds } = ctx.request.body as any;
        if (!Array.isArray(bookingIds))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        await Booking.update(
            { status: BookingStatus.CANCELED },
            { where: { id: bookingIds } }
        );
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch cancel bookings',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Seat Batch ----
router.post('/seat/batch', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const currentUserId = (ctx as any).state.user?.id;
        // Accept either `[{...}, {...}]` or `{ seats: [...] }` from frontend.
        const body = ctx.request.body as any;
        let seatsArr: any[] = [];
        if (Array.isArray(body)) seatsArr = body;
        else if (Array.isArray(body?.seats)) seatsArr = body.seats;
        else throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);

        // Normalize each seat item: frontend may send a minimal shape { floorId, rowNum, colNum }
        const normalized = seatsArr.map((s: any, idx: number) => {
            const floorId = Number(s.floorId);
            const rowNum = Number(s.rowNum);
            const colNum = Number(s.colNum);
            if (
                Number.isNaN(floorId) ||
                Number.isNaN(rowNum) ||
                Number.isNaN(colNum)
            )
                throw new CustomError(
                    `Invalid seat at index ${idx}`,
                    ErrorCodes.INVALID_PARAMS
                );

            return {
                floorId,
                rowNum,
                colNum,
                // allow frontend to override these, otherwise use sensible defaults
                type: s.type !== undefined ? s.type : 0,
                hasSocket:
                    s.hasSocket === true ||
                    s.hasSocket === 1 ||
                    s.hasSocket === '1' ||
                    false,
                isWindow:
                    s.isWindow === true ||
                    s.isWindow === 1 ||
                    s.isWindow === '1' ||
                    false,
                status: s.status !== undefined ? s.status : 0,
                zone: s.zone || s.zoneName || undefined,
                description: s.description || undefined,
                createdBy: currentUserId || undefined,
                updatedBy: currentUserId || undefined,
            } as any;
        });

        // Ignore duplicate key errors (existing seats) so a partial/duplicate
        // batch won't fail the whole operation. MySQL/Sequelize supports
        // `ignoreDuplicates` to skip rows violating unique constraints.
        // Build a list of unique seat keys to query existing rows.
        const keys = normalized.map((s: any) => ({
            floorId: s.floorId,
            rowNum: s.rowNum,
            colNum: s.colNum,
        }));

        // Query existing seats that match any of the requested keys.
        const whereOr = keys.map((k: any) => ({
            floorId: k.floorId,
            rowNum: k.rowNum,
            colNum: k.colNum,
        }));

        const existing = whereOr.length
            ? await Seat.findAll({ where: { [Op.or]: whereOr }, raw: true })
            : [];

        const existingMap = new Map<string, any>();
        existing.forEach((r: any) => {
            const key = `${r.floorId}:${r.rowNum}:${r.colNum}`;
            existingMap.set(key, r);
        });

        // Only insert seats that don't already exist.
        const toCreate = normalized.filter((s: any) => {
            const key = `${s.floorId}:${s.rowNum}:${s.colNum}`;
            return !existingMap.has(key);
        });

        if (toCreate.length) {
            await Seat.bulkCreate(toCreate, { ignoreDuplicates: true });
        }

        // Re-query to get authoritative rows (including IDs) for all keys.
        const allRows = whereOr.length
            ? await Seat.findAll({ where: { [Op.or]: whereOr }, raw: true })
            : [];

        const allMap = new Map<string, any>();
        allRows.forEach((r: any) => {
            const key = `${r.floorId}:${r.rowNum}:${r.colNum}`;
            const plain =
                typeof r.get === 'function' ? r.get({ plain: true }) : r;
            allMap.set(key, plain);
        });

        // Return results in the same order as input, mapping to DB rows when available.
        const toBool = (v: any) =>
            v === true || v === 1 || v === '1' || v === 'true';

        const mapRow = (r: any) => {
            const id = r.id ?? r.ID ?? null;
            const floorId = r.floorId ?? r.floor_id ?? null;
            const rowNum = r.rowNum ?? r.row_num ?? null;
            const colNum = r.colNum ?? r.col_num ?? null;
            const status =
                typeof r.status !== 'undefined' ? Number(r.status) : null;
            const type = typeof r.type !== 'undefined' ? Number(r.type) : null;
            const hasSocket = toBool(
                r.hasSocket ?? r.has_socket ?? r.has_socket
            );
            const isWindow = toBool(r.isWindow ?? r.is_window ?? r.is_window);
            const zone = r.zone ?? null;
            const description = r.description ?? null;
            const createdBy = r.createdBy ?? r.created_by ?? null;
            const updatedBy = r.updatedBy ?? r.updated_by ?? null;
            const createdAt = r.createdAt ?? r.created_at ?? null;
            const updatedAt = r.updatedAt ?? r.updated_at ?? null;

            return {
                id,
                floorId,
                rowNum,
                colNum,
                status,
                type,
                hasSocket,
                isWindow,
                zone,
                description,
                createdBy,
                updatedBy,
                createdAt,
                updatedAt,
            };
        };

        const auditUserIds = Array.from(
            new Set(
                allRows
                    .flatMap((r: any) => [
                        r.createdBy ?? r.created_by,
                        r.updatedBy ?? r.updated_by,
                    ])
                    .filter(Boolean)
                    .map(String)
            )
        );
        const auditUserMap: Record<string, any> = {};
        if (auditUserIds.length) {
            const users = await User.find({ _id: { $in: auditUserIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => {
                auditUserMap[String(u._id)] = u;
            });
        }

        const result = normalized.map((s: any) => {
            const key = `${s.floorId}:${s.rowNum}:${s.colNum}`;
            const row = allMap.get(key);
            if (row) {
                const mapped = mapRow(row);
                return {
                    ...mapped,
                    createdByName: mapped.createdBy
                        ? getDisplayName(mapped.createdBy, auditUserMap)
                        : undefined,
                    updatedByName: mapped.updatedBy
                        ? getDisplayName(mapped.updatedBy, auditUserMap)
                        : undefined,
                };
            }
            // Shouldn't happen, but fallback to the original object.
            return Object.assign({}, s, { id: null });
        });

        ctx.body = { success: true, data: result };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch create seats',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/seat/batch', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { ids, seatIds, status } = ctx.request.body as any;
        const targetIds = Array.isArray(ids) ? ids : seatIds;
        if (!Array.isArray(targetIds))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        await Seat.update(
            { status, updatedBy: (ctx as any).state.user?.id },
            { where: { id: targetIds } }
        );
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to batch update seats',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Credit Admin ----
router.post('/credit/add', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { userId, points, reason } = ctx.request.body as any;
        const user = await User.findById(userId);
        if (!user)
            throw new CustomError('User not found', ErrorCodes.NOT_FOUND);
        user.creditScore = (user.creditScore || 100) + Number(points);
        await user.save();
        const currentUserId = (ctx as any).state.user.id;
        await CreditRecord.create({
            userId,
            type: 0,
            points: Number(points),
            reason: reason || '管理员加分',
            updatedBy: currentUserId,
        });
        ctx.body = { success: true, data: { creditScore: user.creditScore } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to add credit',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.post('/credit/deduct', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { userId, points, reason } = ctx.request.body as any;
        const user = await User.findById(userId);
        if (!user)
            throw new CustomError('User not found', ErrorCodes.NOT_FOUND);
        user.creditScore = Math.max(
            0,
            (user.creditScore || 100) - Number(points)
        );
        await user.save();
        const currentUserId = (ctx as any).state.user.id;
        await CreditRecord.create({
            userId,
            type: 1,
            points: Number(points),
            reason: reason || '管理员扣分',
            updatedBy: currentUserId,
        });
        ctx.body = { success: true, data: { creditScore: user.creditScore } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to deduct credit',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.get('/credit/score/:userId', authMiddleware, async (ctx) => {
    try {
        const user = await User.findById(ctx.params.userId);
        if (!user)
            throw new CustomError('User not found', ErrorCodes.NOT_FOUND);
        ctx.body = {
            success: true,
            data: { creditScore: user.creditScore || 100 },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get credit score',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.get('/credit/blacklist', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { page = 1, limit = 20 } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const users = await User.find({ blacklisted: true })
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit);
        const total = await User.countDocuments({ blacklisted: true });
        ctx.body = { success: true, data: { list: users, total } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get blacklist',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard statistics ----
router.get('/dashboard/stats', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const totalSeats = await Seat.count();
        const maintenanceSeats = await Seat.count({ where: { status: 1 } });
        const availableSeats = totalSeats - maintenanceSeats;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const { Op } = require('sequelize');

        const todayBookings = await Booking.count({
            where: {
                date: { [Op.between]: [today, tomorrow] },
                status: {
                    [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
                },
            },
        });

        const totalUsers = await User.countDocuments();
        const totalBookings = await Booking.count();
        const totalActivities = await Activity.countDocuments();
        const blacklistedUsers = await User.countDocuments({
            blacklisted: true,
        });
        const violationCount = await Booking.count({
            where: { status: BookingStatus.VIOLATED },
        });

        ctx.body = {
            success: true,
            data: {
                totalSeats,
                availableSeats,
                maintenanceSeats,
                todayBookings,
                totalUsers,
                totalBookings,
                totalActivities,
                blacklistedUsers,
                violationCount,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get dashboard stats',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// Alias: admin calls GET /api/dashboard
router.get('/dashboard', authMiddleware, async (ctx) => {
    // Reuse stats logic
    try {
        requireAdmin(ctx);
        const totalSeats = await Seat.count();
        const maintenanceSeats = await Seat.count({ where: { status: 1 } });
        const availableSeats = totalSeats - maintenanceSeats;
        const { Op } = require('sequelize');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayBookings = await Booking.count({
            where: {
                date: { [Op.between]: [today, tomorrow] },
                status: {
                    [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
                },
            },
        });

        const totalUsers = await User.countDocuments();
        const totalBookings = await Booking.count();
        const totalActivities = await Activity.countDocuments();
        const blacklistedUsers = await User.countDocuments({
            blacklisted: true,
        });
        const violationCount = await Booking.count({
            where: { status: BookingStatus.VIOLATED },
        });

        ctx.body = {
            success: true,
            data: {
                totalSeats,
                availableSeats,
                maintenanceSeats,
                todayBookings,
                totalUsers,
                totalBookings,
                totalActivities,
                blacklistedUsers,
                violationCount,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get dashboard',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Statistics ----
router.get('/statistics', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { Op } = require('sequelize');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 7-day trend
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const next = new Date(d);
            next.setDate(next.getDate() + 1);
            const count = await Booking.count({
                where: { date: { [Op.between]: [d, next] } },
            });
            trendData.push({
                date: d.toISOString().split('T')[0],
                bookings: count,
            });
        }

        const totalBookings = await Booking.count();
        const completedBookings = await Booking.count({
            where: { status: BookingStatus.COMPLETED },
        });
        const canceledBookings = await Booking.count({
            where: { status: BookingStatus.CANCELED },
        });
        const violatedBookings = await Booking.count({
            where: { status: BookingStatus.VIOLATED },
        });

        ctx.body = {
            success: true,
            data: {
                trend: trendData,
                totalBookings,
                completedBookings,
                canceledBookings,
                violatedBookings,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get statistics',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Credit Records ----
router.get('/user/credit/records', authMiddleware, async (ctx) => {
    try {
        const {
            page = 1,
            limit = 20,
            userId,
            q,
            type,
            reason,
        } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const query: any = {};
        if (userId) query.userId = userId;
        if (type !== undefined && type !== null && type !== '') {
            query.type = Number(type);
        }
        if (reason) {
            query.reason = { $regex: reason, $options: 'i' };
        }

        let userSearchIds: string[] | undefined;
        if (q) {
            const matchingUsers = await User.find({
                $or: [
                    { username: { $regex: q, $options: 'i' } },
                    { name: { $regex: q, $options: 'i' } },
                ],
            })
                .select('_id')
                .lean();
            userSearchIds = matchingUsers.map((u: any) => String(u._id));
            if (userSearchIds.length) {
                query.$or = [
                    { userId: { $in: userSearchIds } },
                    { updatedBy: { $in: userSearchIds } },
                ];
            } else {
                query.userId = '__not_found__';
            }
        }

        // Use lean fetch + manual lookup for compatibility
        const records = await CreditRecord.find(query)
            .sort({ date: -1 })
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

        const total = await CreditRecord.countDocuments(query);

        const userIds = Array.from(
            new Set(
                (records || [])
                    .flatMap((r: any) => [r.userId, r.updatedBy])
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

        const list = (records || []).map((r: any) => ({
            id: r._id,
            userId: r.userId?._id || r.userId,
            userName:
                r.userId?.name ||
                r.userId?.username ||
                userMap[String(r.userId)]?.name ||
                userMap[String(r.userId)]?.username ||
                '',
            userAvatar:
                (r.userId && userMap[String(r.userId)]?.avatar) ||
                r.userId?.avatar ||
                '' ||
                '',
            type: r.type,
            points: r.points,
            date: r.date || r.createdAt,
            reason: r.reason,
            updatedBy: r.updatedBy?._id || r.updatedBy,
            updatedByName:
                r.updatedBy?.name ||
                r.updatedBy?.username ||
                userMap[String(r.updatedBy)]?.name ||
                userMap[String(r.updatedBy)]?.username ||
                '',
        }));

        ctx.body = {
            success: true,
            data: { list, total, page: pageNum, limit: pageLimit },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get credit records',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Violation (based on VIOLATED bookings) ----
router.get('/violation/list', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const {
            page = 1,
            limit = 20,
            userName,
            studentId,
            type,
            date,
            q,
        } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const where: any = { status: BookingStatus.VIOLATED };

        if (typeof type !== 'undefined' && type !== '') {
            const parsedType = Number(type);
            if (!Number.isNaN(parsedType)) {
                where.type = parsedType;
            } else {
                where.type = type;
            }
        }

        if (typeof date !== 'undefined' && date !== '') {
            const toDate = (value: any) => {
                if (!value) return undefined;
                if (Array.isArray(value) && value.length > 0) return value[0];
                if (typeof value === 'string') return value;
                return String(value);
            };
            const parsedDate = toDate(date);
            if (parsedDate) {
                where.date = parsedDate;
            }
        }

        let userFilters: any = {};
        const keyword = String(q || '').trim();
        if (userName) {
            userFilters.username = { $regex: String(userName), $options: 'i' };
        }
        if (studentId) {
            userFilters.studentId = {
                $regex: String(studentId),
                $options: 'i',
            };
        }
        if (keyword) {
            userFilters.$or = [
                { username: { $regex: keyword, $options: 'i' } },
                { name: { $regex: keyword, $options: 'i' } },
                { studentId: { $regex: keyword, $options: 'i' } },
            ];
        }

        if (Object.keys(userFilters).length) {
            const matchedUsers = await User.find(userFilters)
                .select('_id')
                .lean();
            const matchedIds = matchedUsers.map((u: any) => String(u._id));
            if (matchedIds.length === 0) {
                ctx.body = {
                    success: true,
                    data: {
                        list: [],
                        total: 0,
                        page: pageNum,
                        limit: pageLimit,
                    },
                };
                return;
            }
            where.userId = { [Op.in]: matchedIds };
        }

        const { count, rows } = await Booking.findAndCountAll({
            where,
            order: [['updated_at', 'DESC']],
            offset: (pageNum - 1) * pageLimit,
            limit: pageLimit,
            include: [{ model: Seat, as: 'seat' }],
        });

        // Enrich with user info from MongoDB
        const list = await Promise.all(
            rows.map(async (b: any) => {
                const user = await User.findById(b.userId).select(
                    'name avatar username'
                );
                return {
                    id: b.id,
                    bookingId: b.id,
                    userId: b.userId,
                    userName: user?.username || user?.name || 'Unknown',
                    userAvatar: user?.avatar || '',
                    seatId: b.seatId,
                    seatInfo: b.seat
                        ? `R${b.seat.rowNum}C${b.seat.colNum}`
                        : '',
                    floorId: b.seat?.floorId,
                    date: b.date,
                    timeSlot: b.timeSlot,
                    status: 'violated',
                    createdAt: b.created_at,
                    updatedAt: b.updated_at,
                };
            })
        );

        ctx.body = {
            success: true,
            data: { list, total: count, page: pageNum, limit: pageLimit },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;

        throw new CustomError(
            'Failed to get violation list',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.delete('/violation/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const bookingId = parseInt(ctx.params.id);
        // Clearing a violation = changing status back to COMPLETED
        await Booking.update(
            { status: BookingStatus.COMPLETED },
            { where: { id: bookingId, status: BookingStatus.VIOLATED } }
        );
        ctx.body = { success: true, message: 'Violation cleared' };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete violation',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard: Floor seat statistics ----
router.get('/dashboard/floors', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const floors = (await Floor.findAll()).sort((a, b) =>
            compareFloorName(a.name, b.name)
        );
        const { Op } = require('sequelize');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const floorData = await Promise.all(
            floors.map(async (floor: any) => {
                const totalSeats = await Seat.count({
                    where: { floorId: floor.id },
                });
                const maintenanceSeats = await Seat.count({
                    where: { floorId: floor.id, status: 1 },
                });
                const availableSeats = totalSeats - maintenanceSeats;
                // Today's bookings on this floor
                const todayBooked = await Booking.count({
                    where: {
                        date: { [Op.between]: [today, tomorrow] },
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
                const usageRate =
                    totalSeats > 0
                        ? Math.round((todayBooked / totalSeats) * 100)
                        : 0;
                return {
                    key: floor.id.toString(),
                    floor: floor.name,
                    totalSeats,
                    availableSeats,
                    occupiedSeats: todayBooked,
                    usageRate,
                };
            })
        );
        ctx.body = { success: true, data: floorData };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get floor stats',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard: Recent bookings ----
router.get('/dashboard/recent-bookings', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const bookings = await Booking.findAll({
            order: [['created_at', 'DESC']],
            limit: 5,
            include: [
                {
                    model: Seat,
                    as: 'seat',
                    include: [
                        {
                            model: require('../models/mysql/Floor').default,
                            as: 'floor',
                        },
                    ],
                },
            ],
        });
        const statusMap: Record<number, string> = {
            0: '未开始',
            1: '进行中',
            2: '已完成',
            3: '已取消',
            4: '违约',
        };
        const statusTypeMap: Record<number, string> = {
            0: 'default',
            1: 'processing',
            2: 'success',
            3: 'default',
            4: 'error',
        };
        const list = await Promise.all(
            bookings.map(async (b: any) => {
                const user = await User.findById(b.userId).select(
                    'name username'
                );
                return {
                    key: b.id.toString(),
                    user: user?.username || user?.name || '未知用户',
                    seat: b.seat
                        ? `${b.seat.floor?.name || ''}  R${b.seat.rowNum}C${
                              b.seat.colNum
                          }`
                        : `座位#${b.seatId}`,
                    date: b.date?.toISOString?.().split('T')[0] || '',
                    status: statusMap[b.status] || '未知',
                    statusType: statusTypeMap[b.status] || 'default',
                };
            })
        );
        ctx.body = { success: true, data: list };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get recent bookings',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard: Active users ----
router.get('/dashboard/active-users', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { fn, col, literal } = require('sequelize');
        const results: any[] = await Booking.findAll({
            attributes: ['userId', [fn('COUNT', col('id')), 'bookingCount']],
            group: ['userId'],
            order: [[literal('bookingCount'), 'DESC']],
            limit: 5,
            raw: true,
        });
        const list = await Promise.all(
            results.map(async (r: any) => {
                const user = await User.findById(r.userId).select(
                    'name username avatar'
                );
                // Find last booking date
                const lastBooking = await Booking.findOne({
                    where: { userId: r.userId },
                    order: [['created_at', 'DESC']],
                    attributes: ['created_at'],
                    raw: true,
                });
                const lastActive = lastBooking
                    ? new Date((lastBooking as any).created_at).toLocaleString(
                          'zh-CN'
                      )
                    : '-';
                return {
                    key: r.userId,
                    name: user?.username || user?.name || '未知',
                    username: user?.username || '',
                    bookings: parseInt(r.bookingCount || '0'),
                    lastActive,
                    avatar:
                        user?.avatar ||
                        `https://api.dicebear.com/7.x/miniavs/svg?seed=${r.userId}`,
                };
            })
        );
        ctx.body = { success: true, data: list };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get active users',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard: Hot areas (floors with most bookings today) ----
router.get('/dashboard/hot-areas', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { Op } = require('sequelize');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const floors = await Floor.findAll();
        const areasData = await Promise.all(
            floors.map(async (floor: any) => {
                const totalSeats = await Seat.count({
                    where: { floorId: floor.id },
                });
                const todayBookings = await Booking.count({
                    where: {
                        date: { [Op.between]: [today, tomorrow] },
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
                const usageRate =
                    totalSeats > 0
                        ? Math.round((todayBookings / totalSeats) * 100)
                        : 0;
                return {
                    key: floor.id.toString(),
                    area: floor.name,
                    usageRate,
                    count: todayBookings,
                };
            })
        );
        // Sort by usageRate desc
        areasData.sort((a, b) => b.usageRate - a.usageRate);
        ctx.body = { success: true, data: areasData.slice(0, 5) };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get hot areas',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

// ---- Dashboard: Unread notification count ----
router.get('/notification/unread-count', authMiddleware, async (ctx) => {
    try {
        const user = (ctx as any).state.user;
        const count = await Notification.countDocuments({
            userId: user.id,
            isRead: false,
        });
        ctx.body = { success: true, data: { count } };
    } catch (error: any) {
        // Gracefully return 0 if query fails
        ctx.body = { success: true, data: { count: 0 } };
    }
});

export default router;
