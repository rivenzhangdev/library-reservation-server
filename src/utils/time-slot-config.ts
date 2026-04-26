import { TimeSlotConfig } from '../models/mysql';
import { TimeSlot } from '../models/mysql/types';
import { normalizeTimeSlot } from './enum-normalizers';

export interface TimeSlotConfigItem {
    id?: number;
    timeSlot: TimeSlot;
    value: string;
    label: string;
    startTime: string;
    endTime: string;
    order: number;
    enabled: boolean;
}

function parseClockToMinutes(time: string): number {
    const text = String(time || '').trim();
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
        return Number.MAX_SAFE_INTEGER;
    }
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return Number.MAX_SAFE_INTEGER;
    }
    return hh * 60 + mm;
}

export const DEFAULT_TIME_SLOT_CONFIG: TimeSlotConfigItem[] = [
    {
        timeSlot: TimeSlot.MORNING,
        value: 'morning',
        label: '上午',
        startTime: '08:00',
        endTime: '12:00',
        order: 0,
        enabled: true,
    },
    {
        timeSlot: TimeSlot.AFTERNOON,
        value: 'afternoon',
        label: '下午',
        startTime: '13:00',
        endTime: '17:00',
        order: 1,
        enabled: true,
    },
    {
        timeSlot: TimeSlot.EVENING,
        value: 'evening',
        label: '晚上',
        startTime: '18:00',
        endTime: '22:00',
        order: 2,
        enabled: true,
    },
];

export async function getTimeSlotConfigItems(): Promise<TimeSlotConfigItem[]> {
    try {
        const configs = await TimeSlotConfig.findAll({
            where: { enabled: true },
            order: [
                ['order', 'ASC'],
                ['timeSlot', 'ASC'],
            ],
        });

        if (!configs || configs.length === 0) {
            return DEFAULT_TIME_SLOT_CONFIG;
        }

        return configs.map((config) => ({
            id: config.id,
            timeSlot: config.timeSlot,
            value: config.value,
            label: config.label,
            startTime: config.startTime,
            endTime: config.endTime,
            order: config.order,
            enabled: config.enabled,
        }));
    } catch (error) {
        return DEFAULT_TIME_SLOT_CONFIG;
    }
}

export function getChronologicalTimeSlots(
    configs: TimeSlotConfigItem[] = DEFAULT_TIME_SLOT_CONFIG
): number[] {
    return [...configs]
        .sort((a, b) => {
            const aStart = parseClockToMinutes(a.startTime);
            const bStart = parseClockToMinutes(b.startTime);
            if (aStart !== bStart) return aStart - bStart;
            if (a.order !== b.order) return a.order - b.order;
            return Number(a.timeSlot) - Number(b.timeSlot);
        })
        .map((item) => Number(item.timeSlot))
        .filter((slot) => Number.isInteger(slot))
        .filter((slot, index, array) => array.indexOf(slot) === index);
}

export function getTimeSlotConfigItem(
    timeSlot: TimeSlot,
    configs: TimeSlotConfigItem[] = DEFAULT_TIME_SLOT_CONFIG
): TimeSlotConfigItem {
    return (
        configs.find((config) => config.timeSlot === timeSlot) ||
        DEFAULT_TIME_SLOT_CONFIG.find((config) => config.timeSlot === timeSlot)!
    );
}

export function getTimeSlotConfigItemByValue(
    value: string,
    configs: TimeSlotConfigItem[] = DEFAULT_TIME_SLOT_CONFIG
): TimeSlotConfigItem | undefined {
    return configs.find((config) => config.value === value);
}

export async function resolveTimeSlot(
    value: any
): Promise<TimeSlot | undefined> {
    const normalized = normalizeTimeSlot(value);
    if (normalized !== undefined) {
        return normalized;
    }

    if (typeof value === 'string') {
        const configs = await getTimeSlotConfigItems();
        const configItem = getTimeSlotConfigItemByValue(value, configs);
        if (configItem) {
            return configItem.timeSlot;
        }
    }

    return undefined;
}
