import Router from 'koa-router';
import { BookingRuleConfig } from '../models/mysql';
import { BookingRuleCategory } from '../models/mysql/types';
import { User } from '../models/mongodb';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { ErrorCodes } from '../utils/error-codes';
import { writeAuditLog } from '../services/audit-service';
import { buildAuditFields } from '../utils/audit';
import { getUserDisplayNameFromMap } from '../utils/user-display';
import { Op } from 'sequelize';

const router = new Router({ prefix: '/api/booking/rules' });

const DEFAULT_BOOKING_RULES: Array<{
    ruleKey: string;
    ruleValue: string;
    description: string;
    category: BookingRuleCategory;
    enabled: boolean;
}> = [
    {
        ruleKey: 'advance_booking_days',
        ruleValue: '7',
        description: '可提前预约天数',
        category: BookingRuleCategory.BOOKING,
        enabled: true,
    },
    {
        ruleKey: 'max_booking_duration_hours',
        ruleValue: '4',
        description: '单次预约最大时长（小时）',
        category: BookingRuleCategory.BOOKING,
        enabled: true,
    },
    {
        ruleKey: 'max_booking_per_day',
        ruleValue: '3',
        description: '每人每天最大预约次数',
        category: BookingRuleCategory.BOOKING,
        enabled: true,
    },
    {
        ruleKey: 'renewal.maxExtraSlots',
        ruleValue: '2',
        description: '每个预约最大续约次数',
        category: BookingRuleCategory.RENEWAL,
        enabled: true,
    },
    {
        ruleKey: 'renewal.advanceDays',
        ruleValue: '0',
        description: '可提前续约天数（0 表示仅预约当天可续约）',
        category: BookingRuleCategory.RENEWAL,
        enabled: true,
    },
    {
        ruleKey: 'cancel_before_minutes',
        ruleValue: '30',
        description:
            '预约开始前 N 分钟内视为临近取消；若迟取消扣分大于 0，则允许取消并扣分，否则禁止取消',
        category: BookingRuleCategory.CANCEL,
        enabled: true,
    },
    {
        ruleKey: 'late_cancel_penalty_credit',
        ruleValue: '5',
        description: '临近开始时取消所扣信用分（设为 0 表示窗口内禁止取消）',
        category: BookingRuleCategory.CANCEL,
        enabled: true,
    },
    {
        ruleKey: 'checkin_window_minutes',
        ruleValue: '15',
        description: '签到窗口期（分钟）',
        category: BookingRuleCategory.GENERAL,
        enabled: true,
    },
    {
        ruleKey: 'change_request.maxPerBooking',
        ruleValue: '3',
        description: '每条预约可提交的变更申请总次数上限',
        category: BookingRuleCategory.GENERAL,
        enabled: true,
    },
];

function toPlainRule(item: any) {
    return typeof item?.toJSON === 'function' ? item.toJSON() : item;
}

function getCanonicalRuleDescription(ruleKey: string, fallback?: string) {
    const matched = DEFAULT_BOOKING_RULES.find(
        (item) => item.ruleKey === ruleKey
    );
    return matched?.description ?? fallback;
}

function resolveUserName(
    userId: any,
    userMap: Record<string, any>
): string | undefined {
    if (!userId) return undefined;
    return getUserDisplayNameFromMap(userId, userMap);
}

async function buildUserMapForRules(items: any[]) {
    const ids = Array.from(
        new Set(
            items
                .flatMap((item) => {
                    const plain = toPlainRule(item);
                    return [plain?.createdBy, plain?.updatedBy];
                })
                .filter(Boolean)
                .map((id) => String(id))
        )
    );

    if (!ids.length) return {} as Record<string, any>;

    const users = await User.find({ _id: { $in: ids } })
        .select('name username')
        .lean();
    const userMap: Record<string, any> = {};
    users.forEach((user: any) => {
        userMap[String(user._id)] = user;
    });
    return userMap;
}

function normalizeRuleRecord(item: any, userMap: Record<string, any>) {
    const plain = toPlainRule(item);
    const createdBy = plain?.createdBy
        ? String(plain.createdBy)
        : plain?.createdBy;
    const updatedBy = plain?.updatedBy
        ? String(plain.updatedBy)
        : plain?.updatedBy;

    return {
        ...plain,
        id: Number(plain.id),
        description: getCanonicalRuleDescription(
            String(plain.ruleKey ?? ''),
            plain.description
        ),
        createdBy,
        createdByName: resolveUserName(createdBy, userMap),
        updatedBy,
        updatedByName: resolveUserName(updatedBy, userMap),
    };
}

/**
 * GET /api/booking/rules - 获取所有预约规则
 * 支持 ?category=booking|renewal|cancel|general 筛选
 * 用户和管理员均可访问
 */
router.get('/', async (ctx) => {
    try {
        const { category, enabled, ruleKey } = ctx.query;
        const currentRaw = Number(
            (ctx.query.current ?? ctx.query.page ?? 1) as any
        );
        const pageSizeRaw = Number(
            (ctx.query.pageSize ?? ctx.query.pageLimit ?? 20) as any
        );
        const page =
            Number.isFinite(currentRaw) && currentRaw > 0
                ? Math.floor(currentRaw)
                : 1;
        const pageSize =
            Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
                ? Math.min(Math.floor(pageSizeRaw), 200)
                : 20;
        const where: Record<string, any> = {};
        if (category) where.category = category;
        if (enabled !== undefined) where.enabled = enabled === 'true';
        if (ruleKey) {
            where.ruleKey = { [Op.like]: `%${String(ruleKey).trim()}%` };
        }

        const { count, rows } = await BookingRuleConfig.findAndCountAll({
            where,
            order: [
                ['category', 'ASC'],
                ['ruleKey', 'ASC'],
            ],
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        const userMap = await buildUserMapForRules(rows as any[]);
        const list = (rows as any[]).map((item) =>
            normalizeRuleRecord(item, userMap)
        );

        ctx.body = {
            success: true,
            data: {
                list,
                total: count,
                page,
                pageSize,
            },
        };
    } catch (error) {
        console.error('[booking-rules] GET / error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: '获取预约规则失败',
            },
        };
    }
});

/**
 * POST /api/booking/rules/init-defaults - 初始化默认规则（管理员）
 * Body/Query:
 * - mode: 'merge' | 'replace'，默认 merge
 * - pruneCustom: boolean（仅 mode=replace 时生效，true=删除非默认键）
 */
router.post('/init-defaults', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const modeRaw = String(
            (ctx.request.body as any)?.mode ?? ctx.query?.mode ?? 'merge'
        )
            .trim()
            .toLowerCase();
        const mode: 'merge' | 'replace' =
            modeRaw === 'replace' ? 'replace' : 'merge';
        const pruneRaw =
            (ctx.request.body as any)?.pruneCustom ?? ctx.query?.pruneCustom;
        const pruneCustom =
            mode === 'replace' &&
            (pruneRaw === true ||
                String(pruneRaw ?? '')
                    .trim()
                    .toLowerCase() === 'true');

        const results: any[] = [];
        const defaultRuleKeySet = new Set(
            DEFAULT_BOOKING_RULES.map((item) => item.ruleKey)
        );

        for (const item of DEFAULT_BOOKING_RULES) {
            const [rule, created] = await BookingRuleConfig.findOrCreate({
                where: { ruleKey: item.ruleKey },
                defaults: {
                    ...item,
                    ...buildAuditFields(ctx, { created: true, updated: true }),
                },
            });
            if (!created) {
                const updates: Record<string, any> = {};
                if (mode === 'replace') {
                    if (String(rule.ruleValue) !== String(item.ruleValue)) {
                        updates.ruleValue = item.ruleValue;
                    }
                    if (String(rule.category) !== String(item.category)) {
                        updates.category = item.category;
                    }
                    if (String(rule.description ?? '') !== item.description) {
                        updates.description = item.description;
                    }
                    if (Boolean(rule.enabled) !== Boolean(item.enabled)) {
                        updates.enabled = item.enabled;
                    }
                } else {
                    if (!rule.enabled) updates.enabled = true;
                    if (!rule.category) updates.category = item.category;
                    if (!rule.description)
                        updates.description = item.description;
                }
                if (Object.keys(updates).length > 0) {
                    await rule.update({
                        ...updates,
                        ...buildAuditFields(ctx, {
                            created: false,
                            updated: true,
                        }),
                    });
                }
            }
            results.push(rule);
        }

        let prunedCount = 0;
        if (pruneCustom) {
            const removed = await BookingRuleConfig.destroy({
                where: {
                    ruleKey: {
                        [Op.notIn]: Array.from(defaultRuleKeySet),
                    },
                },
            });
            prunedCount = Number(removed || 0);
        }

        await writeAuditLog(ctx, {
            action: 'booking_rule.init_defaults',
            targetType: 'config',
            targetId: 'booking_rules',
            metadata: {
                count: results.length,
                mode,
                pruneCustom,
                prunedCount,
            },
        });

        const refreshed = await BookingRuleConfig.findAll({
            order: [
                ['category', 'ASC'],
                ['ruleKey', 'ASC'],
            ],
        });
        const userMap = await buildUserMapForRules(refreshed as any[]);

        ctx.body = {
            success: true,
            data: {
                list: (refreshed as any[]).map((rule) =>
                    normalizeRuleRecord(rule, userMap)
                ),
                total: refreshed.length,
                initialized: DEFAULT_BOOKING_RULES.length,
                mode,
                prunedCount,
            },
        };
    } catch (error) {
        console.error('[booking-rules] POST /init-defaults error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.BOOKING_RULE_UPDATE_ERROR,
                message: '初始化默认规则失败',
            },
        };
    }
});

/**
 * DELETE /api/booking/rules/:ruleKey - 删除单条规则（管理员）
 */
router.delete('/:ruleKey', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { ruleKey } = ctx.params;
        const rule = await BookingRuleConfig.findOne({ where: { ruleKey } });
        if (!rule) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_RULE_NOT_FOUND,
                    message: '规则不存在',
                },
            };
            return;
        }

        await rule.destroy();

        await writeAuditLog(ctx, {
            action: 'booking_rule.delete',
            targetType: 'config',
            targetId: ruleKey,
            metadata: {
                deletedRuleKey: ruleKey,
            },
        });

        ctx.body = {
            success: true,
            data: { ruleKey },
        };
    } catch (error) {
        console.error('[booking-rules] DELETE /:ruleKey error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.BOOKING_RULE_UPDATE_ERROR,
                message: '删除规则失败',
            },
        };
    }
});

/**
 * GET /api/booking/rules/:ruleKey - 获取单条规则
 */
router.get('/:ruleKey', async (ctx) => {
    try {
        const { ruleKey } = ctx.params;
        const rule = await BookingRuleConfig.findOne({ where: { ruleKey } });
        if (!rule) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_RULE_NOT_FOUND,
                    message: '规则不存在',
                },
            };
            return;
        }
        const userMap = await buildUserMapForRules([rule]);
        ctx.body = {
            success: true,
            data: normalizeRuleRecord(rule, userMap),
        };
    } catch (error) {
        console.error('[booking-rules] GET /:ruleKey error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: { code: ErrorCodes.INTERNAL_ERROR, message: '获取规则失败' },
        };
    }
});

/**
 * PUT /api/booking/rules/:ruleKey - 更新单条规则（管理员）
 * Body: { ruleValue?, description?, enabled? }
 */
router.put('/:ruleKey', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { ruleKey } = ctx.params;
        const { ruleValue, description, enabled } = ctx.request.body as any;
        const hasRuleValue =
            ruleValue !== undefined &&
            ruleValue !== null &&
            String(ruleValue).trim() !== '';
        const hasDescription = description !== undefined;
        const hasEnabled = enabled !== undefined;

        if (!hasRuleValue && !hasDescription && !hasEnabled) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_RULE_INVALID_VALUE,
                    message: '至少提供一个可更新字段',
                },
            };
            return;
        }

        const rule = await BookingRuleConfig.findOne({ where: { ruleKey } });
        if (!rule) {
            ctx.status = 404;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_RULE_NOT_FOUND,
                    message: '规则不存在',
                },
            };
            return;
        }

        const oldValue = rule.ruleValue;
        const oldDescription = rule.description;
        const oldEnabled = rule.enabled;
        const updates: Record<string, any> = {
            ...buildAuditFields(ctx, { created: false, updated: true }),
        };
        if (hasRuleValue) {
            updates.ruleValue = String(ruleValue);
        }
        if (hasDescription) updates.description = description;
        if (hasEnabled) {
            if (typeof enabled === 'boolean') {
                updates.enabled = enabled;
            } else if (typeof enabled === 'number') {
                updates.enabled = enabled === 1;
            } else {
                const normalized = String(enabled).trim().toLowerCase();
                updates.enabled =
                    normalized === '1' ||
                    normalized === 'true' ||
                    normalized === 'yes';
            }
        }

        await rule.update(updates);

        await writeAuditLog(ctx, {
            action: 'booking_rule.update',
            targetType: 'config',
            targetId: ruleKey,
            changes: {
                before: {
                    ruleValue: oldValue,
                    description: oldDescription,
                    enabled: oldEnabled,
                },
                after: {
                    ruleValue: hasRuleValue ? String(ruleValue) : oldValue,
                    description: hasDescription ? description : oldDescription,
                    enabled:
                        updates.enabled !== undefined
                            ? updates.enabled
                            : oldEnabled,
                },
            },
        });

        const userMap = await buildUserMapForRules([rule]);
        ctx.body = {
            success: true,
            data: normalizeRuleRecord(rule, userMap),
        };
    } catch (error) {
        console.error('[booking-rules] PUT /:ruleKey error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.BOOKING_RULE_UPDATE_ERROR,
                message: '更新规则失败',
            },
        };
    }
});

/**
 * POST /api/booking/rules/batch - 批量更新规则（管理员）
 * Body: { rules: [{ ruleKey, ruleValue, description? }] }
 */
router.post('/batch', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { rules } = ctx.request.body as any;
        if (!Array.isArray(rules) || rules.length === 0) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.INVALID_PARAMS,
                    message: '请提供规则数组',
                },
            };
            return;
        }

        const results: any[] = [];
        for (const item of rules) {
            const { ruleKey, ruleValue, description } = item;
            if (!ruleKey || ruleValue === undefined) continue;

            const rule = await BookingRuleConfig.findOne({
                where: { ruleKey },
            });
            if (!rule) continue;

            const oldValue = rule.ruleValue;
            const updates: Record<string, any> = {
                ruleValue: String(ruleValue),
                ...buildAuditFields(ctx, { created: false, updated: true }),
            };
            if (description !== undefined) updates.description = description;
            await rule.update(updates);

            await writeAuditLog(ctx, {
                action: 'booking_rule.batch_update',
                targetType: 'config',
                targetId: ruleKey,
                changes: {
                    before: { ruleValue: oldValue },
                    after: { ruleValue: String(ruleValue) },
                },
            });

            results.push(rule);
        }

        const userMap = await buildUserMapForRules(results);
        ctx.body = {
            success: true,
            data: results.map((item) => normalizeRuleRecord(item, userMap)),
        };
    } catch (error) {
        console.error('[booking-rules] POST /batch error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.BOOKING_RULE_UPDATE_ERROR,
                message: '批量更新规则失败',
            },
        };
    }
});

/**
 * 获取规则值的辅助函数（可被其他模块调用）
 */
export async function getBookingRuleValue(
    ruleKey: string,
    defaultValue: string
): Promise<string> {
    try {
        let rule = await BookingRuleConfig.findOne({
            where: { ruleKey, enabled: true },
        });
        if (!rule && ruleKey === 'renewal.maxExtraSlots') {
            rule = await BookingRuleConfig.findOne({
                where: { ruleKey: 'max_renewal_count', enabled: true },
            });
        }

        // 历史兼容：早期规则键名与当前业务键名不同，统一做回退读取
        if (!rule && ruleKey === 'max_booking_per_day') {
            rule = await BookingRuleConfig.findOne({
                where: { ruleKey: 'daily_booking_limit', enabled: true },
            });
        }
        if (!rule && ruleKey === 'cancel_before_minutes') {
            rule = await BookingRuleConfig.findOne({
                where: { ruleKey: 'cancel_deadline_minutes', enabled: true },
            });
        }
        if (!rule && ruleKey === 'max_booking_duration_hours') {
            const minuteRule = await BookingRuleConfig.findOne({
                where: { ruleKey: 'max_booking_duration', enabled: true },
            });
            if (minuteRule) {
                const minutes = Number(minuteRule.ruleValue);
                if (Number.isFinite(minutes) && minutes > 0) {
                    return String(Math.max(1, Math.ceil(minutes / 60)));
                }
            }
        }
        return rule ? rule.ruleValue : defaultValue;
    } catch {
        return defaultValue;
    }
}

export async function getBookingRuleNumber(
    ruleKey: string,
    defaultValue: number
): Promise<number> {
    const val = await getBookingRuleValue(ruleKey, String(defaultValue));
    const num = Number(val);
    return Number.isFinite(num) ? num : defaultValue;
}

export default router;
