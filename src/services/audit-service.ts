import { Context } from 'koa';
import { AuditLog } from '../models/mongodb';
import { Roles } from '../constants/roles';

const ROLE_MAP: Record<number, string> = {
    [Roles.USER]: 'user',
    [Roles.ADMIN]: 'admin',
    [Roles.OPERATOR]: 'operator',
    [Roles.REVIEWER]: 'reviewer',
};

export interface AuditLogInput {
    action: string;
    targetType: string;
    targetId: string;
    changes?: Record<string, any>;
    metadata?: Record<string, any>;
}

/**
 * 写入审计日志（从 Koa ctx 中自动提取操作人信息）
 */
export async function writeAuditLog(
    ctx: Context,
    input: AuditLogInput
): Promise<void> {
    try {
        const user = (ctx as any).state?.user;
        const operatorId = user?.id ?? user?._id ?? 'system';
        const operatorRole = ROLE_MAP[user?.role as number] ?? 'user';

        await AuditLog.create({
            operatorId: String(operatorId),
            operatorRole,
            action: input.action,
            targetType: input.targetType,
            targetId: String(input.targetId),
            changes: input.changes,
            metadata: input.metadata,
            ip: ctx.ip,
            userAgent: ctx.get('user-agent'),
        });
    } catch (error) {
        // 审计日志写入失败不应阻塞业务流程
        console.error('[audit-service] Failed to write audit log:', error);
    }
}

/**
 * 写入审计日志（无 ctx 版本，用于定时任务等场景）
 */
export async function writeSystemAuditLog(
    input: AuditLogInput & { operatorId?: string }
): Promise<void> {
    try {
        await AuditLog.create({
            operatorId: input.operatorId ?? 'system',
            operatorRole: 'admin',
            action: input.action,
            targetType: input.targetType,
            targetId: String(input.targetId),
            changes: input.changes,
            metadata: input.metadata,
        });
    } catch (error) {
        console.error(
            '[audit-service] Failed to write system audit log:',
            error
        );
    }
}

export interface AuditLogQuery {
    action?: string;
    targetType?: string;
    operatorId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
}

/**
 * 查询审计日志
 */
export async function queryAuditLogs(query: AuditLogQuery) {
    const {
        action,
        targetType,
        operatorId,
        startDate,
        endDate,
        page = 1,
        pageSize = 20,
    } = query;

    const filter: Record<string, any> = {};
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (targetType) filter.targetType = targetType;
    if (operatorId) filter.operatorId = operatorId;
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate)
            filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));

    const [logs, total] = await Promise.all([
        AuditLog.find(filter)
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safePageSize)
            .limit(safePageSize)
            .lean(),
        AuditLog.countDocuments(filter),
    ]);

    return {
        list: logs.map((log: any) => ({
            ...log,
            id: String(log._id),
        })),
        total,
        page: safePage,
        pageSize: safePageSize,
        totalPages: Math.ceil(total / safePageSize),
    };
}
