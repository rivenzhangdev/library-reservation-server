import { SeatStatus, TimeSlotStatusValue } from '../models/mysql/types';

type TimeSlotStatusKey = 'morning' | 'afternoon' | 'evening';

const TIME_SLOT_KEY_MAP: Record<string, TimeSlotStatusKey> = {
    '0': 'morning',
    '1': 'afternoon',
    '2': 'evening',
    morning: 'morning',
    afternoon: 'afternoon',
    evening: 'evening',
};

export function normalizeSeatStatus(value: any): SeatStatus {
    const key = String(value ?? '');

    if (key === '1' || key === 'maintenance') {
        return SeatStatus.MAINTENANCE;
    }

    return SeatStatus.AVAILABLE;
}

export function normalizeTimeSlotStatus(
    value: any,
    fallback: TimeSlotStatusValue = TimeSlotStatusValue.AVAILABLE
): TimeSlotStatusValue {
    const key = String(value ?? '');

    if (key === '2' || key === 'maintenance') {
        return TimeSlotStatusValue.MAINTENANCE;
    }

    if (key === '1' || key === 'booked') {
        return TimeSlotStatusValue.BOOKED;
    }

    if (key === '0' || key === 'available') {
        return TimeSlotStatusValue.AVAILABLE;
    }

    return fallback;
}

export function getSeatDefaultTimeSlotStatus(
    seatStatus: any
): TimeSlotStatusValue {
    return normalizeSeatStatus(seatStatus) === SeatStatus.MAINTENANCE
        ? TimeSlotStatusValue.MAINTENANCE
        : TimeSlotStatusValue.AVAILABLE;
}

export function getSeatAvailabilityStatus(
    seatStatus: any,
    slotStatus?: any
): TimeSlotStatusValue {
    const fallback = getSeatDefaultTimeSlotStatus(seatStatus);

    if (slotStatus === undefined || slotStatus === null) {
        return fallback;
    }

    return normalizeTimeSlotStatus(slotStatus, fallback);
}

export function createTimeSlotStatusMap(
    seatStatus: any
): Record<TimeSlotStatusKey, TimeSlotStatusValue> {
    const fallback = getSeatDefaultTimeSlotStatus(seatStatus);

    return {
        morning: fallback,
        afternoon: fallback,
        evening: fallback,
    };
}

export function assignTimeSlotStatus(
    target: Record<TimeSlotStatusKey, TimeSlotStatusValue>,
    timeSlot: any,
    status: any
) {
    const key = TIME_SLOT_KEY_MAP[String(timeSlot ?? '')];
    if (!key) return;

    target[key] = normalizeTimeSlotStatus(status, target[key]);
}
