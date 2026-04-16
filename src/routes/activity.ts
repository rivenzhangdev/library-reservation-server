import Router from 'koa-router';
import { authMiddleware, ensureNotBlacklisted } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { Activity, CreditRecord, User } from '../models/mongodb';
import { ActivityStatus } from '../models/mysql/types';
import {
    getUserDisplayName,
    getUserDisplayNameFromMap,
} from '../utils/user-display';
import { ErrorCodes } from '../utils/error-codes';

const router = new Router({ prefix: '/api/activity' });

function resolveUserDisplayName(value: any, userMap: Record<string, any>) {
    if (!value) return undefined;
    if (typeof value === 'object') {
        return getUserDisplayName(value as any);
    }
    return getUserDisplayNameFromMap(value, userMap);
}

/**
 * @route GET /api/activity
 * @desc Get activity list interface
 */
router.get('/', async (ctx) => {
    try {
        const activities = await Activity.find()
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();

        const mapped = (activities || []).map((a: any) => ({
            ...a,
            createdByName: resolveUserDisplayName(a.createdBy, {}),
            updatedBy: a.updatedBy,
            updatedByName: resolveUserDisplayName(a.updatedBy, {}),
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
            createdByName: resolveUserDisplayName(a.createdBy, userMap),
            updatedBy: a.updatedBy,
            updatedByName: resolveUserDisplayName(a.updatedBy, userMap),
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
        const populatedActivity = await Activity.findById(activityId)
            .populate('createdBy', 'name username')
            .populate('updatedBy', 'name username')
            .lean();

        const mapped = {
            ...activity,
            createdByName: resolveUserDisplayName(
                populatedActivity?.createdBy,
                {}
            ),
            updatedBy: activity.updatedBy,
            updatedByName: resolveUserDisplayName(
                populatedActivity?.updatedBy,
                {}
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
        ensureNotBlacklisted(ctx);
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

/**
 * @route POST /api/activity/checkin/:id
 * @desc Activity sign-in interface
 */
router.post('/checkin/:id', authMiddleware, async (ctx) => {
    try {
        ensureNotBlacklisted(ctx);
        const activityId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);
        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        if (activity.status !== ActivityStatus.ONGOING) {
            const errorCode =
                activity.status === ActivityStatus.UPCOMING
                    ? ErrorCodes.ACTIVITY_NOT_STARTED
                    : ErrorCodes.ACTIVITY_ENDED;
            throw new CustomError(
                'Activity is not in sign-in state',
                errorCode
            );
        }

        const hasJoined = Array.isArray(activity.participants)
            ? activity.participants.some(
                  (participant: any) => String(participant) === String(userId)
              )
            : false;
        if (!hasJoined) {
            throw new CustomError(
                'You have not joined this activity',
                ErrorCodes.NOT_JOINED
            );
        }

        const checkedInList = Array.isArray(activity.checkedIn)
            ? activity.checkedIn
            : [];
        const alreadyCheckedIn = checkedInList.some(
            (participant: any) => String(participant) === String(userId)
        );
        if (alreadyCheckedIn) {
            ctx.body = {
                success: true,
                message: 'Already signed in',
            };
            return;
        }

        activity.checkedIn = checkedInList.concat(userId);
        await activity.save();

        await CreditRecord.create({
            userId,
            type: 0,
            points: 0,
            reason: 'Activity check-in',
            updatedBy: userId,
        });

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to sign in to activity',
            ErrorCodes.ACTIVITY_CHECKIN_ERROR
        );
    }
});

/**
 * @route POST /api/activity/checkout/:id
 * @desc Activity sign-out interface
 */
router.post('/checkout/:id', authMiddleware, async (ctx) => {
    try {
        ensureNotBlacklisted(ctx);
        const activityId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const activity = await Activity.findById(activityId);
        if (!activity) {
            throw new CustomError(
                'Activity not found',
                ErrorCodes.ACTIVITY_NOT_FOUND
            );
        }

        if (activity.status === ActivityStatus.UPCOMING) {
            throw new CustomError(
                'Activity is not started yet',
                ErrorCodes.ACTIVITY_NOT_STARTED
            );
        }

        const hasJoined = Array.isArray(activity.participants)
            ? activity.participants.some(
                  (participant: any) => String(participant) === String(userId)
              )
            : false;
        if (!hasJoined) {
            throw new CustomError(
                'You have not joined this activity',
                ErrorCodes.NOT_JOINED
            );
        }

        const checkedInList = Array.isArray(activity.checkedIn)
            ? activity.checkedIn
            : [];
        const alreadyCheckedIn = checkedInList.some(
            (participant: any) => String(participant) === String(userId)
        );
        if (!alreadyCheckedIn) {
            throw new CustomError(
                'You have not signed in yet',
                ErrorCodes.ACTIVITY_NOT_SIGNED_IN
            );
        }

        const checkedOutList = Array.isArray(activity.checkedOut)
            ? activity.checkedOut
            : [];
        const alreadyCheckedOut = checkedOutList.some(
            (participant: any) => String(participant) === String(userId)
        );
        if (alreadyCheckedOut) {
            ctx.body = {
                success: true,
                message: 'Already signed out',
            };
            return;
        }

        activity.checkedOut = checkedOutList.concat(userId);
        activity.checkedOutAt = new Date();
        await activity.save();

        ctx.body = {
            success: true,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to sign out of activity',
            ErrorCodes.ACTIVITY_CHECKOUT_ERROR
        );
    }
});

export default router;
