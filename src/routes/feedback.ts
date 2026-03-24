import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Feedback, User } from '../models/mongodb';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/feedback' });

// 反馈状态枚举 (数字类型)
enum FeedbackStatus {
    PENDING = 1, // 待处理
    PROCESSING = 2, // 处理中
    RESOLVED = 3, // 已解决
    REJECTED = 4, // 已拒绝
}

/**
 * @route POST /api/feedback
 * @desc 提交反馈接口
 *
 * @body {
 *   typeId: 1|2|3|4 [required] (1:功能建议，2:问题上报，3:投诉建议，4:其他)
 *   urgencyId: 1|2|3|4 [optional] (1:低，2:中，3:高，4:紧急)
 *   title: string [required]
 *   description: string [required]
 *   contact: string [optional]
 *   images: string[] [optional]
 * }
 *
 * @response 200 {
 *   success: boolean
 *   data: {
 *     id: string
 *     userId: string
 *     typeId: 1|2|3|4
 *     urgencyId: 1|2|3|4|null
 *     title: string
 *     description: string
 *     contact: string|null
 *     images: string[]
 *     status: 1|2|3|4 (1:待处理，2:处理中，3:已解决，4:已拒绝)
 *     createdAt: string
 *   }
 * }
 */
router.post('/', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { typeId, urgencyId, title, description, contact, images } = ctx
            .request.body as any;

        // 验证必填项
        if (!typeId || !title || !description) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        // 创建反馈
        const feedback = await Feedback.create({
            userId,
            typeId: parseInt(typeId), // 确保是数字
            urgencyId: urgencyId ? parseInt(urgencyId) : undefined, // 确保是数字
            title,
            description,
            contact,
            images: images ?? [],
            status: FeedbackStatus.PENDING, // 使用数字枚举值
        });

        // 填充用户信息
        const feedbackWithUser = await Feedback.findById(feedback._id).populate(
            'userId',
            'name avatar studentId'
        );

        ctx.body = {
            success: true,
            data: {
                id: feedbackWithUser?._id,
                userId: feedbackWithUser?.userId,
                typeId: feedbackWithUser?.typeId, // 数字类型
                urgencyId: feedbackWithUser?.urgencyId, // 数字类型
                title: feedbackWithUser?.title,
                description: feedbackWithUser?.description,
                contact: feedbackWithUser?.contact,
                images: feedbackWithUser?.images,
                status: feedbackWithUser?.status, // 数字类型
                createdAt: feedbackWithUser?.createdAt,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Submit feedback failed:', error);
        throw new CustomError(
            'Failed to submit feedback',
            ErrorCodes.SUBMIT_FEEDBACK_ERROR
        );
    }
});

/**
 * @route GET /api/feedback/my
 * @desc 获取我的反馈列表接口
 *
 * @query_param {integer} page - 页码（默认 1）
 * @query_param {integer} limit - 每页数量（默认 20）
 *
 * @response 200 {
 *   success: boolean
 *   data: {
 *     feedbacks: Array<{
 *       id: string
 *       typeId: 1|2|3|4 (1:功能建议，2:问题上报，3:投诉建议，4:其他)
 *       urgencyId: 1|2|3|4 (1:低，2:中，3:高，4:紧急)
 *       title: string
 *       description: string
 *       images: string[]
 *       status: 1|2|3|4 (1:待处理，2:处理中，3:已解决，4:已拒绝)
 *       reply: string|null
 *       replyAt: string|null
 *       createdAt: string
 *     }>
 *     total: integer
 *     page: integer
 *     limit: integer
 *   }
 * }
 */
router.get('/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const page = parseInt((ctx.query.page as string) || '1');
        const limit = parseInt((ctx.query.limit as string) || '20');

        const total = await Feedback.countDocuments({ userId });

        const feedbacks = await Feedback.find({ userId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select(
                'id typeId urgencyId title description images status reply replyAt createdAt'
            );

        ctx.body = {
            success: true,
            data: {
                feedbacks: feedbacks.map((fb) => ({
                    id: fb._id,
                    typeId: fb.typeId, // 数字类型
                    urgencyId: fb.urgencyId, // 数字类型
                    title: fb.title,
                    description: fb.description,
                    images: fb.images,
                    status: fb.status, // 数字类型
                    reply: fb.reply,
                    replyAt: fb.replyAt,
                    createdAt: fb.createdAt,
                })),
                total,
                page,
                limit,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Get feedbacks failed:', error);
        throw new CustomError(
            'Failed to get feedbacks',
            ErrorCodes.GET_FEEDBACKS_ERROR
        );
    }
});

/**
 * @route GET /api/feedback/:id
 * @desc 获取反馈详情接口
 *
 * @path_param {string} id - 反馈 ID
 *
 * @response 200 {
 *   success: boolean
 *   data: {
 *     id: string
 *     userId: {
 *       _id: string
 *       name: string
 *       avatar: string
 *       studentId: string
 *     }
 *     typeId: 1|2|3|4 (1:功能建议，2:问题上报，3:投诉建议，4:其他)
 *     urgencyId: 1|2|3|4|null (1:低，2:中，3:高，4:紧急)
 *     title: string
 *     description: string
 *     contact: string|null
 *     images: string[]
 *     status: 1|2|3|4 (1:待处理，2:处理中，3:已解决，4:已拒绝)
 *     reply: string|null
 *     repliedBy: string|null
 *     replyAt: string|null
 *     createdAt: string
 *     updatedAt: string
 *   }
 * }
 */
router.get('/:id', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const feedbackId = ctx.params.id;

        const feedback = await Feedback.findById(feedbackId).populate(
            'userId',
            'name avatar studentId'
        );

        if (!feedback) {
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );
        }

        // 权限检查：只能查看自己的反馈（管理员除外）
        const user = await User.findById(userId);
        if (
            feedback.userId._id.toString() !== userId &&
            user?.role !== 'admin'
        ) {
            throw new CustomError('Access denied', ErrorCodes.FORBIDDEN);
        }

        ctx.body = {
            success: true,
            data: {
                id: feedback._id,
                userId: feedback.userId,
                typeId: feedback.typeId, // 数字类型
                urgencyId: feedback.urgencyId, // 数字类型
                title: feedback.title,
                description: feedback.description,
                contact: feedback.contact,
                images: feedback.images,
                status: feedback.status, // 数字类型
                reply: feedback.reply,
                repliedBy: feedback.repliedBy,
                replyAt: feedback.replyAt,
                createdAt: feedback.createdAt,
                updatedAt: feedback.updatedAt,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Get feedback failed:', error);
        throw new CustomError(
            'Failed to get feedback',
            ErrorCodes.GET_FEEDBACKS_ERROR
        );
    }
});

export default router;
