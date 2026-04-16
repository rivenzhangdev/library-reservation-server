import Router from 'koa-router';
import {
    adminMiddleware,
    authMiddleware,
    optionalAuthMiddleware,
} from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Feedback, User } from '../models/mongodb';
import { Roles } from '../constants/roles';
import { Upload } from '../models/mongodb';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { buildUpdatedBy } from '../utils/audit';
import { ErrorCodes } from '../utils/error-codes';
import { getUserDisplayName } from '../utils/user-display';

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
router.post('/', optionalAuthMiddleware, async (ctx) => {
    try {
        // 如果有登录用户则使用登录用户，否则使用 guest 用户作为默认提交者
        let userId = (ctx as any).state.user?.id;
        if (!userId) {
            // 尝试查找 guest 用户
            const guest = await User.findOne({ username: 'guest' });
            if (guest) userId = guest._id;
        }

        const { typeId, urgencyId, title, description, contact, images } = ctx
            .request.body as any;

        if (!typeId || !title || !description) {
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        // 支持 numeric (1..4) 或 string ('suggestion'...) 的 typeId 与 urgencyId
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
        const u = urgencyId ? urgencyMap[urgencyId] || undefined : undefined;

        const feedback = await Feedback.create({
            userId,
            typeId: t,
            typeName: typeNameMap[t] || '',
            urgencyId: u,
            urgencyName: u ? urgencyNameMap[u] : undefined,
            title,
            description,
            contact,
            images: images ?? [],
            status: FeedbackStatus.PENDING,
        });

        const feedbackWithUser = await Feedback.findById(feedback._id).populate(
            'userId',
            'name avatar studentId username'
        );

        ctx.body = {
            success: true,
            data: {
                id: feedbackWithUser?._id,
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
                'id typeId urgencyId title description images status reply replyAt createdAt comments'
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
                    commentsCount: (fb.comments || []).length,
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
 * @route GET /api/feedback/list
 * @desc 管理员获取全部反馈（分页）
 * 权限：仅 `admin` 可访问
 */
router.get('/list', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const page = parseInt((ctx.query.page as string) || '1');
        const limit = parseInt((ctx.query.limit as string) || '20');

        const total = await Feedback.countDocuments();

        const feedbacks = await Feedback.find()
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('userId', 'name avatar studentId username')
            .populate('updatedBy', 'name username')
            .select(
                'id userId typeId typeName urgencyId urgencyName title description images status reply replyAt createdAt updatedBy comments'
            );

        ctx.body = {
            success: true,
            data: {
                feedbacks: feedbacks.map((fb: any) => ({
                    id: fb._id,
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
                    replyAt: fb.replyAt,
                    commentsCount: (fb.comments || []).length,
                    createdAt: fb.createdAt,
                    updatedBy: fb.updatedBy?._id || fb.updatedBy,
                    updatedByName: getUserDisplayName(fb.updatedBy as any),
                })),
                total,
                page,
                limit,
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
        const userId = (ctx as any).state.user.id;
        const currentUser = (ctx as any).state.user;
        const feedbackId = ctx.params.id;

        const feedback = await Feedback.findById(feedbackId).populate(
            'userId',
            'name avatar studentId username'
        );

        if (!feedback) {
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );
        }

        // 权限检查：只能查看自己的反馈（管理员除外）
        const ownerId =
            typeof feedback.userId === 'object' && (feedback.userId as any)?._id
                ? String((feedback.userId as any)._id)
                : String(feedback.userId || '');
        if (ownerId !== userId && currentUser?.role !== Roles.ADMIN) {
            throw new CustomError('Access denied', ErrorCodes.FORBIDDEN);
        }

        let updatedByName: string | undefined;
        let updatedByValue: any = feedback.updatedBy;
        if (feedback.updatedBy) {
            try {
                const updatedByUser = await User.findById(feedback.updatedBy)
                    .select('name username')
                    .lean();
                updatedByName = getUserDisplayName(updatedByUser as any);
                updatedByValue = updatedByUser?._id || feedback.updatedBy;
            } catch (error) {
                // ignore audit lookup errors
            }
        }

        ctx.body = {
            success: true,
            data: {
                id: feedback._id,
                userId: feedback.userId,
                userName: getUserDisplayName(feedback.userId as any),
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
                processedReason: feedback.processedReason,
                comments: feedback.comments || [],
                createdAt: feedback.createdAt,
                updatedAt: feedback.updatedAt,
                updatedBy: updatedByValue,
                updatedByName,
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

        const feedback = await Feedback.findById(id);
        if (!feedback)
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );

        const normalizedStatus = normalizeNumericEnum(status);
        if (normalizedStatus !== undefined) {
            feedback.status = normalizedStatus;
        } else if (reply && feedback.status === FeedbackStatus.PENDING) {
            feedback.status = FeedbackStatus.PROCESSING;
        }
        if (reply) {
            feedback.reply = reply;
            feedback.repliedBy = user._id;
            feedback.replyAt = new Date();
            feedback.processedBy = user._id;
            feedback.processedAt = new Date();
        }

        Object.assign(feedback, buildUpdatedBy(ctx));

        await feedback.save();

        const updated = await Feedback.findById(id).populate(
            'userId',
            'name avatar studentId'
        );

        ctx.body = { success: true, data: updated };
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
            feedback.processedBy = user._id;
            feedback.processedAt = new Date();
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
        if (!content)
            throw new CustomError(
                'Missing required parameters',
                ErrorCodes.INVALID_PARAMS
            );

        const feedback = await Feedback.findById(id);
        if (!feedback)
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );

        const opName = operator || user?.name || 'system';
        const isOfficial = user?.role === Roles.ADMIN;

        const comment = {
            operator: opName,
            content,
            date: new Date(),
            isOfficial,
        };
        feedback.comments = feedback.comments || [];
        feedback.comments.push(comment as any);
        if (isOfficial && feedback.status === FeedbackStatus.PENDING) {
            feedback.status = FeedbackStatus.PROCESSING;
        }

        Object.assign(feedback, buildUpdatedBy(ctx));

        await feedback.save();

        ctx.body = {
            success: true,
            data: {
                commentId:
                    feedback.comments[feedback.comments.length - 1]._id || null,
                content,
                date: comment.date,
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
        const userId = (ctx as any).state.user.id;

        const id = ctx.params.id;
        const { url } = ctx.request.body as any;
        if (!url)
            throw new CustomError('Missing url', ErrorCodes.INVALID_PARAMS);

        const feedback = await Feedback.findById(id);
        if (!feedback)
            throw new CustomError(
                'Feedback not found',
                ErrorCodes.FEEDBACK_NOT_FOUND
            );

        feedback.images = (feedback.images || []).filter((u) => u !== url);
        Object.assign(feedback, buildUpdatedBy(ctx));
        await feedback.save();

        // 不要立即删除文件或元数据：仅解除该 Upload 与反馈的关联（清空 refType/refId），
        // 由管理员在上传管理页面统一确认并删除实际文件，避免误删未确认的图片。
        try {
            const uploadDoc = await Upload.findOne({ url });
            if (uploadDoc) {
                uploadDoc.refType = undefined;
                uploadDoc.refId = undefined;
                await uploadDoc.save();
            }
        } catch (e) {
            console.error('Failed to update upload doc', e);
        }

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
        const format = (ctx.query.format as string) || 'csv';
        const status = ctx.query.status as string | undefined;
        const startDate = ctx.query.startDate as string | undefined;
        const endDate = ctx.query.endDate as string | undefined;

        const filter: any = {};
        if (status) filter.status = status;
        if (startDate || endDate) filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);

        const feedbacks = await Feedback.find(filter)
            .populate('userId', 'name studentId avatar username')
            .sort({ createdAt: -1 });

        // Build CSV
        const headers = [
            'id',
            'type',
            'title',
            'description',
            'contact',
            'urgency',
            'status',
            'userId',
            'userName',
            'studentId',
            'createdAt',
        ];
        const rows = feedbacks.map((fb) => [
            fb._id.toString(),
            fb.typeName || fb.typeId,
            (fb.title || '').replace(/\n/g, ' '),
            (fb.description || '').replace(/\n/g, ' '),
            fb.contact || '',
            fb.urgencyName || fb.urgencyId || '',
            fb.status,
            fb.userId?._id?.toString() || '',
            getUserDisplayName(fb.userId as any) || '',
            fb.userId?.studentId || '',
            fb.createdAt ? fb.createdAt.toISOString() : '',
        ]);

        const escapeCsv = (val: any) => {
            if (val == null) return '';
            const s = String(val);
            if (s.includes(',') || s.includes('\n') || s.includes('"')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };

        const csv = [
            headers.join(','),
            ...rows.map((r) => r.map(escapeCsv).join(',')),
        ].join('\n');

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
