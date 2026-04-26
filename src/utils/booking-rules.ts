import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import {
    getTimeSlotConfigItem,
    getTimeSlotConfigItems,
} from './time-slot-config';
import { TimeSlot } from '../models/mysql/types';

dayjs.extend(customParseFormat);

export const CHECKIN_WINDOW_MINUTES = Number(
    process.env.CHECKIN_WINDOW_MINUTES || 15
);
export const MIN_CUSTOM_BOOKING_DURATION_MINUTES = Number(
    process.env.MIN_CUSTOM_BOOKING_DURATION_MINUTES || 30
);

export function parseTimeToMinutes(time: string): number | undefined {
    if (!time || typeof time !== 'string') return undefined;
    const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) return undefined;
    return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutesToTime(totalMinutes: number): string {
    const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
        2,
        '0'
    )}`;
}

export type BookingTimeValidationResult = {
    startTime: string;
    endTime: string;
    isCustomTime: boolean;
};

export async function validateBookingTimeRange(options: {
    date: string;
    timeSlot: TimeSlot;
    startTime?: string;
    endTime?: string;
}): Promise<BookingTimeValidationResult> {
    const { date, timeSlot, startTime, endTime } = options;
    const isCustomTime = Boolean(startTime || endTime);

    if ((startTime && !endTime) || (!startTime && endTime)) {
        throw new CustomError(
            'Start time and end time must both be provided for custom time',
            ErrorCodes.INVALID_PARAMS
        );
    }

    const startMinutes = startTime ? parseTimeToMinutes(startTime) : undefined;
    const endMinutes = endTime ? parseTimeToMinutes(endTime) : undefined;

    if (startTime && startMinutes === undefined) {
        throw new CustomError(
            'Invalid startTime format',
            ErrorCodes.INVALID_PARAMS
        );
    }
    if (endTime && endMinutes === undefined) {
        throw new CustomError(
            'Invalid endTime format',
            ErrorCodes.INVALID_PARAMS
        );
    }

    if (
        startMinutes !== undefined &&
        endMinutes !== undefined &&
        endMinutes <= startMinutes
    ) {
        throw new CustomError(
            'End time must be after start time',
            ErrorCodes.INVALID_PARAMS
        );
    }

    if (
        isCustomTime &&
        startMinutes !== undefined &&
        endMinutes !== undefined &&
        endMinutes - startMinutes < MIN_CUSTOM_BOOKING_DURATION_MINUTES
    ) {
        throw new CustomError(
            `Custom time must be at least ${MIN_CUSTOM_BOOKING_DURATION_MINUTES} minutes`,
            ErrorCodes.INVALID_PARAMS
        );
    }

    if (!parseLocalDate(date)) {
        throw new CustomError('Invalid date', ErrorCodes.INVALID_PARAMS);
    }

    const slotRange = await getTimeSlotRange(timeSlot);
    const slotStartMinutes = parseTimeToMinutes(slotRange.start)!;
    const slotEndMinutes = parseTimeToMinutes(slotRange.end)!;
    const isToday = isSameDay(date, new Date());
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (startMinutes !== undefined) {
        if (startMinutes < slotStartMinutes || startMinutes >= slotEndMinutes) {
            throw new CustomError(
                'Start time is out of selected time slot range',
                ErrorCodes.INVALID_PARAMS
            );
        }
    }

    if (endMinutes !== undefined) {
        if (endMinutes <= slotStartMinutes || endMinutes > slotEndMinutes) {
            throw new CustomError(
                'End time is out of selected time slot range',
                ErrorCodes.INVALID_PARAMS
            );
        }
    }

    if (isBeforeToday(date)) {
        throw new CustomError(
            'Cannot book a date in the past',
            ErrorCodes.INVALID_PARAMS
        );
    }

    const pastTimeSlot = await isPastTimeSlot(date, timeSlot);
    if (pastTimeSlot) {
        throw new CustomError(
            'Cannot book a custom start time in the past',
            ErrorCodes.INVALID_PARAMS
        );
    }

    if (isToday && startMinutes !== undefined) {
        if (startMinutes < nowMinutes) {
            throw new CustomError(
                'Cannot book a custom time in the past',
                ErrorCodes.INVALID_PARAMS
            );
        }
    }

    if (!isCustomTime && isToday) {
        const adjustedStartMinutes = Math.max(slotStartMinutes, nowMinutes);
        return {
            startTime: formatMinutesToTime(adjustedStartMinutes),
            endTime: slotRange.end,
            isCustomTime: adjustedStartMinutes !== slotStartMinutes,
        };
    }

    return {
        startTime: isCustomTime ? String(startTime) : slotRange.start,
        endTime: isCustomTime ? String(endTime) : slotRange.end,
        isCustomTime,
    };
}

export async function getTimeSlotRange(
    timeSlot: TimeSlot | number
): Promise<{ start: string; end: string }> {
    const configs = await getTimeSlotConfigItems();
    const config = getTimeSlotConfigItem(timeSlot as TimeSlot, configs);
    return { start: config.startTime, end: config.endTime };
}

export function parseLocalDate(dateStr: string): Date | undefined {
    if (!dateStr || typeof dateStr !== 'string') {
        return undefined;
    }

    const trimmed = dateStr.trim();
    const parsedDateOnly = dayjs(trimmed, 'YYYY-MM-DD', true);
    if (parsedDateOnly.isValid()) {
        return parsedDateOnly.toDate();
    }

    const parsed = dayjs(trimmed);
    if (!parsed.isValid()) {
        return undefined;
    }

    return new Date(parsed.year(), parsed.month(), parsed.date());
}

export function isSameDay(dateStr: string, compareDate: Date): boolean {
    if (!dateStr || Number.isNaN(compareDate.getTime())) {
        return false;
    }

    const date = parseLocalDate(dateStr);
    if (!date || Number.isNaN(date.getTime())) {
        return false;
    }

    return (
        date.getFullYear() === compareDate.getFullYear() &&
        date.getMonth() === compareDate.getMonth() &&
        date.getDate() === compareDate.getDate()
    );
}

export function isBeforeToday(dateStr: string): boolean {
    const date = parseLocalDate(dateStr) || new Date(dateStr);
    if (!date || Number.isNaN(date.getTime())) {
        return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date.getTime() < today.getTime();
}

export async function isPastTimeSlot(
    dateStr: string,
    timeSlot: TimeSlot
): Promise<boolean> {
    if (!isSameDay(dateStr, new Date())) return false;
    const now = new Date();
    const range = await getTimeSlotRange(timeSlot);
    const endMinutes = parseTimeToMinutes(range.end);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return endMinutes !== undefined && nowMinutes >= endMinutes;
}

export async function getBookingStartMinutes(
    booking: any
): Promise<number | undefined> {
    if (booking.startTime) {
        return parseTimeToMinutes(String(booking.startTime));
    }
    const range = await getTimeSlotRange(booking.timeSlot);
    return parseTimeToMinutes(range.start);
}

export async function getBookingEndMinutes(
    booking: any
): Promise<number | undefined> {
    if (booking.endTime) {
        return parseTimeToMinutes(String(booking.endTime));
    }
    const range = await getTimeSlotRange(booking.timeSlot);
    return parseTimeToMinutes(range.end);
}

export async function isCheckinAllowed(
    booking: any,
    checkinWindowMinutes: number = CHECKIN_WINDOW_MINUTES
): Promise<boolean> {
    if (!booking || !isSameDay(String(booking.date), new Date())) return false;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = await getBookingStartMinutes(booking);
    const endMinutes = await getBookingEndMinutes(booking);
    if (startMinutes === undefined || endMinutes === undefined) return false;
    const earliestCheckin = Math.max(0, startMinutes - checkinWindowMinutes);
    return nowMinutes >= earliestCheckin && nowMinutes <= endMinutes;
}
