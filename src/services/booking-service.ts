import { Op, Transaction } from 'sequelize';
import sequelize from '../database/mysql';
import { Notification, User, CreditRecord } from '../models/mongodb';
import { Booking, Seat, TimeSlotStatus } from '../models/mysql';
import { CustomError } from '../middleware/error';
import {
    BookingStatus,
    CreditType,
    TimeSlotStatusValue,
} from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import { CreditReasons } from '../constants/credit';
import {
    buildWechatTemplatePayload,
    wechatTemplateConfig,
} from '../utils/wechat-template-config';
import { getCreditRuleValues } from '../utils/credit-rule-config';
import { sendWechatSubscribeMessage } from '../utils/wechat';
import { getUserDisplayName } from '../utils/user-display';
import { getBookingRuleNumber } from '../routes/booking-rules';
import {
    getTimeSlotConfigItems,
    resolveTimeSlot,
} from '../utils/time-slot-config';
import {
    CHECKIN_WINDOW_MINUTES,
    getBookingEndMinutes,
    validateBookingTimeRange,
    isCheckinAllowed,
    isSameDay,
    parseLocalDate,
    parseTimeToMinutes,
} from '../utils/booking-rules';

export type BookingRequestInput = {
    seatId?: unknown;
    date?: unknown;
    timeSlot?: unknown;
    startTime?: unknown;
    endTime?: unknown;
};

export function validateBookingRequest(payload: BookingRequestInput): {
    seatId: number;
    date: string;
    timeSlot: string | number;
    startTime?: string;
    endTime?: string;
} {
    const seatIdRaw =
        typeof payload?.seatId === 'string'
            ? payload.seatId.trim()
            : payload?.seatId;
    const dateRaw =
        typeof payload?.date === 'string' ? payload.date.trim() : payload?.date;
    const timeSlotRaw =
        typeof payload?.timeSlot === 'string'
            ? payload.timeSlot.trim()
            : payload?.timeSlot;
    const startTimeRaw =
        typeof payload?.startTime === 'string'
            ? payload.startTime.trim()
            : payload?.startTime;
    const endTimeRaw =
        typeof payload?.endTime === 'string'
            ? payload.endTime.trim()
            : payload?.endTime;

    if (
        !seatIdRaw ||
        !dateRaw ||
        timeSlotRaw === undefined ||
        timeSlotRaw === null ||
        timeSlotRaw === ''
    ) {
        throw new CustomError(
            'Missing required parameters',
            ErrorCodes.INVALID_PARAMS
        );
    }

    const seatId = Number(seatIdRaw);
    if (!Number.isInteger(seatId) || seatId <= 0) {
        throw new CustomError('Invalid seatId', ErrorCodes.INVALID_PARAMS);
    }

    if (typeof dateRaw !== 'string' || !parseLocalDate(dateRaw)) {
        throw new CustomError('Invalid date', ErrorCodes.INVALID_PARAMS);
    }

    if (
        (startTimeRaw !== undefined && typeof startTimeRaw !== 'string') ||
        (endTimeRaw !== undefined && typeof endTimeRaw !== 'string')
    ) {
        throw new CustomError(
            'Invalid startTime or endTime',
            ErrorCodes.INVALID_PARAMS
        );
    }

    if ((startTimeRaw && !endTimeRaw) || (!startTimeRaw && endTimeRaw)) {
        throw new CustomError(
            'Start time and end time must both be provided for custom time',
            ErrorCodes.INVALID_PARAMS
        );
    }

    return {
        seatId,
        date: dateRaw,
        timeSlot: timeSlotRaw as string | number,
        startTime: startTimeRaw || undefined,
        endTime: endTimeRaw || undefined,
    };
}

export async function checkBookingPermissions(
    userId: string,
    options: {
        requireStudentId?: boolean;
        minCreditScore?: number;
        userModel?: typeof User;
    } = {}
): Promise<{ studentId?: string; creditScore: number }> {
    if (!userId) {
        throw new CustomError('Unauthorized', ErrorCodes.UNAUTHORIZED);
    }

    const userModel = options.userModel ?? User;
    const userQuery = userModel.findById(userId);
    let user: any;

    if (userQuery && typeof (userQuery as any).select === 'function') {
        const selected = (userQuery as any).select(
            '_id studentId creditScore blacklisted'
        );
        user =
            selected && typeof selected.lean === 'function'
                ? await selected.lean()
                : await selected;
    } else {
        user = await userQuery;
    }

    if (!user) {
        throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
    }

    if (user.blacklisted) {
        throw new CustomError(
            'Your account has been blacklisted',
            ErrorCodes.USER_BLACKLISTED
        );
    }

    const studentId = String(user.studentId ?? '').trim();
    if (options.requireStudentId && !studentId) {
        throw new CustomError(
            'Please bind your student ID before booking',
            ErrorCodes.FORBIDDEN
        );
    }

    const creditScore = Number(user.creditScore ?? 0);
    if (
        typeof options.minCreditScore === 'number' &&
        Number.isFinite(options.minCreditScore) &&
        creditScore < options.minCreditScore
    ) {
        throw new CustomError(
            'Insufficient credit score for booking',
            ErrorCodes.FORBIDDEN
        );
    }

    return {
        studentId: studentId || undefined,
        creditScore,
    };
}

export async function ensureViolationCreditRecord(
    booking: any,
    operatorId?: string
) {
    if (!booking?.id || !booking.userId) return;

    const existingRecord = await CreditRecord.findOne({
        bookingId: booking.id,
        type: 1,
    }).lean();
    if (existingRecord) return;

    const user = await User.findById(booking.userId);
    if (!user) return;

    const { violationDeductPoints } = await getCreditRuleValues();
    user.creditScore = Math.max(
        0,
        (user.creditScore ?? 100) - violationDeductPoints
    );
    await user.save();

    const violationRecord: any = {
        userId: booking.userId,
        bookingId: booking.id,
        type: 1,
        points: violationDeductPoints,
        reason: CreditReasons.VIOLATION_PENALTY,
    };
    if (operatorId && String(operatorId) !== String(booking.userId)) {
        violationRecord.updatedBy = operatorId;
    }

    await CreditRecord.create(violationRecord);
}

export async function releaseBookingTimeSlot(
    booking: any,
    transaction?: Transaction
) {
    if (!booking?.seatId || !booking.date) return;
    await TimeSlotStatus.update(
        { status: TimeSlotStatusValue.AVAILABLE, bookingId: undefined },
        {
            where: {
                seatId: booking.seatId,
                date: booking.date,
                timeSlot: booking.timeSlot,
            },
            transaction,
        }
    );
}

export async function performBookingCheckin(
    booking: any,
    userId: string,
    creditRecordModel = CreditRecord
): Promise<void> {
    if (!booking) {
        throw new Error('Booking not found');
    }
    if (booking.status !== BookingStatus.UPCOMING) {
        throw new Error('Check-in is not allowed for this booking');
    }
    if (!(await isCheckinAllowed(booking))) {
        throw new Error(
            `Check-in is only allowed within ${CHECKIN_WINDOW_MINUTES} minutes before start and before the end time`
        );
    }
    await booking.update({
        status: BookingStatus.ONGOING,
    });
    await creditRecordModel.create({
        userId: booking.userId,
        bookingId: booking.id,
        type: 0,
        points: 0,
        reason: CreditReasons.BOOKING_CHECKIN,
        updatedBy: userId,
    });
}

export async function performBookingCheckout(
    booking: any,
    userId: string,
    releaseFn = releaseBookingTimeSlot,
    expireFn = expireBookingIfNeeded
): Promise<void> {
    if (!booking) {
        throw new Error('Booking not found');
    }
    if (booking.status !== BookingStatus.ONGOING) {
        throw new Error('Check-out is not allowed for this booking');
    }
    if (await isBookingOverdue(booking)) {
        await expireFn(booking);
        throw new Error(
            'Booking has expired and is marked as violated; check-out is not allowed'
        );
    }
    await booking.update({
        status: BookingStatus.COMPLETED,
    });

    const user = await User.findById(booking.userId);
    if (user) {
        const { bookingCheckoutRewardPoints } = await getCreditRuleValues();
        const currentScore = Number(user.creditScore ?? 100);
        const rewardPoints = Math.max(
            0,
            Math.min(bookingCheckoutRewardPoints, 100 - currentScore)
        );
        if (rewardPoints > 0) {
            user.creditScore = currentScore + rewardPoints;
            await user.save();
            await CreditRecord.create({
                userId: booking.userId,
                bookingId: booking.id,
                type: CreditType.ADD,
                points: rewardPoints,
                reason: CreditReasons.BOOKING_CHECKOUT_REWARD,
                updatedBy: userId,
            });
        }
    }

    await releaseFn(booking);
}

export async function isBookingOverdue(booking: any): Promise<boolean> {
    if (!booking) return false;
    const now = new Date();
    const sameDay = isSameDay(String(booking.date), now);

    const bookingDate =
        parseLocalDate(String(booking.date)) ?? new Date(String(booking.date));
    if (Number.isNaN(bookingDate.getTime())) return false;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const checkDate = new Date(bookingDate);
    checkDate.setHours(0, 0, 0, 0);

    if (!sameDay) {
        if (checkDate.getTime() < todayStart.getTime()) {
            return true;
        }
        return false;
    }

    const endMinutes = await getBookingEndMinutes(booking);
    if (endMinutes === undefined) return false;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes > endMinutes;
}

export async function getBookingEndSlot(
    booking: any
): Promise<number | undefined> {
    if (!booking) return undefined;
    const endMinutes = await getBookingEndMinutes(booking);
    if (endMinutes === undefined) return undefined;

    const configs = await getTimeSlotConfigItems();
    for (const config of configs) {
        const startMinutes = parseTimeToMinutes(config.startTime);
        const endSlotMinutes = parseTimeToMinutes(config.endTime);
        if (startMinutes === undefined || endSlotMinutes === undefined) {
            continue;
        }
        if (endMinutes > startMinutes && endMinutes <= endSlotMinutes) {
            return config.timeSlot;
        }
    }

    if (Number.isFinite(booking.timeSlot)) {
        return booking.timeSlot;
    }
    return undefined;
}

export async function buildRenewBookingData(
    booking: any,
    timeSlot: number,
    validateFn: typeof validateBookingTimeRange = validateBookingTimeRange
): Promise<{
    date: Date;
    timeSlot: number;
    startTime?: string;
    endTime?: string;
}> {
    const bookingDateString =
        typeof booking.date === 'string'
            ? booking.date
            : new Date(booking.date).toISOString().split('T')[0];
    const bookingDate = new Date(bookingDateString);

    const { startTime, endTime } = await validateFn({
        date: bookingDateString,
        timeSlot,
    });

    return {
        date: bookingDate,
        timeSlot,
        startTime,
        endTime,
    };
}

export async function performBookingRenew(
    booking: any,
    requestTimeSlot: any,
    ctx: any,
    options: {
        resolveTimeSlot?: (value: any) => Promise<number | undefined>;
        validateBookingTimeRange?: typeof validateBookingTimeRange;
        bookingModel?: typeof Booking;
        timeSlotStatusModel?: typeof TimeSlotStatus;
        transactionProvider?: (
            callback: (t: Transaction) => Promise<any>
        ) => Promise<any>;
        releaseFn?: typeof releaseBookingTimeSlot;
        buildAuditFieldsFn?: typeof buildAuditFields;
        buildUpdatedByFn?: typeof buildUpdatedBy;
    } = {}
): Promise<any> {
    const resolveTimeSlotFn = options.resolveTimeSlot ?? resolveTimeSlot;
    const validateFn =
        options.validateBookingTimeRange ?? validateBookingTimeRange;
    const timeSlotStatusModel = options.timeSlotStatusModel ?? TimeSlotStatus;
    const transactionProvider =
        options.transactionProvider ??
        ((callback: (t: Transaction) => Promise<any>) =>
            sequelize.transaction(callback));
    const buildUpdatedByFn = options.buildUpdatedByFn ?? buildUpdatedBy;

    const normalizedTimeSlot = await resolveTimeSlotFn(requestTimeSlot);
    if (normalizedTimeSlot === undefined) {
        throw new Error('Invalid timeSlot');
    }

    const currentEndSlot = await getBookingEndSlot(booking);
    if (currentEndSlot === undefined) {
        throw new Error('Cannot determine current booking end slot');
    }
    if (normalizedTimeSlot === currentEndSlot) {
        throw new Error('Cannot renew to the same time slot');
    }
    if (normalizedTimeSlot < currentEndSlot) {
        throw new Error('Renewal must move to a later time slot');
    }
    if (booking.status !== BookingStatus.UPCOMING) {
        throw new CustomError(
            'Only upcoming bookings can be renewed',
            ErrorCodes.RENEW_BOOKING_ERROR
        );
    }

    const renewalLimit = await getBookingRuleNumber('renewal.maxExtraSlots', 1);
    const existingStatuses = await timeSlotStatusModel.findAll({
        where: {
            bookingId: booking.id,
        },
    });
    const existingExtraSlots = Math.max(0, existingStatuses.length - 1);
    const newExtraSlots = normalizedTimeSlot - currentEndSlot;
    if (existingExtraSlots + newExtraSlots > renewalLimit) {
        throw new CustomError(
            'Renewal limit exceeded',
            ErrorCodes.RENEWAL_LIMIT_EXCEEDED
        );
    }

    const renewalData = await buildRenewBookingData(
        booking,
        normalizedTimeSlot,
        validateFn
    );

    const newBooking = await transactionProvider(async (t) => {
        const slotsToBook: number[] = [];
        for (
            let slot = currentEndSlot + 1;
            slot <= normalizedTimeSlot;
            slot += 1
        ) {
            slotsToBook.push(slot);
        }

        const existingStatuses = await timeSlotStatusModel.findAll({
            where: {
                seatId: booking.seatId,
                date: renewalData.date,
                timeSlot: {
                    [Op.in]: slotsToBook,
                },
            },
            transaction: t,
        });

        for (const status of existingStatuses) {
            const sameBooking =
                status.bookingId !== undefined &&
                String(status.bookingId) === String(booking.id);
            if (sameBooking) {
                continue;
            }
            if (status.status === TimeSlotStatusValue.BOOKED) {
                throw new Error('This time slot has been booked');
            }
            if (status.status === TimeSlotStatusValue.MAINTENANCE) {
                throw new Error('This time slot is unavailable');
            }
        }

        const updatedBooking = await booking.update(
            {
                endTime: renewalData.endTime as any,
                ...buildUpdatedByFn(ctx),
            },
            { transaction: t }
        );

        for (const slot of slotsToBook) {
            await timeSlotStatusModel.upsert(
                {
                    seatId: booking.seatId,
                    date: renewalData.date,
                    timeSlot: slot,
                    status: TimeSlotStatusValue.BOOKED,
                    bookingId: booking.id,
                },
                { transaction: t }
            );
        }

        return updatedBooking;
    });

    return newBooking;
}

export async function expireBookingIfNeeded(
    booking: any,
    operatorId?: string
): Promise<boolean> {
    if (!booking) return false;
    if (
        ![BookingStatus.UPCOMING, BookingStatus.ONGOING].includes(
            booking.status
        )
    ) {
        return false;
    }

    const today = new Date();
    const bookingDate = new Date(booking.date);
    bookingDate.setHours(0, 0, 0, 0);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const datePassed = bookingDate.getTime() < todayStart.getTime();
    const sameDay = bookingDate.getTime() === todayStart.getTime();
    let expired = false;

    if (datePassed) {
        expired = true;
    } else if (sameDay) {
        const endMinutes = await getBookingEndMinutes(booking);
        if (endMinutes !== undefined) {
            const nowMinutes = today.getHours() * 60 + today.getMinutes();
            if (nowMinutes >= endMinutes) {
                expired = true;
            }
        }
    }

    if (!expired) return false;

    await booking.update({
        status: BookingStatus.VIOLATED,
        ...(operatorId ? { updatedBy: operatorId } : {}),
    });
    await releaseBookingTimeSlot(booking);
    await ensureViolationCreditRecord(booking, operatorId);
    return true;
}

export async function markUserExpiredBookings(
    userId: string,
    operatorId?: string
) {
    const bookings = await Booking.findAll({
        where: {
            userId: userId.toString(),
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
    });

    for (const booking of bookings) {
        await expireBookingIfNeeded(booking, operatorId);
    }
}

export async function markAllExpiredBookings() {
    const bookings = await Booking.findAll({
        where: {
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
    });

    for (const booking of bookings) {
        await expireBookingIfNeeded(booking);
    }
}

export const bookingRouteDependencies = {
    validateBookingRequest,
    checkBookingPermissions,
    performBookingCheckin,
    performBookingCheckout,
    performBookingRenew,
    expireBookingIfNeeded,
    markUserExpiredBookings,
    sequelizeTransaction: async (callback: (t: Transaction) => Promise<any>) =>
        sequelize.transaction(callback),
    markAllExpiredBookings,
    resolveTimeSlot,
    validateBookingTimeRange,
    getBookingEndSlot,
    buildWechatTemplatePayload,
    wechatTemplateConfig,
    sendWechatSubscribeMessage,
    getUserDisplayName,
    UserModel: User,
    Seat,
    TimeSlotStatus,
    Notification,
};
