import Router from 'koa-router';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { queryAuditLogs } from '../services/audit-service';
import { ErrorCodes } from '../utils/error-codes';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/audit-logs' });

/**
 * GET /api/audit-logs - 分页查询审计日志（管理员）
 * 支持 ?action=&targetType=&operatorId=&startDate=&endDate=&page=&pageSize=
 */
router.get('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const {
            action,
            targetType,
            operatorId,
            startDate,
            endDate,
            page,
            pageSize,
        } = ctx.query;

        const result = await queryAuditLogs({
            action: action as string,
            targetType: targetType as string,
            operatorId: operatorId as string,
            startDate: startDate as string,
            endDate: endDate as string,
            page: page ? Number(page) : undefined,
            pageSize: pageSize ? Number(pageSize) : undefined,
        });

        ctx.body = {
            success: true,
            data: formatRouteDateTimes(result),
        };
    } catch (error) {
        console.error('[audit-logs] GET / error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.AUDIT_LOG_QUERY_ERROR,
                message: '查询审计日志失败',
            },
        };
    }
});

/**
 * GET /api/audit-logs/export - 导出审计日志为 CSV（管理员）
 * 支持同样的筛选参数，最多导出 5000 条
 */
router.get('/export', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { action, targetType, operatorId, startDate, endDate } =
            ctx.query;

        const result = await queryAuditLogs({
            action: action as string,
            targetType: targetType as string,
            operatorId: operatorId as string,
            startDate: startDate as string,
            endDate: endDate as string,
            page: 1,
            pageSize: 5000,
        });

        const header =
            'time,operatorId,operatorRole,action,targetType,targetId,ip\n';
        const rows = result.list.map((log: any) => {
            const time = log.createdAt
                ? new Date(log.createdAt).toISOString()
                : '';
            const escape = (v: any) => {
                const s = String(v ?? '');
                return s.includes(',') || s.includes('"')
                    ? `"${s.replace(/"/g, '""')}"`
                    : s;
            };
            return [
                time,
                escape(log.operatorId),
                escape(log.operatorRole),
                escape(log.action),
                escape(log.targetType),
                escape(log.targetId),
                escape(log.ip),
            ].join(',');
        });

        const csv = header + rows.join('\n');

        ctx.set('Content-Type', 'text/csv; charset=utf-8');
        ctx.set(
            'Content-Disposition',
            `attachment; filename=audit-logs-${Date.now()}.csv`
        );
        ctx.body = '\uFEFF' + csv; // BOM for Excel compatibility
    } catch (error) {
        console.error('[audit-logs] GET /export error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.AUDIT_LOG_QUERY_ERROR,
                message: '导出审计日志失败',
            },
        };
    }
});

export default router;
