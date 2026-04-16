import {
    ActivityStatus,
    BookingStatus,
    CreditType,
    NotificationType,
    SeatType,
    TimeSlot,
} from '../models/mysql/types';

type EnumMap<T> = Record<string, T>;

function normalizeEnumString<T>(value: any, map: EnumMap<T>): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value as T;
    if (typeof value !== 'string') return undefined;

    const key = value.trim().toLowerCase();
    if (key === '') return undefined;

    const numeric = Number(key);
    if (!Number.isNaN(numeric)) return numeric as unknown as T;

    return map[key];
}

export function normalizeNumericEnum(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;

    const numeric = Number(value.trim());
    return Number.isNaN(numeric) ? undefined : numeric;
}

export function normalizeTimeSlot(value: any): TimeSlot | undefined {
    return normalizeEnumString(value, {
        '0': TimeSlot.MORNING,
        '1': TimeSlot.AFTERNOON,
        '2': TimeSlot.EVENING,
        morning: TimeSlot.MORNING,
        afternoon: TimeSlot.AFTERNOON,
        evening: TimeSlot.EVENING,
    }) as TimeSlot | undefined;
}

export function normalizeBookingStatus(value: any): BookingStatus | undefined {
    return normalizeEnumString(value, {
        '0': BookingStatus.UPCOMING,
        '1': BookingStatus.ONGOING,
        '2': BookingStatus.COMPLETED,
        '3': BookingStatus.CANCELED,
        '4': BookingStatus.VIOLATED,
        upcoming: BookingStatus.UPCOMING,
        ongoing: BookingStatus.ONGOING,
        completed: BookingStatus.COMPLETED,
        canceled: BookingStatus.CANCELED,
        cancelled: BookingStatus.CANCELED,
        violated: BookingStatus.VIOLATED,
    }) as BookingStatus | undefined;
}

export function normalizeActivityStatus(
    value: any
): ActivityStatus | undefined {
    return normalizeEnumString(value, {
        '0': ActivityStatus.UPCOMING,
        '1': ActivityStatus.ONGOING,
        '2': ActivityStatus.ENDED,
        upcoming: ActivityStatus.UPCOMING,
        ongoing: ActivityStatus.ONGOING,
        ended: ActivityStatus.ENDED,
    }) as ActivityStatus | undefined;
}

export function normalizeNotificationType(
    value: any
): NotificationType | undefined {
    return normalizeEnumString(value, {
        '0': NotificationType.SYSTEM,
        '1': NotificationType.BOOKING,
        '2': NotificationType.ACTIVITY,
        '3': NotificationType.MARKETING,
        system: NotificationType.SYSTEM,
        booking: NotificationType.BOOKING,
        activity: NotificationType.ACTIVITY,
        marketing: NotificationType.MARKETING,
    }) as NotificationType | undefined;
}

export function normalizeCreditType(value: any): CreditType | undefined {
    return normalizeEnumString(value, {
        '0': CreditType.ADD,
        '1': CreditType.DEDUCT,
        add: CreditType.ADD,
        deduct: CreditType.DEDUCT,
    }) as CreditType | undefined;
}

export function normalizeSeatType(value: any): SeatType | undefined {
    return normalizeEnumString(value, {
        '0': SeatType.SINGLE,
        '1': SeatType.DOUBLE,
        '2': SeatType.GROUP,
        single: SeatType.SINGLE,
        double: SeatType.DOUBLE,
        group: SeatType.GROUP,
    }) as SeatType | undefined;
}
