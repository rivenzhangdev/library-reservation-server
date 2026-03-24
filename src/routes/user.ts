import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { CreditRecord, User } from '../models/mongodb';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/user' });

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

        ctx.body = {
            success: true,
            data: user,
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
        const userId = (ctx as any).state.user.id;
        const { name, avatar } = ctx.request.body as any;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (avatar !== undefined) updateData.avatar = avatar;

        await User.updateById(userId, updateData);

        ctx.body = {
            success: true,
            message: '更新成功',
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
        const userId = (ctx as any).state.user.id;
        const seatId = ctx.params.seatId;

        const user = await User.findById(userId);

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const favoriteIndex = user.favorites.findIndex(
            (id) => id.toString() === seatId
        );

        if (favoriteIndex > -1) {
            // 取消收藏
            user.favorites.splice(favoriteIndex, 1);
        } else {
            // 添加收藏
            user.favorites.push(seatId);
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
                level, // 返回数字等级
                records: records.map((record) => ({
                    id: record._id,
                    type: record.type,
                    points: record.points,
                    date: record.date,
                    reason: record.reason,
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
        const limit = parseInt((ctx.query.limit as string) || '20');

        const total = await CreditRecord.countDocuments({ userId });

        const records = await CreditRecord.find({ userId })
            .sort({ date: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        ctx.body = {
            success: true,
            data: {
                records: records.map((record) => ({
                    id: record._id,
                    type: record.type,
                    points: record.points,
                    date: record.date,
                    reason: record.reason,
                })),
                total,
                page,
                limit,
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
        const { content, contact, type } = ctx.request.body as any;

        const feedback = await Feedback.create({
            userId,
            content,
            contact,
            type,
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
        const feedbacks = await Feedback.findByUserId(userId);

        ctx.body = {
            success: true,
            data: feedbacks,
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
        const feedbackId = parseInt(ctx.params.id);

        const feedback = await Feedback.findById(feedbackId);

        if (!feedback) {
            throw new CustomError('反馈不存在', ErrorCodes.USER_NOT_FOUND);
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
