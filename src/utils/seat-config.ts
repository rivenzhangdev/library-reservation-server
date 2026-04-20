import { SeatTypeConfig, SeatFacilityConfig } from '../models/mysql';
import { SeatType } from '../models/mysql/types';

export interface SeatTypeConfigItem {
    id?: number;
    type: SeatType;
    value: string;
    label: string;
    icon: string;
    order: number;
    enabled: boolean;
}

export interface SeatFacilityConfigItem {
    id?: number;
    key: string;
    label: string;
    icon: string;
    order: number;
    enabled: boolean;
}

function getDefaultSeatTypeIcon(value: string) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'single') return 'location-o';
    if (normalized === 'double') return 'friends-o';
    if (normalized === 'group') return 'cluster-o';
    if (normalized === 'open') return 'passed';
    return 'search';
}

function getDefaultSeatFacilityIcon(key: string) {
    const normalized = String(key || '')
        .trim()
        .toLowerCase();
    if (['power', 'socket', 'hassocket', 'has_socket'].includes(normalized)) {
        return 'underway-o';
    }
    if (['window', 'iswindow', 'is_window'].includes(normalized)) {
        return 'photo-o';
    }
    return 'search';
}

export const DEFAULT_SEAT_TYPE_CONFIG: SeatTypeConfigItem[] = [
    {
        type: SeatType.SINGLE,
        value: 'single',
        label: 'Single',
        icon: 'location-o',
        order: 0,
        enabled: true,
    },
    {
        type: SeatType.DOUBLE,
        value: 'double',
        label: 'Double',
        icon: 'friends-o',
        order: 1,
        enabled: true,
    },
    {
        type: SeatType.GROUP,
        value: 'group',
        label: 'Group',
        icon: 'cluster-o',
        order: 2,
        enabled: true,
    },
];

export const DEFAULT_SEAT_FACILITY_CONFIG: SeatFacilityConfigItem[] = [
    {
        key: 'power',
        label: 'Socket',
        icon: 'underway-o',
        order: 0,
        enabled: true,
    },
    {
        key: 'window',
        label: 'Window seat',
        icon: 'photo-o',
        order: 1,
        enabled: true,
    },
];

export async function getSeatTypeConfigItems(): Promise<SeatTypeConfigItem[]> {
    try {
        const configs = await SeatTypeConfig.findAll({
            order: [
                ['order', 'ASC'],
                ['type', 'ASC'],
            ],
        });

        if (!configs || configs.length === 0) {
            return DEFAULT_SEAT_TYPE_CONFIG;
        }

        return configs.map((config) => ({
            id: config.id,
            type: config.type,
            value: config.value,
            label: config.label,
            icon: config.icon || getDefaultSeatTypeIcon(config.value),
            order: config.order,
            enabled: config.enabled,
        }));
    } catch (error) {
        return DEFAULT_SEAT_TYPE_CONFIG;
    }
}

export async function getSeatFacilityConfigItems(): Promise<
    SeatFacilityConfigItem[]
> {
    try {
        const configs = await SeatFacilityConfig.findAll({
            order: [
                ['order', 'ASC'],
                ['key', 'ASC'],
            ],
        });

        if (!configs || configs.length === 0) {
            return DEFAULT_SEAT_FACILITY_CONFIG;
        }

        return configs.map((config) => ({
            id: config.id,
            key: config.key,
            label: config.label,
            icon: config.icon || getDefaultSeatFacilityIcon(config.key),
            order: config.order,
            enabled: config.enabled,
        }));
    } catch (error) {
        return DEFAULT_SEAT_FACILITY_CONFIG;
    }
}

export async function ensureSeatTypeConfigItems(): Promise<
    SeatTypeConfigItem[]
> {
    const existing = await SeatTypeConfig.findAll();
    if (existing.length > 0) {
        return getSeatTypeConfigItems();
    }

    await SeatTypeConfig.bulkCreate(
        DEFAULT_SEAT_TYPE_CONFIG.map((item) => ({
            ...item,
            createdBy: null,
            updatedBy: null,
        }))
    );
    return getSeatTypeConfigItems();
}

export async function ensureSeatFacilityConfigItems(): Promise<
    SeatFacilityConfigItem[]
> {
    const existing = await SeatFacilityConfig.findAll();
    if (existing.length > 0) {
        return getSeatFacilityConfigItems();
    }

    await SeatFacilityConfig.bulkCreate(
        DEFAULT_SEAT_FACILITY_CONFIG.map((item) => ({
            ...item,
            createdBy: null,
            updatedBy: null,
        }))
    );
    return getSeatFacilityConfigItems();
}
