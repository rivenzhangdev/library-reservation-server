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
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api' });

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';
import { Roles } from '../constants/roles';

function requireAdmin(ctx: any) {
    const user = ctx.state.user;
    if (user?.role !== Roles.ADMIN) {
        throw new CustomError('Forbidden', ErrorCodes.FORBIDDEN);
    }
}

// ---- Bookings compatibility (admin expects /api/bookings) ----
router.get('/bookings', authMiddleware, async (ctx) => {
    try {
        const user = (ctx as any).state.user;
        const { status, page = 1, limit = 20 } = ctx.query as any;

        const where: any = {};
        if (user?.role !== Roles.ADMIN) {
            where.userId = user.id.toString();
        }
        if (status !== undefined) where.status = parseInt(status as string);

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

router.get('/bookings/:id', authMiddleware, async (ctx) => {
    try {
        const bookingId = ctx.params.id;
        const user = (ctx as any).state.user;

        const booking = await Booking.findOne({
            where:
                user?.role === Roles.ADMIN
                    ? { id: bookingId }
                    : { id: bookingId, userId: user.id.toString() },
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
        const bookingId = ctx.params.id;
        const user = (ctx as any).state.user;

        const booking = await Booking.findOne({
            where:
                user?.role === Roles.ADMIN
                    ? { id: bookingId }
                    : { id: bookingId, userId: user.id.toString() },
        });

        if (!booking)
            throw new CustomError(
                'Booking not found',
                ErrorCodes.BOOKING_NOT_FOUND
            );

        await booking.update({ status: BookingStatus.CANCELED });

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

        const token = jwt.sign(
            {
                id: user._id?.toString ? user._id.toString() : user._id,
                username: user.username,
                role: user.role ?? Roles.USER,
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
                    avatar: user.avatar ?? null,
                    username: user.username,
                    role: user.role ?? Roles.USER,
                },
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Login failed', ErrorCodes.INTERNAL_ERROR);
    }
});

// ---- Seat compatibility (/api/seat/* expected by admin) ----
router.get('/seat/list', async (ctx) => {
    try {
        const { floorId } = ctx.query as any;
        const where: any = {};
        if (floorId) where.floorId = floorId;
        const ZoneMySQL = require('../models/mysql').Zone;
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

        ctx.body = {
            success: true,
            data: seats.map((seat) => ({
                id: seat.id,
                floorId: seat.floorId,
                floorName: (seat as any).floor?.name || '',
                rowNum: seat.rowNum,
                colNum: seat.colNum,
                status: seat.status,
                type: seat.type,
                hasSocket: seat.hasSocket,
                isWindow: seat.isWindow,
                zone: seat.zone,
                zoneId: (seat as any).zoneId || (seat as any).zoneObj?.id,
                zoneName: (seat as any).zoneObj?.name || seat.zone,
                description: seat.description,
            })),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat list',
            ErrorCodes.GET_SEATS_ERROR
        );
    }
});

router.get('/seat/:id', async (ctx) => {
    try {
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
        ctx.body = {
            success: true,
            data: {
                id: seat.id,
                floorId: seat.floorId,
                floorName: (seat as any).floor?.name || '',
                rowNum: seat.rowNum,
                colNum: seat.colNum,
                status: seat.status,
                type: seat.type,
                hasSocket: seat.hasSocket,
                isWindow: seat.isWindow,
                zone: seat.zone,
                description: seat.description,
                zoneId: (seat as any).zoneId || (seat as any).zoneObj?.id,
                zoneName: (seat as any).zoneObj?.name || seat.zone,
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
        const seat = await Seat.create(data);
        ctx.body = { success: true, data: seat };
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
        await seat.update(data);
        ctx.body = { success: true, data: seat };
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
router.get('/floors', async (ctx) => {
    try {
        const floors = await Floor.findAll();
        ctx.body = { success: true, data: floors };
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
        const floor = await Floor.create(data);
        ctx.body = { success: true, data: floor };
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
        const floor = await Floor.findByPk(id);
        if (!floor)
            throw new CustomError(
                'Floor not found',
                ErrorCodes.FLOOR_NOT_FOUND
            );
        await floor.update(data);
        ctx.body = { success: true, data: floor };
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
router.get('/activity/list', async (ctx) => {
    try {
        const activities = await Activity.find().lean();
        ctx.body = { success: true, data: activities };
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
        const { page = 1, limit = 20, q, blacklisted } = ctx.query as any;
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

        // 支持多种形式的 blacklisted 查询（1/'1'/true/'true'/'blacklisted' 等）
        if (typeof blacklisted !== 'undefined') {
            const isBlacklisted = (() => {
                if (blacklisted === true) return true;
                if (typeof blacklisted === 'number') return blacklisted === 1;
                if (typeof blacklisted === 'string') {
                    const n = Number(blacklisted);
                    if (!Number.isNaN(n)) return n === 1;
                    const lower = blacklisted.toLowerCase();
                    return (
                        lower === 'true' ||
                        lower === '1' ||
                        lower === 'blacklisted' ||
                        lower === 'banned'
                    );
                }
                return false;
            })();
            filter.blacklisted = isBlacklisted;
        }

        const total = await User.countDocuments(filter);
        const list = await User.find(filter)
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

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
        // normalize role: accept string or numeric
        if (typeof data.role === 'string') {
            if (data.role === 'admin') data.role = Roles.ADMIN;
            else data.role = Roles.USER;
        }
        try {
            const user = new User(data);
            await user.save();
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
        // normalize incoming role
        if (data.role && typeof data.role === 'string') {
            if (data.role === 'admin') data.role = Roles.ADMIN;
            else data.role = Roles.USER;
        }
        const user = await User.findByIdAndUpdate(id, data, {
            new: true,
        }).select('-password');
        if (!user)
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
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
        // 支持多种形式的 status：数字（1/0）、字符串（"blacklisted"/"active"）或布尔值
        const isBlacklisted = (() => {
            if (status === true) return true;
            if (typeof status === 'number') return status === 1;
            if (typeof status === 'string') {
                // 数字字符串 '1' 也视为黑名单
                const n = Number(status);
                if (!Number.isNaN(n)) return n === 1;
                const lower = status.toLowerCase?.();
                return (
                    lower === 'blacklisted' ||
                    lower === 'banned' ||
                    lower === 'blacklist'
                );
            }
            return false;
        })();
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
        if (status === 'blacklisted' || status === 1) update.blacklisted = true;
        else update.blacklisted = false;
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
        const { page = 1, limit = 20, q } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const filter: any = {};
        if (q) filter.name = { $regex: q, $options: 'i' };

        const total = await Zone.countDocuments(filter);
        const list = await Zone.find(filter)
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .lean();

        ctx.body = { success: true, data: { list, total } };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError('Failed to get zones', ErrorCodes.INTERNAL_ERROR);
    }
});

router.post('/zones', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const data = ctx.request.body as any;
        const zone = new Zone(data);
        await zone.save();
        ctx.body = { success: true, data: zone };
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
        const zone = await Zone.findByIdAndUpdate(id, data, {
            new: true,
        }).lean();
        if (!zone)
            throw new CustomError('Zone not found', ErrorCodes.NOT_FOUND);
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
        const activity = new Activity(data);
        await activity.save();
        ctx.body = { success: true, data: activity };
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
        const activity = await Activity.findByIdAndUpdate(id, data, {
            new: true,
            runValidators: true,
        });
        if (!activity)
            throw new CustomError('Activity not found', ErrorCodes.NOT_FOUND);
        ctx.body = { success: true, data: activity };
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
        // For system notifications without specific userId, use the admin's own id
        if (!data.userId) {
            const user = (ctx as any).state.user;
            data.userId = user.id;
        }
        const notification = new Notification(data);
        await notification.save();
        ctx.body = { success: true, data: notification };
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

        const booking = await Booking.create({
            userId,
            seatId,
            date,
            timeSlot,
            startTime: data.startTime,
            endTime: data.endTime,
            status: BookingStatus.UPCOMING,
        });
        ctx.body = { success: true, data: booking };
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
        const { bookingIds, reason } = ctx.request.body as any;
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
        const { seats } = ctx.request.body as any;
        if (!Array.isArray(seats))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        const created = await Seat.bulkCreate(seats);
        ctx.body = { success: true, data: created };
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
        const { ids, status } = ctx.request.body as any;
        if (!Array.isArray(ids))
            throw new CustomError('Invalid params', ErrorCodes.INVALID_PARAMS);
        await Seat.update({ status }, { where: { id: ids } });
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
        await CreditRecord.create({
            userId,
            type: 0,
            points: Number(points),
            reason: reason || '管理员加分',
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
        await CreditRecord.create({
            userId,
            type: 1,
            points: Number(points),
            reason: reason || '管理员扣分',
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
        const { startDate, endDate } = ctx.query as any;

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
        const { page = 1, limit = 20, userId } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const query: any = {};
        if (userId) query.userId = userId;
        const records = await CreditRecord.find(query)
            .sort({ date: -1 })
            .skip((pageNum - 1) * pageLimit)
            .limit(pageLimit)
            .populate('userId', 'name avatar');
        const total = await CreditRecord.countDocuments(query);
        ctx.body = {
            success: true,
            data: { list: records, total, page: pageNum, limit: pageLimit },
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
        const { page = 1, limit = 20 } = ctx.query as any;
        const pageNum = parseInt(page as string);
        const pageLimit = parseInt(limit as string);
        const { Op } = require('sequelize');
        const { count, rows } = await Booking.findAndCountAll({
            where: { status: BookingStatus.VIOLATED },
            order: [['updated_at', 'DESC']],
            offset: (pageNum - 1) * pageLimit,
            limit: pageLimit,
            include: [{ model: Seat, as: 'seat' }],
        });

        // Enrich with user info from MongoDB
        const list = await Promise.all(
            rows.map(async (b: any) => {
                const user = await User.findById(b.userId).select(
                    'name avatar'
                );
                return {
                    id: b.id,
                    bookingId: b.id,
                    userId: b.userId,
                    userName: user?.name || 'Unknown',
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
        const floors = await Floor.findAll({ order: [['name', 'ASC']] });
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
                const user = await User.findById(b.userId).select('name');
                return {
                    key: b.id.toString(),
                    user: user?.name || '未知用户',
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
                    name: user?.name || '未知',
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
