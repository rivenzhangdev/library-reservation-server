import { SeatTypeConfig, SeatFacilityConfig } from '../models/mysql';
import { SeatType } from '../models/mysql/types';

export interface SeatTypeConfigItem {
    id?: number;
    type: SeatType;
    value: string;
    label: string;
    order: number;
    enabled: boolean;
}

export interface SeatFacilityConfigItem {
    id?: number;
    key: string;
    label: string;
    order: number;
    enabled: boolean;
}

export const DEFAULT_SEAT_TYPE_CONFIG: SeatTypeConfigItem[] = [
    {
        type: SeatType.SINGLE,
        value: 'single',
        label: 'Single',
        order: 0,
        enabled: true,
    },
    {
        type: SeatType.DOUBLE,
        value: 'double',
        label: 'Double',
        order: 1,
        enabled: true,
    },
    {
        type: SeatType.GROUP,
        value: 'group',
        label: 'Group',
        order: 2,
        enabled: true,
    },
];

export const DEFAULT_SEAT_FACILITY_CONFIG: SeatFacilityConfigItem[] = [
    {
        key: 'power',
        label: 'Socket',
        order: 0,
        enabled: true,
    },
    {
        key: 'window',
        label: 'Window seat',
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
