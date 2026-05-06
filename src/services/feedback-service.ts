import { Feedback, Upload, User } from '../models/mongodb';
import { buildUpdatedBy } from '../utils/audit';
import { getUserDisplayName } from '../utils/user-display';
import { ErrorCodes } from '../utils/error-codes';
import { FeedbackStatus } from '../constants/feedback';
import { Roles } from '../constants/roles';
import { normalizeNumericEnum } from '../utils/enum-normalizers';
import { CustomError } from '../middleware/error';

interface FeedbackListFilters {
    title?: string;
    typeId?: number;
    status?: number;
    urgencyId?: number;
}

function escapeCsvValue(val: any) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('\n') || s.includes('"')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function escapeRegExp(source: string) {
    return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function submitFeedback(payload: any, user: any) {
    const submitterId = payload?.userId || user?.id || user?._id;
    if (!submitterId) {
        throw new CustomError('Missing user', ErrorCodes.INVALID_PARAMS);
    }

    const feedback = await Feedback.create({
        ...payload,
        userId: submitterId,
        status: FeedbackStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: submitterId,
        updatedBy: submitterId,
    });
    return feedback;
}

export async function getUserFeedbacks(
    userId: string,
    page: number,
    limit: number
) {
    const skip = (page - 1) * limit;
    const total = await Feedback.countDocuments({ userId });
    const feedbacks = await Feedback.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    return { total, feedbacks };
}

export async function listFeedback(
    page: number,
    limit: number,
    filters: FeedbackListFilters = {}
) {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (filters.title) {
        query.title = {
            $regex: escapeRegExp(String(filters.title).trim()),
            $options: 'i',
        };
    }
    if (filters.typeId !== undefined) {
        query.typeId = filters.typeId;
    }
    if (filters.status !== undefined) {
        query.status = filters.status;
    }
    if (filters.urgencyId !== undefined) {
        query.urgencyId = filters.urgencyId;
    }

    const total = await Feedback.countDocuments(query);
    const feedbacks = await Feedback.find(query)
        .populate('userId', 'name studentId avatar username')
        .populate('updatedBy', 'name username')
        .populate('processedBy', 'name username')
        .populate('repliedBy', 'name username')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    return { total, feedbacks };
}

export async function getFeedbackDetail(id: string, user: any): Promise<any> {
    const filter: any = { _id: id };
    const requesterId = user?.id || user?._id;
    if (user?.role !== Roles.ADMIN) {
        filter.userId = requesterId;
    }

    const feedback = await Feedback.findOne(filter)
        .populate('userId', 'name studentId avatar username')
        .populate('updatedBy', 'name username')
        .lean();
    if (!feedback) {
        throw new CustomError(
            'Feedback not found',
            ErrorCodes.FEEDBACK_NOT_FOUND
        );
    }

    return {
        ...feedback,
        id: String((feedback as any)._id),
        userName: getUserDisplayName(feedback.userId as any),
        userDisplayName: getUserDisplayName(feedback.userId as any),
        updatedByName: getUserDisplayName((feedback as any).updatedBy as any),
    };
}

export async function processFeedback(
    id: string,
    status: string,
    remark: string,
    _user: any,
    ctx: any
) {
    if (!status) {
        throw new CustomError('Missing status', ErrorCodes.INVALID_PARAMS);
    }

    const normalizedStatus = normalizeNumericEnum(status);
    if (normalizedStatus === undefined) {
        throw new CustomError('Invalid status', ErrorCodes.INVALID_PARAMS);
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
        throw new CustomError(
            'Feedback not found',
            ErrorCodes.FEEDBACK_NOT_FOUND
        );
    }

    if (feedback.status === FeedbackStatus.RESOLVED) {
        throw new CustomError(
            'Feedback already resolved',
            ErrorCodes.FEEDBACK_ALREADY_RESOLVED
        );
    }

    feedback.status = normalizedStatus;
    feedback.remark = remark || feedback.remark;
    Object.assign(feedback, buildUpdatedBy(ctx));
    await feedback.save();

    return feedback;
}

export async function addFeedbackComment(
    id: string,
    content: string,
    operator: string | undefined,
    user: any,
    ctx: any
) {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
        throw new CustomError(
            'Missing comment content',
            ErrorCodes.INVALID_PARAMS
        );
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
        throw new CustomError(
            'Feedback not found',
            ErrorCodes.FEEDBACK_NOT_FOUND
        );
    }

    const isOfficial = user?.role === Roles.ADMIN;
    const requesterId = user?.id || user?._id;
    const feedbackOwnerId = feedback.userId ? String(feedback.userId) : '';
    if (
        !isOfficial &&
        (!requesterId || String(requesterId) !== feedbackOwnerId)
    ) {
        throw new CustomError(
            'No permission to comment this feedback',
            ErrorCodes.FORBIDDEN
        );
    }

    const opName = isOfficial
        ? operator || user?.name || 'system'
        : user?.name || user?.username || 'user';

    const comment = {
        operator: opName,
        content: normalizedContent,
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

    return {
        commentId:
            (feedback.comments[feedback.comments.length - 1] as any)._id ||
            null,
        content: normalizedContent,
        date: comment.date,
    };
}

export async function removeFeedbackImage(id: string, url: string, ctx: any) {
    if (!url) {
        throw new CustomError('Missing url', ErrorCodes.INVALID_PARAMS);
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
        throw new CustomError(
            'Feedback not found',
            ErrorCodes.FEEDBACK_NOT_FOUND
        );
    }

    feedback.images = (feedback.images || []).filter(
        (item: any) => item !== url
    );
    Object.assign(feedback, buildUpdatedBy(ctx));
    await feedback.save();

    const uploadDoc = await Upload.findOne({ url });
    if (uploadDoc) {
        uploadDoc.refType = undefined;
        uploadDoc.refId = undefined;
        await uploadDoc.save();
    }

    return true;
}

export async function exportFeedbacks(
    status?: string,
    startDate?: string,
    endDate?: string
) {
    const filter: any = {};
    if (status) filter.status = status;
    if (startDate || endDate) filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);

    const feedbacks = await Feedback.find(filter)
        .populate('userId', 'name studentId avatar username')
        .sort({ createdAt: -1 })
        .lean();

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

    const rows = feedbacks.map((fb: any) => [
        fb._id.toString(),
        fb.typeName || fb.typeId,
        (fb.title || '').replace(/\n/g, ' '),
        (fb.description || '').replace(/\n/g, ' '),
        fb.contact || '',
        fb.urgencyName || fb.urgencyId || '',
        fb.status,
        fb.userId?._id?.toString() || '',
        getUserDisplayName(fb.userId as any) || '',
        (fb.userId as any)?.studentId || '',
        fb.createdAt ? fb.createdAt.toISOString() : '',
    ]);

    const csv = [
        headers.join(','),
        ...rows.map((r) => r.map(escapeCsvValue).join(',')),
    ].join('\n');
    return csv;
}

export const feedbackRouteDependencies = {
    submitFeedback,
    getUserFeedbacks,
    listFeedback,
    getFeedbackDetail,
    processFeedback,
    addFeedbackComment,
    removeFeedbackImage,
    exportFeedbacks,
    Feedback,
    Upload,
    User,
};
