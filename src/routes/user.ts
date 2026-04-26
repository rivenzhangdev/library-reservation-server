import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import {
    CreditRecord,
    Feedback,
    StudentRegistry,
    User,
} from '../models/mongodb';
import { Floor, Seat } from '../models/mysql';
import { normalizeUploadUrl, saveBase64Image } from '../utils/upload';
import { getUserDisplayName } from '../utils/user-display';
import { ErrorCodes } from '../utils/error-codes';
import { normalizeSeatStatus } from '../utils/seat-status';
import { Roles } from '../constants/roles';
import { SystemDisplayName } from '../constants/credit';
import {
    formatRouteDateTime,
    formatRouteDateTimes,
} from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/user' });

function assertNotReadOnlySuperAdmin(ctx: any) {
    if ((ctx as any).state.user?.isSuperAdmin) {
        throw new CustomError(
            'Super admin account is read-only',
            ErrorCodes.FORBIDDEN
        );
    }
}

// 信用等级枚举 (数字类型)
enum CreditLevel {
    POOR = 0, // 较差 (0-59 分)
    NORMAL = 1, // 普通 (60-79 分)
    GOOD = 2, // 良好 (80-89 分)
    EXCELLENT = 3, // 优秀 (90-100 分)
}

/**
 * @route GET /api/user/profile
 * @desc 获取用户信息接口
 */
router.get('/profile', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;

        const user = await User.findById(userId).select('-password');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const normalizedUser = user.toObject();
        if (normalizedUser.studentId) {
            const registryRecord = await StudentRegistry.findOne(
                { studentId: normalizedUser.studentId, active: true },
                { college: 1, major: 1, grade: 1, realName: 1 }
            ).lean();
            if (registryRecord) {
                (normalizedUser as any).studentProfile = {
                    realName: registryRecord.realName,
                    college: registryRecord.college,
                    major: (registryRecord as any).major,
                    grade: registryRecord.grade,
                };
            }
        }
        delete (normalizedUser as any).isSuperAdmin;
        normalizedUser.avatar = normalizeUploadUrl(
            String(normalizedUser.avatar || ''),
            ctx.origin
        );
        (normalizedUser as any).avatarUrl = normalizedUser.avatar;

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(normalizedUser),
        };
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        console.error('获取用户信息失败:', error);
        throw new CustomError('获取用户信息失败', ErrorCodes.INTERNAL_ERROR);
    }
});

/**
 * @route PUT /api/user/profile
 * @desc Update user profile interface
 */
router.put('/profile', authMiddleware, async (ctx) => {
    try {
        assertNotReadOnlySuperAdmin(ctx);
        const userId = (ctx as any).state.user.id;
        const { name, avatar, username, phone, email } = ctx.request
            .body as any;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (username !== undefined) {
            const normalizedUsername = String(username).trim();
            if (!normalizedUsername) {
                throw new CustomError(
                    'Username cannot be empty',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            const existingUser = await User.findOne({
                username: normalizedUsername,
                _id: { $ne: userId },
            });
            if (existingUser) {
                throw new CustomError(
                    'Username already exists',
                    ErrorCodes.USERNAME_EXISTS ?? ErrorCodes.INVALID_PARAMS
                );
            }
            updateData.username = normalizedUsername;
        }
        if (email !== undefined) {
            const normalizedEmail = String(email).trim();
            if (normalizedEmail) {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
                    throw new CustomError(
                        'Invalid email address',
                        ErrorCodes.INVALID_PARAMS
                    );
                }
                const existingEmailUser = await User.findOne({
                    email: normalizedEmail,
                    _id: { $ne: userId },
                });
                if (existingEmailUser) {
                    throw new CustomError(
                        'Email address already exists',
                        ErrorCodes.INVALID_PARAMS
                    );
                }
                updateData.email = normalizedEmail;
            }
        }
        if (phone !== undefined) {
            const normalizedPhone = String(phone).trim();
            if (normalizedPhone && !/^1\d{10}$/.test(normalizedPhone)) {
                throw new CustomError(
                    'Invalid phone number',
                    ErrorCodes.INVALID_PARAMS
                );
            }
            if (normalizedPhone) {
                const existingPhoneUser = await User.findOne({
                    phone: normalizedPhone,
                    _id: { $ne: userId },
                });
                if (existingPhoneUser) {
                    throw new CustomError(
                        'Phone number already exists',
                        ErrorCodes.INVALID_PARAMS
                    );
                }
            }
            updateData.phone = normalizedPhone;
        }
        if (avatar !== undefined) {
            // if avatar is base64 data URL, save to uploads and set url
            if (typeof avatar === 'string' && avatar.startsWith('data:')) {
                try {
                    const url = await saveBase64Image(avatar, userId);
                    updateData.avatar = url;
                } catch (e: any) {
                    console.error('Save avatar failed', {
                        userId,
                        avatarLength: String(avatar).length,
                        error: e?.message || e,
                        stack: e?.stack,
                    });
                    throw new CustomError(
                        `Upload avatar failed: ${
                            e?.message || 'Unknown error'
                        }`,
                        ErrorCodes.UPDATE_PROFILE_ERROR
                    );
                }
            } else {
                updateData.avatar = avatar;
            }
        }

        const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
            new: true,
            runValidators: true,
        }).select('-password');

        if (!updatedUser) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const normalizedUser = updatedUser.toObject();
        delete (normalizedUser as any).isSuperAdmin;
        normalizedUser.avatar = normalizeUploadUrl(
            String(normalizedUser.avatar || ''),
            ctx.origin
        );
        (normalizedUser as any).avatarUrl = normalizedUser.avatar;

        ctx.body = {
            success: true,
            message: '更新成功',
            data: formatRouteDateTimes(normalizedUser),
        };
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        console.error('更新用户信息失败:', error);
        throw new CustomError(
            '更新用户信息失败',
            ErrorCodes.UPDATE_PROFILE_ERROR
        );
    }
});

/**
 * @route GET /api/user/settings
 * @desc Get user settings interface
 */
router.get('/settings', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;

        const user = await User.findById(userId).select('settings');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        ctx.body = {
            success: true,
            data: user.settings,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get settings',
            ErrorCodes.UPDATE_SETTINGS_ERROR
        );
    }
});

/**
 * @route PUT /api/user/settings
 * @desc Update settings interface
 */
router.put('/settings', authMiddleware, async (ctx) => {
    try {
        assertNotReadOnlySuperAdmin(ctx);
        const userId = (ctx as any).state.user.id;
        const settings = ctx.request.body as any;

        const user = await User.findByIdAndUpdate(
            userId,
            { settings },

            { new: true, runValidators: true }
        ).select('settings');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        ctx.body = {
            success: true,
            data: {
                settings: user.settings,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update settings',
            ErrorCodes.UPDATE_SETTINGS_ERROR
        );
    }
});

/**
 * @route POST /api/user/favorite/:seatId
 * @desc Favorite/unfavorite seat interface
 */
router.post('/favorite/:seatId', authMiddleware, async (ctx) => {
    try {
        assertNotReadOnlySuperAdmin(ctx);
        const userId = (ctx as any).state.user.id;
        const seatId = Number.parseInt(ctx.params.seatId, 10);

        if (Number.isNaN(seatId)) {
            throw new CustomError('Invalid seat ID', ErrorCodes.INVALID_PARAMS);
        }

        const user = await User.findById(userId);

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const favoriteIndex = user.favorites.findIndex(
            (id) => Number(id) === seatId
        );

        if (favoriteIndex > -1) {
            // 取消收藏
            user.favorites.splice(favoriteIndex, 1);
        } else {
            // 添加收藏
            (user.favorites as any).push(seatId);
        }

        await user.save();

        ctx.body = {
            success: true,
            data: {
                favorites: user.favorites,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Favorite operation failed',
            ErrorCodes.FAVORITE_ERROR
        );
    }
});

/**
 * @route GET /api/user/favorites
 * @desc Get user's favorite seats with details
 */
router.get('/favorites', authMiddleware, async (ctx) => {
    try {
        const { page = '1', pageSize, limit } = ctx.query as any;
        const userId = (ctx as any).state.user.id;
        const user = await User.findById(userId).select('favorites');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const seatIds = user.favorites
            .map((id) => Number(id))
            .filter((id) => !Number.isNaN(id));
        const seats =
            seatIds.length > 0
                ? await Seat.findAll({
                      where: { id: seatIds },
                      include: [
                          {
                              model: Floor,
                              as: 'floor',
                              attributes: ['id', 'name'],
                          },
                      ],
                  })
                : [];
        const list = seats.map((seat: any) => ({
            id: seat.id,
            floorId: seat.floorId,
            floorName: seat.floor?.name || '',
            rowNum: seat.rowNum,
            colNum: seat.colNum,
            type: seat.type,
            hasSocket: seat.hasSocket,
            isWindow: seat.isWindow,
            zone: seat.zone,
            status: normalizeSeatStatus(seat.status),
            description: seat.description,
        }));
        const total = list.length;
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.max(
            1,
            Number(pageSize ?? limit ?? total ?? 1)
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
            'Failed to get favorites',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route GET /api/user/credit
 * @desc Get credit score interface
 */
router.get('/credit', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;

        const user = await User.findById(userId).select('creditScore');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        // 获取信用记录
        const records = await CreditRecord.find({ userId })
            .sort({ date: -1 })
            .limit(10);

        // 计算信用等级 (数字类型)
        let level: CreditLevel;
        if (user.creditScore >= 90) level = CreditLevel.EXCELLENT;
        else if (user.creditScore >= 80) level = CreditLevel.GOOD;
        else if (user.creditScore >= 60) level = CreditLevel.NORMAL;
        else level = CreditLevel.POOR;

        ctx.body = {
            success: true,
            data: {
                score: user.creditScore,
                creditScore: user.creditScore,
                level, // 返回数字等级
                records: records.map((record) => ({
                    id: record._id,
                    type: record.type,
                    points: record.points,
                    date: formatRouteDateTime(record.date),
                    reason: record.reason,
                    reasonCode: record.reasonCode || record.reason,
                    reasonText: record.reasonText || record.reason,
                })),
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get credit score',
            ErrorCodes.GET_CREDIT_ERROR
        );
    }
});

/**
 * @route GET /api/user/credit/records
 * @desc Get credit records interface
 */
router.get('/credit/records', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const page = parseInt((ctx.query.page as string) || '1');
        const pageSize = parseInt(
            (ctx.query.pageSize as string) ||
                (ctx.query.limit as string) ||
                '20'
        );

        const isAdmin = (ctx as any).state.user?.role === Roles.ADMIN;
        const { q, reason } = ctx.query as any;
        const baseFilter: any = isAdmin ? {} : { userId };
        const filters: any[] = [];

        if (reason) {
            filters.push({
                $or: [
                    { reason: { $regex: reason, $options: 'i' } },
                    { reasonCode: { $regex: reason, $options: 'i' } },
                    { reasonText: { $regex: reason, $options: 'i' } },
                ],
            });
        }

        if (q && isAdmin) {
            const matchingUsers = await User.find({
                $or: [
                    { username: { $regex: q, $options: 'i' } },
                    { name: { $regex: q, $options: 'i' } },
                ],
            })
                .select('_id')
                .lean();
            const userIds = matchingUsers.map((u: any) => String(u._id));
            filters.push(
                userIds.length
                    ? { userId: { $in: userIds } }
                    : { userId: '__not_found__' }
            );
        }

        const query: any = { ...baseFilter };
        if (filters.length) {
            query.$and = filters;
        }

        const total = await CreditRecord.countDocuments(query);

        const records = await CreditRecord.find(query)
            .sort({ date: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .populate('userId', 'username name studentId avatar')
            .populate('updatedBy', 'username name');

        const mappedRecords = records.map((record) => ({
            id: record._id,
            type: record.type,
            points: record.points,
            date: formatRouteDateTime(record.date),
            reason: record.reason,
            reasonCode: record.reasonCode || record.reason,
            reasonText: record.reasonText || record.reason,
            userId: record.userId?._id || undefined,
            userName:
                getUserDisplayName(record.userId as any) ||
                (record.userId as any)?.studentId ||
                '',
            userAvatar: (record.userId as any)?.avatar || '',
            updatedByName:
                getUserDisplayName(record.updatedBy as any) ||
                (record.updatedBy?._id ? String(record.updatedBy._id) : '') ||
                SystemDisplayName,
        }));

        ctx.body = {
            success: true,
            data: {
                list: mappedRecords,
                total,
                page,
                pageSize,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get credit records',
            ErrorCodes.GET_FEEDBACK_ERROR
        );
    }
});

/**
 * @route POST /api/user/feedback
 * @desc 提交反馈接口
 */
router.post('/feedback', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const {
            typeId,
            typeName,
            urgencyId,
            urgencyName,
            title,
            description,
            contact,
            images,
        } = ctx.request.body as any;

        const feedback = await Feedback.create({
            userId,
            typeId,
            typeName,
            urgencyId,
            urgencyName,
            title,
            description,
            contact,
            images,
        });

        ctx.body = {
            success: true,
            data: feedback,
        };
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        console.error('提交反馈失败:', error);
        throw new CustomError('提交反馈失败', ErrorCodes.SUBMIT_FEEDBACK_ERROR);
    }
});

/**
 * @route GET /api/user/feedback/my
 * @desc 获取我的反馈接口
 */
router.get('/feedback/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { page = '1', pageSize, limit } = ctx.query as any;
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.max(1, Number(pageSize ?? limit ?? 20));

        const total = await Feedback.countDocuments({ userId });
        const feedbacks = await Feedback.find({ userId })
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safePageSize)
            .limit(safePageSize)
            .lean();
        const list = feedbacks.map((item: any) =>
            formatRouteDateTimes({
                ...item,
                id: String(item._id),
            })
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total,
                page: safePage,
                pageSize: safePageSize,
            },
        };
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        console.error('获取我的反馈失败:', error);
        throw new CustomError(
            '获取我的反馈失败',
            ErrorCodes.GET_FEEDBACK_ERROR
        );
    }
});

/**
 * @route GET /api/user/feedback/:id
 * @desc 获取单个反馈接口
 */
router.get('/feedback/:id', authMiddleware, async (ctx) => {
    try {
        const feedbackId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const feedback = await Feedback.findOne({
            _id: feedbackId,
            userId,
        });

        if (!feedback) {
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.USER_NOT_FOUND
            );
        }

        ctx.body = {
            success: true,
            data: feedback,
        };
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        console.error('获取单个反馈失败:', error);
        throw new CustomError(
            '获取单个反馈失败',
            ErrorCodes.GET_FEEDBACK_ERROR
        );
    }
});

// ====================== 枚举值映射参考 (供前端使用) ======================
/*
信用等级 (level):
  0 -> '较差' (信用积分：0-59)
  1 -> '普通' (信用积分：60-79)
  2 -> '良好' (信用积分：80-89)
  3 -> '优秀' (信用积分：90-100)

注意：服务端只返回数字类型的 level 字段，文本展示由前端根据上述映射关系自行解析
*/

export default router;
