import Router from 'koa-router';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import {
    Notification,
    StudentRegistry,
    User,
    StudentIdChangeRequest,
} from '../models/mongodb';
import { getUserDisplayName } from '../utils/user-display';
import { maskStudentId } from '../utils/mask';
import { ErrorCodes } from '../utils/error-codes';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/student-id-change-requests' });

router.post('/', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { newStudentId, newRealName, reason } = ctx.request.body as any;

        if (!newStudentId || !newRealName) {
            throw new CustomError(
                'New student ID and real name are required',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const normalizedStudentId = String(newStudentId).trim();
        const normalizedName = String(newRealName).trim();
        const normalizedReason = String(reason ?? '').trim();

        if (!normalizedStudentId || !normalizedName) {
            throw new CustomError(
                'New student ID and real name cannot be empty',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (!normalizedReason) {
            throw new CustomError(
                'Reason is required',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        if (!user.studentId) {
            throw new CustomError(
                'Please bind a student ID first before requesting a change',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (
            user.studentId === normalizedStudentId &&
            user.name === normalizedName
        ) {
            throw new CustomError(
                'Requested values must differ from current values',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const existingRequest = await StudentIdChangeRequest.findOne({
            userId,
            status: 'pending',
        });
        if (existingRequest) {
            throw new CustomError(
                'There is already a pending change request for this account',
                ErrorCodes.STUDENT_ID_CHANGE_REQUEST_EXISTS ??
                    ErrorCodes.INVALID_PARAMS
            );
        }

        const duplicateUser = await User.findOne({
            studentId: normalizedStudentId,
            _id: { $ne: userId },
        });
        if (duplicateUser) {
            throw new CustomError(
                'This student ID has already been bound by another user',
                ErrorCodes.STUDENT_ID_EXISTS
            );
        }

        const registryRecord = await StudentRegistry.findOne({
            studentId: normalizedStudentId,
            active: true,
        })
            .select('realName')
            .lean();

        if (!registryRecord) {
            throw new CustomError(
                'Student ID does not exist in registry',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const expectedName = String((registryRecord as any).realName ?? '')
            .trim()
            .replace(/\s+/g, '');
        if (expectedName !== normalizedName.replace(/\s+/g, '')) {
            throw new CustomError(
                'Real name does not match registry',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const request = new StudentIdChangeRequest({
            userId,
            requestType: 'change',
            oldStudentId: user.studentId,
            oldName: user.name,
            newStudentId: normalizedStudentId,
            newRealName: normalizedName,
            reason: normalizedReason,
            status: 'pending',
        });

        await request.save();

        // 创建通知记录，告知用户改绑申请已提交（非阻塞，失败不影响主流程）
        try {
            await Notification.create({
                userId: userId,
                createdBy: userId,
                updatedBy: userId,
                type: 0,
                title: 'Student ID change request submitted',
                content: `Your student ID change request has been submitted. Administrator will review it within 1-2 working days.`,
            });
        } catch (notifError: any) {
            console.error(
                'Failed to create notification for student ID change request',
                notifError
            );
            // 非阻塞：通知失败不影响改绑申请的保存
        }

        ctx.body = {
            success: true,
            data: {
                id: request._id,
                status: request.status,
                message:
                    'Request submitted successfully. You will receive a notification once administrator reviews it.',
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Create student ID change request failed', error);
        throw new CustomError(
            'Failed to submit student ID change request',
            ErrorCodes.STUDENT_ID_CHANGE_REQUEST_ERROR ??
                ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route GET /api/student-id-change-requests/my-pending
 * @desc Get current user's pending change request (miniprogram use)
 */
router.get('/my-pending', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const request = await StudentIdChangeRequest.findOne({
            userId,
            status: 'pending',
        })
            .sort({ createdAt: -1 })
            .lean();

        ctx.body = {
            success: true,
            data: request
                ? {
                      id: (request as any)._id,
                      status: request.status,
                      newStudentId: request.newStudentId,
                      newRealName: request.newRealName,
                      reason: request.reason,
                      createdAt: request.createdAt,
                  }
                : null,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Get my pending change request failed', error);
        throw new CustomError(
            'Failed to get pending request',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.get('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const {
            status,
            q,
            page = '1',
            pageSize,
            limit = '20',
            studentId,
            name,
        } = ctx.query as any;

        const query: any = {};
        if (status) {
            query.status = String(status).trim();
        }
        if (studentId) {
            query.newStudentId = String(studentId).trim();
        }
        if (name) {
            query.$or = [
                { newRealName: new RegExp(name, 'i') },
                { oldName: new RegExp(name, 'i') },
            ];
        }
        if (q) {
            query.$or = [
                { newStudentId: new RegExp(q, 'i') },
                { oldStudentId: new RegExp(q, 'i') },
                { newRealName: new RegExp(q, 'i') },
                { oldName: new RegExp(q, 'i') },
            ];
        }

        const pageNum = Math.max(parseInt(page, 10) ?? 1, 1);
        const normalizedPageSize = Math.max(
            parseInt(String(pageSize ?? limit), 10) ?? 20,
            1
        );

        const total = await StudentIdChangeRequest.countDocuments(query);
        const requests = await StudentIdChangeRequest.find(query)
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * normalizedPageSize)
            .limit(normalizedPageSize)
            .populate('userId', 'username name studentId')
            .lean();

        ctx.body = {
            success: true,
            data: {
                list: requests.map((item: any) => ({
                    ...formatRouteDateTimes({
                        ...item,
                        id: item._id,
                        userName:
                            getUserDisplayName(item.userId as any) ??
                            String(item.userId?.studentId ?? ''),
                    }),
                })),
                total,
                page: pageNum,
                pageSize: normalizedPageSize,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('List student ID change requests failed', error);
        throw new CustomError(
            'Failed to list student ID change requests',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/:id/approve', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { id } = ctx.params;
        const { reviewComment } = ctx.request.body as any;
        const reviewerName =
            (ctx as any).state.user.name ?? (ctx as any).state.user.username;
        const reviewerId = (ctx as any).state.user.id;

        const request = await StudentIdChangeRequest.findById(id);
        if (!request) {
            throw new CustomError(
                'Request not found',
                ErrorCodes.STUDENT_ID_CHANGE_REQUEST_NOT_FOUND ??
                    ErrorCodes.NOT_FOUND
            );
        }
        if (request.status !== 'pending') {
            throw new CustomError(
                'Only pending requests may be approved',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const duplicateUser = await User.findOne({
            studentId: request.newStudentId,
            _id: { $ne: request.userId },
        });

        const user = await User.findById(request.userId);
        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        // Admin approval means force transfer is allowed:
        // if target studentId is currently held by another account, unbind that holder first.
        if (duplicateUser) {
            duplicateUser.studentId = undefined;
            await duplicateUser.save();

            try {
                await Notification.create({
                    userId: duplicateUser._id,
                    createdBy: reviewerId,
                    updatedBy: reviewerId,
                    type: 0,
                    title: 'Student ID unbound by admin review',
                    content: `Your student ID ${maskStudentId(
                        request.newStudentId
                    )} has been unbound due to an approved binding change request. If this is unexpected, please contact administrator.`,
                    relatedId: request._id.toString(),
                });
            } catch (notificationError: any) {
                console.error(
                    'Notify previous holder failed',
                    notificationError
                );
            }
        }

        try {
            user.studentId = request.newStudentId;
            user.name = request.newRealName;
            await user.save();
        } catch (saveError: any) {
            if (saveError?.code === 11000) {
                throw new CustomError(
                    'Student ID conflict detected during approval, please retry',
                    ErrorCodes.STUDENT_ID_EXISTS
                );
            }
            throw saveError;
        }

        request.status = 'approved';
        request.reviewComment = String(reviewComment ?? '').trim();
        request.reviewedAt = new Date();
        request.reviewerId = reviewerId;
        request.reviewerName = reviewerName;
        await request.save();

        await Notification.create({
            userId: request.userId,
            createdBy: reviewerId,
            updatedBy: reviewerId,
            type: 0,
            title: 'Student ID change approved',
            content: `Your student ID has been updated to ${maskStudentId(
                request.newStudentId
            )}.`,
            relatedId: request._id.toString(),
        });

        ctx.body = {
            success: true,
            data: {
                id: request._id,
                status: request.status,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Approve student ID change request failed', error);
        throw new CustomError(
            'Failed to approve student ID change request',
            ErrorCodes.STUDENT_ID_CHANGE_REQUEST_APPROVE_ERROR ??
                ErrorCodes.INTERNAL_ERROR
        );
    }
});

router.put('/:id/reject', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { id } = ctx.params;
        const { reviewComment } = ctx.request.body as any;
        const reviewerName =
            (ctx as any).state.user.name ?? (ctx as any).state.user.username;
        const reviewerId = (ctx as any).state.user.id;

        const request = await StudentIdChangeRequest.findById(id);
        if (!request) {
            throw new CustomError(
                'Request not found',
                ErrorCodes.STUDENT_ID_CHANGE_REQUEST_NOT_FOUND ??
                    ErrorCodes.NOT_FOUND
            );
        }
        if (request.status !== 'pending') {
            throw new CustomError(
                'Only pending requests may be rejected',
                ErrorCodes.INVALID_PARAMS
            );
        }

        request.status = 'rejected';
        request.reviewComment = String(reviewComment ?? '').trim();
        request.reviewedAt = new Date();
        request.reviewerId = reviewerId;
        request.reviewerName = reviewerName;
        await request.save();

        await Notification.create({
            userId: request.userId,
            createdBy: reviewerId,
            updatedBy: reviewerId,
            type: 0,
            title: 'Student ID change rejected',
            content: `Your student ID change request has been rejected.${
                request.reviewComment ? ` Reason: ${request.reviewComment}` : ''
            }`,
            relatedId: request._id.toString(),
        });

        ctx.body = {
            success: true,
            data: {
                id: request._id,
                status: request.status,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Reject student ID change request failed', error);
        throw new CustomError(
            'Failed to reject student ID change request',
            ErrorCodes.STUDENT_ID_CHANGE_REQUEST_REJECT_ERROR ??
                ErrorCodes.INTERNAL_ERROR
        );
    }
});

export default router;
