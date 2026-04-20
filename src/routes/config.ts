import Router from 'koa-router';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { getTimeSlotConfigItems } from '../utils/time-slot-config';
import {
    ensureSeatTypeConfigItems,
    ensureSeatFacilityConfigItems,
} from '../utils/seat-config';
import {
    CHECKIN_WINDOW_MINUTES,
    MIN_CUSTOM_BOOKING_DURATION_MINUTES,
} from '../utils/booking-rules';
import { getBookingRuleNumber } from './booking-rules';
import { authMiddleware } from '../middleware/auth';
import { buildAuditFields, buildUpdatedBy } from '../utils/audit';
import {
    TimeSlotConfig,
    SeatTypeConfig,
    SeatFacilityConfig,
    CreditRuleConfig,
} from '../models/mysql';
import { getCreditRuleValues } from '../utils/credit-rule-config';

const router = new Router({ prefix: '/api/config' });

function generateConfigIdentifier() {
    return `generated-${String(Date.now()).slice(-6)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

function normalizeIconValue(rawIcon: any) {
    const icon = String(rawIcon || '').trim();
    return icon || 'search';
}

function withAuditDisplayName(item: any) {
    if (!item || typeof item !== 'object') return item;
    const plain = typeof item.toJSON === 'function' ? item.toJSON() : item;

    const createdByName =
        plain.createdByName ??
        (plain.createdBy ? String(plain.createdBy) : undefined);
    const updatedByName =
        plain.updatedByName ??
        (plain.updatedBy ? String(plain.updatedBy) : undefined);

    return {
        ...plain,
        ...(createdByName ? { createdByName } : {}),
        ...(updatedByName ? { updatedByName } : {}),
    };
}

function normalizeConfigResponseData(data: any) {
    if (Array.isArray(data)) {
        return data.map((item) => withAuditDisplayName(item));
    }
    return withAuditDisplayName(data);
}

export async function getCreditRules(ctx: any) {
    try {
        const config = await getCreditRuleValues();
        ctx.body = {
            success: true,
            data: config,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get credit rules',
            ErrorCodes.GET_CONFIG_ERROR
        );
    }
}

export async function updateCreditRules(ctx: any) {
    try {
        const {
            bookingCheckoutRewardPoints,
            activityCheckoutRewardPoints,
            activityMissedCheckoutPenaltyPoints,
            violationDeductPoints,
        } = ctx.request.body as any;

        const payload = {
            bookingCheckoutRewardPoints: Number(bookingCheckoutRewardPoints),
            activityCheckoutRewardPoints: Number(activityCheckoutRewardPoints),
            activityMissedCheckoutPenaltyPoints: Number(
                activityMissedCheckoutPenaltyPoints
            ),
            violationDeductPoints: Number(violationDeductPoints),
        };

        if (
            Object.values(payload).some(
                (value) => Number.isNaN(value) || value < 0
            )
        ) {
            throw new CustomError(
                'Invalid credit rule values',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const existingConfig = await CreditRuleConfig.findOne();
        if (existingConfig) {
            await existingConfig.update({
                ...payload,
                ...buildUpdatedBy(ctx),
            });
        } else {
            await CreditRuleConfig.create({
                ...payload,
                ...buildAuditFields(ctx),
            });
        }

        ctx.body = {
            success: true,
            data: payload,
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update credit rules',
            ErrorCodes.UPDATE_SETTINGS_ERROR
        );
    }
}

/**
 * @route GET /api/config/time-slots
 * @desc Get active time slot configuration
 */
router.get('/time-slots', async (ctx) => {
    try {
        const configs = await getTimeSlotConfigItems();
        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(configs),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get time slot configuration',
            ErrorCodes.GET_CONFIG_ERROR
        );
    }
});

export async function getBookingRules(ctx: any) {
    try {
        const maxRenewalExtraSlots = await getBookingRuleNumber(
            'renewal.maxExtraSlots',
            1
        );
        ctx.body = {
            success: true,
            data: {
                minCustomBookingDurationMinutes:
                    MIN_CUSTOM_BOOKING_DURATION_MINUTES,
                checkinWindowMinutes: CHECKIN_WINDOW_MINUTES,
                maxRenewalExtraSlots,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get booking rules',
            ErrorCodes.GET_CONFIG_ERROR
        );
    }
}

router.get('/booking-rules', getBookingRules);

router.get('/credit-rules', getCreditRules);

router.put('/credit-rules', authMiddleware, updateCreditRules);

router.post('/time-slots', authMiddleware, async (ctx) => {
    try {
        const { timeSlot, value, label, startTime, endTime, order, enabled } =
            ctx.request.body as any;
        if (!label || !startTime || !endTime) {
            throw new CustomError(
                'Missing required time slot parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const maxTimeSlot = (await TimeSlotConfig.max('timeSlot')) as
            | number
            | null
            | undefined;
        const timeSlotValue =
            typeof timeSlot === 'undefined' || timeSlot === null
                ? maxTimeSlot != null
                    ? Number(maxTimeSlot) + 1
                    : 0
                : Number(timeSlot);

        if (Number.isNaN(timeSlotValue) || timeSlotValue < 0) {
            throw new CustomError(
                'Invalid time slot',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (value) {
            const exists = await TimeSlotConfig.findOne({ where: { value } });
            if (exists) {
                throw new CustomError(
                    'Time slot value already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        const item = await TimeSlotConfig.create({
            timeSlot: timeSlotValue,
            value: value || generateConfigIdentifier(),
            label,
            startTime,
            endTime,
            order: Number.isFinite(Number(order)) ? Number(order) : 0,
            enabled: typeof enabled === 'boolean' ? enabled : true,
            createdBy: (ctx as any).state.user?.username || null,
            updatedBy: (ctx as any).state.user?.username || null,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(item),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create time slot configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.put('/time-slots/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const { value, label, startTime, endTime, order, enabled } = ctx.request
            .body as any;
        const config = await TimeSlotConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Time slot config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        if (value && value !== config.value) {
            const exists = await TimeSlotConfig.findOne({ where: { value } });
            if (exists) {
                throw new CustomError(
                    'Time slot value already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        await config.update({
            value: value ?? config.value,
            label: label ?? config.label,
            startTime: startTime ?? config.startTime,
            endTime: endTime ?? config.endTime,
            order: Number.isFinite(Number(order))
                ? Number(order)
                : config.order,
            enabled: typeof enabled === 'boolean' ? enabled : config.enabled,
            updatedBy: (ctx as any).state.user?.username || config.updatedBy,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(config),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update time slot configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.delete('/time-slots/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const config = await TimeSlotConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Time slot config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        await config.destroy();

        ctx.body = {
            success: true,
            message: 'Deleted successfully',
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete time slot configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.get('/seat-types', async (ctx) => {
    try {
        const configs = await ensureSeatTypeConfigItems();
        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(configs),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat type configuration',
            ErrorCodes.GET_CONFIG_ERROR
        );
    }
});

router.post('/seat-types', authMiddleware, async (ctx) => {
    try {
        const { type, value, label, icon, order, enabled } = ctx.request
            .body as any;
        if (!label) {
            throw new CustomError(
                'Missing required seat type parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const parsedType = typeof type === 'undefined' ? null : Number(type);
        if (
            parsedType !== null &&
            (!Number.isFinite(parsedType) || parsedType < 0)
        ) {
            throw new CustomError(
                'Invalid seat type',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (value) {
            const exists = await SeatTypeConfig.findOne({ where: { value } });
            if (exists) {
                throw new CustomError(
                    'Seat type value already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        if (parsedType !== null) {
            const duplicateType = await SeatTypeConfig.findOne({
                where: { type: parsedType },
            });
            if (duplicateType) {
                throw new CustomError(
                    'Seat type already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        const maxType = (await SeatTypeConfig.max('type')) as number | null;
        const typeCode =
            parsedType !== null
                ? parsedType
                : Number.isFinite(maxType as number)
                  ? (maxType as number) + 1
                  : 0;
        const item = await SeatTypeConfig.create({
            type: typeCode,
            value: value || generateConfigIdentifier(),
            label,
            icon: normalizeIconValue(icon),
            order: Number.isFinite(Number(order)) ? Number(order) : 0,
            enabled: typeof enabled === 'boolean' ? enabled : true,
            createdBy: (ctx as any).state.user?.username || null,
            updatedBy: (ctx as any).state.user?.username || null,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(item),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create seat type configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.put('/seat-types/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const { type, value, label, icon, order, enabled } = ctx.request
            .body as any;
        const config = await SeatTypeConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Seat type config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        if (
            typeof type !== 'undefined' &&
            (!Number.isFinite(Number(type)) || Number(type) < 0)
        ) {
            throw new CustomError(
                'Invalid seat type',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (value && value !== config.value) {
            const exists = await SeatTypeConfig.findOne({ where: { value } });
            if (exists) {
                throw new CustomError(
                    'Seat type value already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        if (typeof type !== 'undefined' && Number(type) !== config.type) {
            const duplicateType = await SeatTypeConfig.findOne({
                where: { type: Number(type) },
            });
            if (duplicateType) {
                throw new CustomError(
                    'Seat type already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        await config.update({
            type: typeof type !== 'undefined' ? Number(type) : config.type,
            value: value ?? config.value,
            label: label ?? config.label,
            icon:
                typeof icon !== 'undefined'
                    ? normalizeIconValue(icon)
                    : config.icon,
            order: Number.isFinite(Number(order))
                ? Number(order)
                : config.order,
            enabled: typeof enabled === 'boolean' ? enabled : config.enabled,
            updatedBy: (ctx as any).state.user?.username || config.updatedBy,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(config),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update seat type configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.delete('/seat-types/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const config = await SeatTypeConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Seat type config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        await config.destroy();

        ctx.body = {
            success: true,
            message: 'Deleted successfully',
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete seat type configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.get('/seat-facilities', async (ctx) => {
    try {
        const configs = await ensureSeatFacilityConfigItems();
        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(configs),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to get seat facility configuration',
            ErrorCodes.GET_CONFIG_ERROR
        );
    }
});

router.post('/seat-facilities', authMiddleware, async (ctx) => {
    try {
        const { key, label, icon, order, enabled } = ctx.request.body as any;
        if (!label) {
            throw new CustomError(
                'Missing required facility parameters',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (key) {
            const exists = await SeatFacilityConfig.findOne({ where: { key } });
            if (exists) {
                throw new CustomError(
                    'Facility key already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        const item = await SeatFacilityConfig.create({
            key: key || generateConfigIdentifier(),
            label,
            icon: normalizeIconValue(icon),
            order: Number.isFinite(Number(order)) ? Number(order) : 0,
            enabled: typeof enabled === 'boolean' ? enabled : true,
            createdBy: (ctx as any).state.user?.username || null,
            updatedBy: (ctx as any).state.user?.username || null,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(item),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to create seat facility configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.put('/seat-facilities/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const { key, label, icon, order, enabled } = ctx.request.body as any;
        const config = await SeatFacilityConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Seat facility config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        if (key && key !== config.key) {
            const exists = await SeatFacilityConfig.findOne({ where: { key } });
            if (exists) {
                throw new CustomError(
                    'Facility key already exists',
                    ErrorCodes.INVALID_PARAMS
                );
            }
        }

        await config.update({
            key: key ?? config.key,
            label: label ?? config.label,
            icon:
                typeof icon !== 'undefined'
                    ? normalizeIconValue(icon)
                    : config.icon,
            order: Number.isFinite(Number(order))
                ? Number(order)
                : config.order,
            enabled: typeof enabled === 'boolean' ? enabled : config.enabled,
            updatedBy: (ctx as any).state.user?.username || config.updatedBy,
        });

        ctx.body = {
            success: true,
            data: normalizeConfigResponseData(config),
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to update seat facility configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

router.delete('/seat-facilities/:id', authMiddleware, async (ctx) => {
    try {
        const id = Number(ctx.params.id);
        const config = await SeatFacilityConfig.findByPk(id);
        if (!config) {
            throw new CustomError(
                'Seat facility config not found',
                ErrorCodes.NOT_FOUND
            );
        }

        await config.destroy();

        ctx.body = {
            success: true,
            message: 'Deleted successfully',
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to delete seat facility configuration',
            ErrorCodes.INVALID_PARAMS
        );
    }
});

export default router;
