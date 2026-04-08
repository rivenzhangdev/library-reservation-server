import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Activity, User } from '../models/mongodb';
import { ActivityStatus } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/activity' });

function getUserDisplayName(value: any, userMap: Record<string, any>) {
    if (!value) return undefined;
    if (typeof value === 'object') {
        return value.username || value.name;
    }
    return (
        userMap[String(value)]?.username ||
        userMap[String(value)]?.name ||
        undefined
    );
}

/**
 * @route GET /api/activity
 * @desc Get activity list interface
 */
router.get('/', async (ctx) => {
    try {
        // Use non-populated fetch + manual lookup to maximize compatibility with legacy data
        const activities = await Activity.find().lean();

        const userIds = Array.from(
            new Set(
                activities
                    .flatMap((a: any) => [a.createdBy, a.updatedBy])
                    .filter(Boolean)
                    .map((x: any) => String(x))
            )
        );

        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const mapped = (activities || []).map((a: any) => ({
            ...a,
            createdByName: getUserDisplayName(a.createdBy, userMap),
            updatedBy: a.updatedBy,
            updatedByName: getUserDisplayName(a.updatedBy, userMap),
        }));

        ctx.body = {
            success: true,
            data: mapped,
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
 * @route GET /api/activity/list
 * @desc Get activity list (compat for admin)
 */
router.get('/list', async (ctx) => {
    try {
        // Same logic as root list: non-populated fetch + manual user lookup
        const activities = await Activity.find().lean();

        const userIds = Array.from(
            new Set(
                activities
                    .flatMap((a: any) => [a.createdBy, a.updatedBy])
                    .filter(Boolean)
                    .map((x: any) => String(x))
            )
        );

        const userMap: Record<string, any> = {};
        if (userIds.length) {
            const users = await User.find({ _id: { $in: userIds } })
                .select('name username')
                .lean();
            users.forEach((u: any) => (userMap[String(u._id)] = u));
        }

        const mapped = (activities || []).map((a: any) => ({
            ...a,
            createdByName: getUserDisplayName(a.createdBy, userMap),
            updatedBy: a.updatedBy,
            updatedByName: getUserDisplayName(a.updatedBy, userMap),
        }));

        ctx.body = {
            success: true,
            data: mapped,
        };
    } catch (error: any) {
        console.error('获取活动列表失败:', error);
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
        const activityId = ctx.params.id;
        const activity = await Activity.findById(activityId).lean();

        if (!activity) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                message: '活动不存在',
            };
            return;
        }

        const lookupIds = Array.from(
            new Set(
                [activity.createdBy, activity.updatedBy]
                    .filter(Boolean)
                    .map((x: any) => String(x))
            )
        );
        const users = lookupIds.length
            ? await User.find({ _id: { $in: lookupIds } })
                  .select('name username')
                  .lean()
            : [];
        const userMap: Record<string, any> = {};
        users.forEach((u: any) => (userMap[String(u._id)] = u));

        const mapped = {
            ...activity,
            createdByName: getUserDisplayName(
                (activity as any).createdBy,
                userMap
            ),
            updatedBy: activity.updatedBy,
            updatedByName: getUserDisplayName(
                (activity as any).updatedBy,
                userMap
            ),
        };

        ctx.body = {
            success: true,
            data: mapped,
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
        const activityId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);

        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        if (activity.status !== ActivityStatus.UPCOMING) {
            // status is numeric enum: 0:Upcoming, 1:Ongoing, 2:Ended
            const errorCode =
                activity.status === ActivityStatus.ONGOING
                    ? ErrorCodes.ACTIVITY_IN_PROGRESS
                    : ErrorCodes.ACTIVITY_ENDED;
            throw new CustomError('Activity is ongoing or ended', errorCode);
        }

        const hasJoined = activity.participants.some(
            (participant: any) => String(participant) === String(userId)
        );

        if (hasJoined) {
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
        const activityId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);

        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        const participantIndex = activity.participants.findIndex(
            (participant: any) => String(participant) === String(userId)
        );

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
