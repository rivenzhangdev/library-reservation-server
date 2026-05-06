import Router from 'koa-router';
import { authMiddleware, ensureNotBlacklisted } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { activityRouteDependencies } from '../services/activity-service';
import { ErrorCodes } from '../utils/error-codes';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const {
    listActivities,
    listActivitiesAdmin,
    getActivityById,
    joinActivity,
    cancelActivityRegistration,
    checkinActivity,
    checkoutActivity,
} = activityRouteDependencies;

const router = new Router({ prefix: '/api/activity' });

/**
 * @route GET /api/activity
 * @desc Get activity list interface
 */
router.get('/', async (ctx) => {
    try {
        const { page = '1', pageSize, limit } = ctx.query as any;
        const activities = await listActivities();
        const fullList = activities.map((item: any) =>
            formatRouteDateTimes(item)
        );
        const total = fullList.length;
        const safePage = Math.max(1, Number(page) || 1);
        const safePageSize = Math.max(
            1,
            Number(pageSize ?? limit ?? total ?? 1)
        );
        const list = fullList.slice(
            (safePage - 1) * safePageSize,
            safePage * safePageSize
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total,
                page: safePage,
                pageSize: safePageSize,
            },
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
 * @route GET /api/activity/list
 * @desc Get activity list (compat for admin)
 */
router.get('/list', async (ctx) => {
    try {
        const query = ctx.query as any;
        const page = Math.max(1, Number(query.current || query.page || 1));
        const pageSize = Math.max(
            1,
            Number(query.pageSize || query.limit || 20)
        );
        const timeRange = query.timeRange;
        const parsedTimeRange = Array.isArray(timeRange)
            ? timeRange
            : typeof timeRange === 'string'
              ? timeRange
                    .split(',')
                    .map((value: string) => value.trim())
                    .filter(Boolean)
              : [];
        const activities = await listActivitiesAdmin({
            page,
            pageSize,
            title: query.title,
            status: query.status,
            floorId: query.floorId,
            startTime: parsedTimeRange[0],
            endTime: parsedTimeRange[1],
        });
        const list = activities.list.map((item: any) =>
            formatRouteDateTimes(item)
        );
        ctx.body = {
            success: true,
            data: {
                list,
                total: activities.total,
                page: activities.page,
                pageSize: activities.pageSize,
            },
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
        const activity = await getActivityById(activityId);
        if (!activity) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                message: '活动不存在',
            };
            return;
        }

        const normalizedActivity =
            activity && typeof (activity as any).toObject === 'function'
                ? (activity as any).toObject()
                : activity;

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(normalizedActivity),
        };
    } catch (error: any) {
        console.error('获取活动详情失败:', error);
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

        await joinActivity(activityId, userId);

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

        await cancelActivityRegistration(activityId, userId);

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

        const result = await checkinActivity(activityId, userId);

        ctx.body = {
            success: true,
            alreadyCheckedIn: (result as any).alreadyCheckedIn,
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
        const activityId = ctx.params.id;
        const userId = (ctx as any).state.user.id;

        const result = await checkoutActivity(activityId, userId);

        ctx.body = {
            success: true,
            alreadyCheckedOut: (result as any).alreadyCheckedOut,
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
