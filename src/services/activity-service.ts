import { Activity, CreditRecord, User } from '../models/mongodb';
import { ActivityStatus, CreditType } from '../models/mysql/types';
import {
    getUserDisplayName,
    getUserDisplayNameFromMap,
} from '../utils/user-display';
import { ErrorCodes } from '../utils/error-codes';
import { CreditReasons } from '../constants/credit';
import { getCreditRuleValues } from '../utils/credit-rule-config';
import { CustomError } from '../middleware/error';

export function resolveUserDisplayName(
    value: any,
    userMap: Record<string, any>
) {
    if (!value) return undefined;
    if (typeof value === 'object') {
        return getUserDisplayName(value as any);
    }
    return getUserDisplayNameFromMap(value, userMap);
}

function resolveActivityStatusByTime(activity: any, now = new Date()) {
    if (!activity) return undefined;
    const startTime = new Date(activity.startTime);
    const endTime = new Date(activity.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        return activity.status;
    }

    if (now >= endTime) {
        return ActivityStatus.ENDED;
    }
    if (now >= startTime) {
        return ActivityStatus.ONGOING;
    }
    return ActivityStatus.UPCOMING;
}

export async function refreshActivityStatuses(now = new Date()) {
    await Activity.updateMany(
        {
            status: ActivityStatus.UPCOMING,
            startTime: { $lte: now },
            endTime: { $gt: now },
        },
        { $set: { status: ActivityStatus.ONGOING } }
    );

    await Activity.updateMany(
        {
            status: { $in: [ActivityStatus.UPCOMING, ActivityStatus.ONGOING] },
            endTime: { $lte: now },
        },
        { $set: { status: ActivityStatus.ENDED } }
    );
}

export async function refreshActivityStatusesSafely(now = new Date()) {
    await refreshActivityStatuses(now);
}

export function startActivityStatusRefreshTask(intervalMinutes = 1) {
    const parsedInterval = Number(intervalMinutes);
    if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
        return null;
    }

    const intervalMs = Math.max(1000, Math.floor(parsedInterval * 60 * 1000));
    const timer = setInterval(() => {
        void refreshActivityStatusesSafely().catch((error) => {
            console.error('Failed to refresh activity statuses:', error);
        });
    }, intervalMs);

    return timer;
}

async function ensureActivityStatusCurrent(activity: any, now = new Date()) {
    const expectedStatus = resolveActivityStatusByTime(activity, now);
    if (expectedStatus === undefined) return activity;
    if (activity.status === expectedStatus) return activity;

    activity.status = expectedStatus;
    await activity.save();
    return activity;
}

function normalizeActivity(activity: any, userMap: Record<string, any>) {
    return {
        ...activity,
        id: String(activity?._id || activity?.id),
        createdByName: resolveUserDisplayName(activity?.createdBy, userMap),
        updatedByName: resolveUserDisplayName(activity?.updatedBy, userMap),
    };
}

export async function listActivities() {
    await refreshActivityStatuses();
    const activities = await Activity.find()
        .populate('createdBy', 'name username')
        .populate('updatedBy', 'name username')
        .lean();

    return (activities || []).map((activity: any) =>
        normalizeActivity(activity, {})
    );
}

export async function listActivitiesAdmin(params: {
    page?: number;
    pageSize?: number;
    title?: string;
    status?: string | number;
    floorId?: string;
    startTime?: string;
    endTime?: string;
}) {
    await refreshActivityStatuses();
    const page = Math.max(1, Number(params?.page || 1));
    const pageSize = Math.max(1, Number(params?.pageSize || 20));

    const filter: any = {};
    if (params?.title) {
        filter.title = { $regex: String(params.title), $options: 'i' };
    }
    if (params?.status !== undefined && params.status !== '') {
        filter.status = Number(params.status);
    }
    if (params?.floorId) {
        filter.floorId = params.floorId;
    }
    if (params?.startTime || params?.endTime) {
        filter.startTime = {};
        if (params?.startTime) {
            filter.startTime.$gte = new Date(params.startTime);
        }
        if (params?.endTime) {
            filter.startTime.$lte = new Date(params.endTime);
        }
    }

    const total = await Activity.countDocuments(filter);
    const activities = await Activity.find(filter)
        .sort({ startTime: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean();

    const userIds = Array.from(
        new Set(
            activities
                .flatMap((activity: any) => [
                    activity.createdBy,
                    activity.updatedBy,
                ])
                .filter(Boolean)
                .map((id: any) => String(id))
        )
    );

    const userMap: Record<string, any> = {};
    if (userIds.length) {
        const users = await User.find({ _id: { $in: userIds } })
            .select('name username')
            .lean();
        users.forEach((user: any) => {
            userMap[String(user._id)] = user;
        });
    }

    return {
        list: (activities || []).map((activity: any) =>
            normalizeActivity(activity, userMap)
        ),
        total,
        page,
        pageSize,
    };
}

export async function getActivityById(activityId: string) {
    const activityDoc = await Activity.findById(activityId);
    if (!activityDoc) return null;
    await ensureActivityStatusCurrent(activityDoc);

    const activity =
        typeof (activityDoc as any).toObject === 'function'
            ? (activityDoc as any).toObject()
            : activityDoc;

    const populated = await Activity.findById(activityId)
        .populate('createdBy', 'name username')
        .populate('updatedBy', 'name username')
        .lean();

    return {
        ...activity,
        id: String((activity as any)._id || (activity as any).id),
        createdByName: resolveUserDisplayName(populated?.createdBy, {}),
        updatedByName: resolveUserDisplayName(populated?.updatedBy, {}),
    };
}

function ensureActivityExists(activity: any): asserts activity {
    if (!activity) {
        throw new CustomError(
            'Activity not found',
            ErrorCodes.ACTIVITY_NOT_FOUND
        );
    }
}

export async function joinActivity(activityId: string, userId: string) {
    const now = new Date();
    await refreshActivityStatuses(now);

    const updated = await Activity.findOneAndUpdate(
        {
            _id: activityId,
            status: ActivityStatus.UPCOMING,
            startTime: { $gt: now },
            endTime: { $gt: now },
            participants: { $ne: userId },
            $expr: {
                $lt: [
                    { $size: { $ifNull: ['$participants', []] } },
                    '$maxParticipants',
                ],
            },
        },
        {
            $addToSet: { participants: userId },
        },
        {
            new: true,
        }
    );

    if (updated) {
        return;
    }

    const activity = await Activity.findById(activityId);
    ensureActivityExists(activity);
    await ensureActivityStatusCurrent(activity, now);

    const hasJoined = Array.isArray(activity.participants)
        ? activity.participants.some(
              (participant: any) => String(participant) === String(userId)
          )
        : false;
    if (hasJoined) {
        throw new CustomError(
            'You have already joined this activity',
            ErrorCodes.ALREADY_JOINED
        );
    }

    if (activity.status !== ActivityStatus.UPCOMING) {
        const errorCode =
            activity.status === ActivityStatus.ONGOING
                ? ErrorCodes.ACTIVITY_IN_PROGRESS
                : ErrorCodes.ACTIVITY_ENDED;
        throw new CustomError('Activity is ongoing or ended', errorCode);
    }

    throw new CustomError('Activity is full', ErrorCodes.ACTIVITY_FULL);
}

export async function cancelActivityRegistration(
    activityId: string,
    userId: string
) {
    const activity = await Activity.findById(activityId);
    ensureActivityExists(activity);
    await ensureActivityStatusCurrent(activity);

    const participantIndex = Array.isArray(activity.participants)
        ? activity.participants.findIndex(
              (participant: any) => String(participant) === String(userId)
          )
        : -1;

    if (participantIndex === -1) {
        throw new CustomError(
            'You have not joined this activity',
            ErrorCodes.NOT_JOINED
        );
    }

    activity.participants.splice(participantIndex, 1);
    await activity.save();
}

export async function checkinActivity(activityId: string, userId: string) {
    const activity = await Activity.findById(activityId);
    ensureActivityExists(activity);
    await ensureActivityStatusCurrent(activity);

    if (activity.status !== ActivityStatus.ONGOING) {
        const errorCode =
            activity.status === ActivityStatus.UPCOMING
                ? ErrorCodes.ACTIVITY_NOT_STARTED
                : ErrorCodes.ACTIVITY_ENDED;
        throw new CustomError('Activity is not in sign-in state', errorCode);
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

    const checkedIn: any[] = Array.isArray(activity.checkedIn)
        ? [...activity.checkedIn]
        : [];
    const alreadyCheckedIn = checkedIn.some(
        (participant: any) => String(participant) === String(userId)
    );
    if (alreadyCheckedIn) {
        return { alreadyCheckedIn: true };
    }

    activity.checkedIn = checkedIn;
    activity.checkedIn.push(userId as any);
    await activity.save();

    await CreditRecord.create({
        userId,
        type: CreditType.ADD,
        points: 0,
        reason: CreditReasons.ACTIVITY_CHECKIN,
        updatedBy: userId,
    });

    return { alreadyCheckedIn: false };
}

export async function checkoutActivity(activityId: string, userId: string) {
    const activity = await Activity.findById(activityId);
    ensureActivityExists(activity);
    await ensureActivityStatusCurrent(activity);
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

    const checkedIn: any[] = Array.isArray(activity.checkedIn)
        ? [...activity.checkedIn]
        : [];
    const alreadyCheckedIn = checkedIn.some(
        (participant: any) => String(participant) === String(userId)
    );
    if (!alreadyCheckedIn) {
        throw new CustomError(
            'You have not signed in yet',
            ErrorCodes.ACTIVITY_NOT_SIGNED_IN
        );
    }

    const checkedOut: any[] = Array.isArray(activity.checkedOut)
        ? [...activity.checkedOut]
        : [];
    const alreadyCheckedOut = checkedOut.some(
        (participant: any) => String(participant) === String(userId)
    );
    if (alreadyCheckedOut) {
        return { alreadyCheckedOut: true };
    }

    activity.checkedOut = checkedOut;
    activity.checkedOut.push(userId as any);
    activity.checkedOutAt = new Date();
    await activity.save();

    const user = await User.findById(userId);
    if (user) {
        const { activityCheckoutRewardPoints } = await getCreditRuleValues();
        const currentScore = Number(user.creditScore ?? 100);
        const rewardPoints = Math.max(
            0,
            Math.min(activityCheckoutRewardPoints, 100 - currentScore)
        );
        if (rewardPoints > 0) {
            user.creditScore = currentScore + rewardPoints;
            await user.save();
            await CreditRecord.create({
                userId,
                type: CreditType.ADD,
                points: rewardPoints,
                reason: CreditReasons.ACTIVITY_CHECKOUT_REWARD,
                updatedBy: userId,
            });
        }
    }

    return { alreadyCheckedOut: false };
}

export async function expireActivityIfNeeded(
    activity: any,
    operatorId?: string
): Promise<boolean> {
    if (!activity) return false;

    const now = new Date();
    const activityEnd = new Date(activity.endTime);
    if (now < activityEnd) return false;

    if (activity.status !== ActivityStatus.ENDED) {
        activity.status = ActivityStatus.ENDED;
        await activity.save();
    }

    const checkedInList = Array.isArray(activity.checkedIn)
        ? activity.checkedIn.map((item: any) => String(item))
        : [];
    const checkedOutList = Array.isArray(activity.checkedOut)
        ? activity.checkedOut.map((item: any) => String(item))
        : [];
    const missedCheckoutUserIds = checkedInList.filter(
        (userId: string) => !checkedOutList.includes(userId)
    );

    if (missedCheckoutUserIds.length === 0) {
        return false;
    }

    const { activityMissedCheckoutPenaltyPoints } = await getCreditRuleValues();
    for (const userId of missedCheckoutUserIds) {
        const user = await User.findById(userId);
        if (!user) continue;

        const penaltyPoints = Math.max(
            0,
            Math.min(
                activityMissedCheckoutPenaltyPoints,
                Number(user.creditScore ?? 100)
            )
        );

        user.creditScore = Math.max(
            0,
            Number(user.creditScore ?? 100) - penaltyPoints
        );
        await user.save();
        await CreditRecord.create({
            userId,
            type: penaltyPoints > 0 ? CreditType.DEDUCT : CreditType.ADD,
            points: penaltyPoints,
            reason: CreditReasons.ACTIVITY_MISSED_CHECKOUT,
            updatedBy: operatorId,
        });
    }

    return true;
}

export async function markAllExpiredActivities(): Promise<void> {
    const activities = await Activity.find({
        status: { $in: [ActivityStatus.UPCOMING, ActivityStatus.ONGOING] },
    });

    for (const activity of activities) {
        await expireActivityIfNeeded(activity);
    }
}

export const activityRouteDependencies = {
    listActivities,
    listActivitiesAdmin,
    getActivityById,
    joinActivity,
    cancelActivityRegistration,
    checkinActivity,
    checkoutActivity,
    expireActivityIfNeeded,
    markAllExpiredActivities,
    refreshActivityStatuses,
    refreshActivityStatusesSafely,
    startActivityStatusRefreshTask,
    Activity,
    User,
};
