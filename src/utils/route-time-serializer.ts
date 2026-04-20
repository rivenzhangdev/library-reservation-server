import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const DEFAULT_DATETIME_FIELDS = [
    'startTime',
    'endTime',
    'createdAt',
    'updatedAt',
    'replyAt',
    'processedAt',
    'checkedOutAt',
    'notifiedAt',
    'expireAt',
    'reviewedAt',
    'created_at',
    'updated_at',
] as const;

const DEFAULT_TIMEZONE_OFFSET_HOURS = Number(
    process.env.RESPONSE_TIMEZONE_OFFSET_HOURS ?? 8
);

function isValidOffset(value: number): boolean {
    return Number.isFinite(value) && value >= -12 && value <= 14;
}

function toSerializableObject(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (typeof value.toJSON === 'function') {
        return value.toJSON();
    }
    return value;
}

export function formatRouteDateTime(value: any): any {
    if (value === undefined || value === null || value === '') return value;

    const parsed = dayjs(value);
    if (!parsed.isValid()) return value;

    const offset = isValidOffset(DEFAULT_TIMEZONE_OFFSET_HOURS)
        ? DEFAULT_TIMEZONE_OFFSET_HOURS
        : 8;

    return parsed.utcOffset(offset).format('YYYY-MM-DD HH:mm:ss');
}

export function formatRouteDateTimes<T>(
    value: T,
    extraDateTimeFields: string[] = []
): T {
    const fields = new Set<string>([
        ...DEFAULT_DATETIME_FIELDS,
        ...extraDateTimeFields,
    ]);
    const cache = new WeakMap<object, any>();

    const walk = (input: any): any => {
        const current = toSerializableObject(input);

        if (Array.isArray(current)) {
            if (cache.has(current)) {
                return cache.get(current);
            }
            const arr: any[] = [];
            cache.set(current, arr);
            current.forEach((item) => arr.push(walk(item)));
            return arr;
        }

        if (!current || typeof current !== 'object') {
            return current;
        }

        if (cache.has(current)) {
            return cache.get(current);
        }

        const result: Record<string, any> = {};
        cache.set(current, result);

        Object.entries(current).forEach(([key, rawValue]) => {
            if (fields.has(key)) {
                result[key] = formatRouteDateTime(rawValue);
                return;
            }
            result[key] = walk(rawValue);
        });

        return result;
    };

    return walk(value) as T;
}
