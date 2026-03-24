import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Activity } from '../models/mongodb';
import { ActivityStatus } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/activity' });

/**
 * @route GET /api/activity
 * @desc Get activity list interface
 */
router.get('/', async (ctx) => {
    try {
        const activities = await Activity.findAll();

        ctx.body = {
            success: true,
            data: activities,
        };
    } catch (_error) {
        console.error('获取活动列表失败:', _error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            message: '获取活动列表失败',
        };
    }
});

/**
 * @route GET /api/activity/:id
 * @desc Get activity details interface
 */
router.get('/:id', async (ctx) => {
    try {
        const activityId = parseInt(ctx.params.id);
        const activity = await Activity.findById(activityId);

        if (!activity) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                message: '活动不存在',
            };
            return;
        }

        ctx.body = {
            success: true,
            data: activity,
        };
    } catch (_error) {
        console.error('获取活动详情失败:', _error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            message: '获取活动详情失败',
        };
    }
});

/**
 * @route POST /api/activity/join/:id
 * @desc Join activity interface
 */
router.post('/join/:id', authMiddleware, async (ctx) => {
    try {
        const activityId = parseInt(ctx.params.id);
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);

        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        if (activity.status !== ActivityStatus.REGISTERING) {
            // Use numeric enum
            // status is numeric enum: 0:Registering, 1:Ongoing, 2:Ended, 3:Cancelled
            const errorCode =
                activity.status === ActivityStatus.ONGOING
                    ? ErrorCodes.ACTIVITY_IN_PROGRESS
                    : ErrorCodes.ACTIVITY_ENDED;
            throw new CustomError('Activity is ongoing or ended', errorCode);
        }

        if (activity.participants.includes(userId)) {
            throw new CustomError(
                'You have already joined this activity',
                ErrorCodes.ALREADY_JOINED
            );
        }

        if (activity.participants.length >= activity.maxParticipants) {
            throw new CustomError('Activity is full', ErrorCodes.ACTIVITY_FULL);
        }

        activity.participants.push(userId);
        await activity.save();

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to join activity',
            ErrorCodes.JOIN_ACTIVITY_ERROR
        );
    }
});

/**
 * @route POST /api/activity/cancel/:id
 * @desc Cancel registration interface
 */
router.post('/cancel/:id', authMiddleware, async (ctx) => {
    try {
        const activityId = parseInt(ctx.params.id);
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);

        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        const participantIndex = activity.participants.indexOf(userId);

        if (participantIndex === -1) {
            throw new CustomError(
                'You have not joined this activity',
                ErrorCodes.NOT_JOINED
            );
        }

        activity.participants.splice(participantIndex, 1);
        await activity.save();

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to cancel registration',
            ErrorCodes.CANCEL_JOIN_ERROR
        );
    }
});

export default router;
