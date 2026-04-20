import Router from 'koa-router';
import { BookingRuleConfig } from '../models/mysql';
import { User } from '../models/mongodb';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { ErrorCodes } from '../utils/error-codes';
import { writeAuditLog } from '../services/audit-service';
import { buildAuditFields } from '../utils/audit';
import { getUserDisplayNameFromMap } from '../utils/user-display';

const router = new Router({ prefix: '/api/booking/rules' });

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function toPlainRule(item: any) {
    return typeof item?.toJSON === 'function' ? item.toJSON() : item;
}

function resolveUserName(
    userId: any,
    userMap: Record<string, any>
): string | undefined {
    if (!userId) return undefined;
    const fromMap = getUserDisplayNameFromMap(userId, userMap);
    if (fromMap) return fromMap;

    const raw = String(userId).trim();
    if (!raw || OBJECT_ID_PATTERN.test(raw)) return undefined;
    return raw;
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
        const { category, enabled } = ctx.query;
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
 * Body: { ruleValue, description? }
 */
router.put('/:ruleKey', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { ruleKey } = ctx.params;
        const { ruleValue, description } = ctx.request.body as any;

        if (
            ruleValue === undefined ||
            ruleValue === null ||
            String(ruleValue).trim() === ''
        ) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                error: {
                    code: ErrorCodes.BOOKING_RULE_INVALID_VALUE,
                    message: '规则值不能为空',
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
        const updates: Record<string, any> = {
            ruleValue: String(ruleValue),
            ...buildAuditFields(ctx, { created: false, updated: true }),
        };
        if (description !== undefined) updates.description = description;

        await rule.update(updates);

        await writeAuditLog(ctx, {
            action: 'booking_rule.update',
            targetType: 'config',
            targetId: ruleKey,
            changes: {
                before: { ruleValue: oldValue },
                after: { ruleValue: String(ruleValue) },
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
        const rule = await BookingRuleConfig.findOne({
            where: { ruleKey, enabled: true },
        });
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
