import Router from 'koa-router';
import { adminMiddleware, authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Feedback, User } from '../models/mongodb';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { buildUpdatedBy } from '../utils/audit';
import { ErrorCodes } from '../utils/error-codes';
import { getUserDisplayName } from '../utils/user-display';
import { FeedbackStatus } from '../constants/feedback';
import { feedbackRouteDependencies } from '../services/feedback-service';
import {
    formatRouteDateTime,
    formatRouteDateTimes,
} from '../utils/route-time-serializer';

const {
    submitFeedback,
    getUserFeedbacks,
    listFeedback,
    getFeedbackDetail,
    addFeedbackComment,
    removeFeedbackImage,
    exportFeedbacks,
} = feedbackRouteDependencies;

const router = new Router({ prefix: '/api/feedback' });

function appendOfficialFeedbackRecord(
    feedback: any,
    user: any,
    content: string
) {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) return;

    const operator = user?.name || user?.username || 'system';
    const lastComment = Array.isArray(feedback.comments)
        ? feedback.comments[feedback.comments.length - 1]
        : undefined;

    if (
        lastComment?.isOfficial &&
        String(lastComment.operator || '') === operator &&
        String(lastComment.content || '') === normalizedContent
    ) {
        return;
    }

    feedback.comments = feedback.comments || [];
    feedback.comments.push({
        operator,
        content: normalizedContent,
        date: new Date(),
        isOfficial: true,
    } as any);
}

/**
 * @route POST /api/feedback
 * @desc 提交反馈接口
 *
 * @body {
 *   typeId: 1|2|3|4 [required] (1:功能建议，2:问题上报，3:投诉建议，4:其他)
 *   urgencyId: 1|2|3|4 [required] (1:低，2:中，3:高，4:紧急)
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
 *     urgencyId: 1|2|3|4
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
        const userId = (ctx as any).state.user?.id;
        if (!userId) {
            throw new CustomError('Missing user', ErrorCodes.INVALID_PARAMS);
        }

        const { typeId, urgencyId, title, description, contact, images } = ctx
            .request.body as any;

        if (!typeId || !urgencyId || !title || !description) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const typeMap: any = {
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            suggestion: 1,
            bug: 2,
            complaint: 3,
            other: 4,
        };
        const typeNameMap: any = {
            1: '功能建议',
            2: '问题上报',
            3: '投诉建议',
            4: '其他',
        };
        const urgencyMap: any = {
            1: 1,
            2: 2,
            3: 3,
            4: 4,
            low: 1,
            medium: 2,
            high: 3,
            urgent: 4,
        };
        const urgencyNameMap: any = {
            1: '低',
            2: '中等',
            3: '高',
            4: '紧急',
        };

        const t = typeMap[typeId] || 4;
        const u = urgencyMap[urgencyId];
        if (!u) {
            throw new CustomError(
                'Invalid urgencyId',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const feedback = await submitFeedback(
            {
                userId,
                typeId: t,
                typeName: typeNameMap[t] || '',
                urgencyId: u,
                urgencyName: urgencyNameMap[u],
                title,
                description,
                contact,
                images: images ?? [],
            },
            { id: userId }
        );

        const feedbackWithUser = await Feedback.findById(feedback._id).populate(
            'userId',
            'name avatar studentId username'
        );

        ctx.body = {
            success: true,
            data: {
                id: feedbackWithUser?._id
                    ? String(feedbackWithUser._id)
                    : undefined,
                userId: feedbackWithUser?.userId,
                typeId: feedbackWithUser?.typeId,
                typeName: feedbackWithUser?.typeName,
                urgencyId: feedbackWithUser?.urgencyId,
                urgencyName: feedbackWithUser?.urgencyName,
                title: feedbackWithUser?.title,
                description: feedbackWithUser?.description,
                contact: feedbackWithUser?.contact,
                images: feedbackWithUser?.images,
                status: feedbackWithUser?.status,
                createdAt: formatRouteDateTime(feedbackWithUser?.createdAt),
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
 * @query_param {integer} pageSize - 每页数量（默认 20）
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
 *     pageSize: integer
 *   }
 * }
 */
router.get('/my', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const page = parseInt((ctx.query.page as string) || '1');
        const pageSize = parseInt(
            (ctx.query.pageSize as string) ||
                (ctx.query.limit as string) ||
                '20'
        );

        const { total, feedbacks } = await getUserFeedbacks(
            userId,
            page,
            pageSize
        );

        ctx.body = {
            success: true,
            data: {
                list: feedbacks.map((fb: any) => ({
                    id: String(fb._id),
                    typeId: fb.typeId,
                    urgencyId: fb.urgencyId,
                    title: fb.title,
                    description: fb.description,
                    images: fb.images,
                    status: fb.status,
                    reply: fb.reply,
                    replyAt: formatRouteDateTime(fb.replyAt),
                    commentsCount: (fb.comments || []).length,
                    createdAt: formatRouteDateTime(fb.createdAt),
                })),
                total,
                page,
                pageSize,
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
 * @route GET /api/feedback/list
 * @desc 管理员获取全部反馈（分页）
 * 权限：仅 `admin` 可访问
 */
router.get('/list', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const page = parseInt((ctx.query.page as string) || '1');
        const pageSize = parseInt(
            (ctx.query.pageSize as string) ||
                (ctx.query.limit as string) ||
                '20'
        );
        const title = String(ctx.query.title || '').trim();
        const typeId = normalizeNumericEnum(ctx.query.typeId as any);
        const status = normalizeNumericEnum(ctx.query.status as any);
        const urgencyId = normalizeNumericEnum(ctx.query.urgencyId as any);

        const filters: any = {};
        if (title) filters.title = title;
        if (typeId !== undefined) filters.typeId = typeId;
        if (status !== undefined) filters.status = status;
        if (urgencyId !== undefined) filters.urgencyId = urgencyId;

        const { total, feedbacks } = await listFeedback(
            page,
            pageSize,
            filters
        );

        ctx.body = {
            success: true,
            data: {
                list: feedbacks.map((fb: any) => ({
                    id: String(fb._id),
                    userId: fb.userId,
                    typeId: fb.typeId,
                    typeName: fb.typeName,
                    urgencyId: fb.urgencyId,
                    urgencyName: fb.urgencyName,
                    title: fb.title,
                    description: fb.description,
                    images: fb.images,
                    status: fb.status,
                    reply: fb.reply,
                    replyAt: formatRouteDateTime(fb.replyAt),
                    commentsCount: (fb.comments || []).length,
                    createdAt: formatRouteDateTime(fb.createdAt),
                    updatedBy: fb.updatedBy?._id || fb.updatedBy,
                    updatedByName:
                        getUserDisplayName(fb.updatedBy as any) ||
                        getUserDisplayName(fb.processedBy as any) ||
                        getUserDisplayName(fb.repliedBy as any) ||
                        '',
                })),
                total,
                page,
                pageSize,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Get feedback list failed:', error);
        throw new CustomError(
            'Failed to get feedback list',
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
        const currentUser = (ctx as any).state.user;
        const feedbackId = ctx.params.id;

        const feedback = await getFeedbackDetail(feedbackId, currentUser);

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(feedback, ['date']),
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

/**
 * @route PUT /api/feedback/:id
 * @desc 管理员处理反馈（更新 status、reply）
 * 权限：admin
 */
router.put('/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const user = await User.findById(userId);

        const id = ctx.params.id;
        const { status, reply } = ctx.request.body as any;
        const replyText = String(reply || '').trim();

        const feedback = await Feedback.findById(id);
        if (!feedback)
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );

        const normalizedStatus = normalizeNumericEnum(status);
        if (normalizedStatus !== undefined) {
            feedback.status = normalizedStatus;
        } else if (replyText && feedback.status === FeedbackStatus.PENDING) {
            feedback.status = FeedbackStatus.PROCESSING;
        }
        if (replyText) {
            feedback.reply = replyText;
            feedback.repliedBy = user?._id;
            feedback.replyAt = new Date();
            appendOfficialFeedbackRecord(feedback, user, replyText);
        }

        if (
            normalizedStatus === FeedbackStatus.RESOLVED ||
            normalizedStatus === FeedbackStatus.REJECTED ||
            replyText
        ) {
            feedback.processedBy = user?._id;
            feedback.processedAt = new Date();
        }

        if (
            normalizedStatus === FeedbackStatus.RESOLVED ||
            normalizedStatus === FeedbackStatus.REJECTED
        ) {
            feedback.processedReason = replyText || feedback.processedReason;
        }

        Object.assign(feedback, buildUpdatedBy(ctx));

        await feedback.save();

        const updated = await Feedback.findById(id).populate(
            'userId',
            'name avatar studentId'
        );

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(updated, ['date']),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Process feedback failed:', error);
        throw new CustomError(
            'Failed to process feedback',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route PUT /api/feedback/status/:id
 * @desc 更新反馈状态（管理员）
 * body: { status: string, reason?: string }
 */
router.put('/status/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const user = await User.findById(userId);

        const id = ctx.params.id;
        const { status, reason } = ctx.request.body as any;

        const feedback = await Feedback.findById(id);
        if (!feedback)
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );

        const normalizedStatus = normalizeNumericEnum(status);
        if (normalizedStatus !== undefined) {
            feedback.status = normalizedStatus;
        }
        if (reason) {
            feedback.processedReason = reason;
            feedback.processedBy = user?._id;
            feedback.processedAt = new Date();
            appendOfficialFeedbackRecord(feedback, user, reason);
        }

        Object.assign(feedback, buildUpdatedBy(ctx));

        await feedback.save();

        ctx.body = {
            success: true,
            data: { feedbackId: id, newStatus: feedback.status },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Update feedback status failed:', error);
        throw new CustomError(
            'Failed to update feedback status',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route POST /api/feedback/comment/:id
 * @desc 添加反馈回复/评论
 * body: { content: string, operator?: string }
 */
router.post('/comment/:id', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const user = await User.findById(userId);

        const id = ctx.params.id;
        const { content, operator } = ctx.request.body as any;

        const result = await addFeedbackComment(
            id,
            content,
            operator,
            user,
            ctx
        );

        ctx.body = {
            success: true,
            data: {
                ...result,
                date: formatRouteDateTime((result as any)?.date),
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Add feedback comment failed:', error);
        throw new CustomError(
            'Failed to add comment',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route DELETE /api/feedback/image/:id
 * @desc 管理员删除反馈中的图片（仅移除与反馈的关联，文件与 Upload 元数据保留供管理员在“上传管理”中确认删除）
 * body: { url: string }
 */
router.delete('/image/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const id = ctx.params.id;
        const { url } = ctx.request.body as any;

        await removeFeedbackImage(id, url, ctx);

        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Delete feedback image failed:', error);
        throw new CustomError(
            'Failed to delete feedback image',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route GET /api/feedback/export
 * @desc 导出反馈为 CSV
 * query: format=csv|excel (default csv), status, startDate, endDate
 */
router.get('/export', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const status = ctx.query.status as string | undefined;
        const startDate = ctx.query.startDate as string | undefined;
        const endDate = ctx.query.endDate as string | undefined;

        const csv = await exportFeedbacks(status, startDate, endDate);
        const filename = `feedbacks_${new Date()
            .toISOString()
            .slice(0, 10)}.csv`;

        ctx.set('Content-disposition', `attachment; filename="${filename}"`);
        ctx.set('Content-Type', 'text/csv; charset=utf-8');
        ctx.body = csv;
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Export feedbacks failed:', error);
        throw new CustomError(
            'Failed to export feedbacks',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

export default router;
