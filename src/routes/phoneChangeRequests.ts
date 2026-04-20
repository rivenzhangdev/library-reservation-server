import Router from 'koa-router';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Notification, User, PhoneChangeRequest } from '../models/mongodb';
import { getUserDisplayName } from '../utils/user-display';
import { maskPhone } from '../utils/mask';
import { ErrorCodes } from '../utils/error-codes';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/phone-change-requests' });

router.get('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const {
            status,
            q,
            page = '1',
            pageSize,
            limit = '20',
        } = ctx.query as any;

        const query: any = {};
        if (status) {
            query.status = String(status).trim();
        }
        if (q) {
            query.$or = [
                { newPhone: new RegExp(String(q).trim(), 'i') },
                { oldPhone: new RegExp(String(q).trim(), 'i') },
            ];
        }

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const normalizedPageSize = Math.max(
            parseInt(String(pageSize ?? limit), 10) || 20,
            1
        );

        const total = await PhoneChangeRequest.countDocuments(query);
        const requests = await PhoneChangeRequest.find(query)
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
        console.error('List phone change requests failed', error);
        throw new CustomError(
            'Failed to list phone change requests',
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

        const request = await PhoneChangeRequest.findById(id);
        if (!request) {
            throw new CustomError('Request not found', ErrorCodes.NOT_FOUND);
        }
        if (request.status !== 'pending') {
            throw new CustomError(
                'Only pending requests may be approved',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const duplicateUser = await User.findOne({
            phone: request.newPhone,
            _id: { $ne: request.userId },
        });
        if (duplicateUser) {
            throw new CustomError(
                'This phone number is already in use',
                ErrorCodes.PHONE_ALREADY_EXISTS
            );
        }

        const user = await User.findById(request.userId);
        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        user.phone = request.newPhone;
        await user.save();

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
            title: 'Phone change approved',
            content: `Your phone number has been updated to ${maskPhone(
                request.newPhone
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
        console.error('Approve phone change request failed', error);
        throw new CustomError(
            'Failed to approve phone change request',
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

        const request = await PhoneChangeRequest.findById(id);
        if (!request) {
            throw new CustomError('Request not found', ErrorCodes.NOT_FOUND);
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
            title: 'Phone change rejected',
            content: `Your phone change request has been rejected.${
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
        console.error('Reject phone change request failed', error);
        throw new CustomError(
            'Failed to reject phone change request',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

export default router;
