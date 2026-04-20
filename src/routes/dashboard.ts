import Router from 'koa-router';
import { Op, fn, col } from 'sequelize';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { Booking, BookingChangeRequest } from '../models/mysql';
import { Activity, Feedback, User } from '../models/mongodb';
import { BookingStatus } from '../models/mysql/types';
import { ErrorCodes } from '../utils/error-codes';
import { FeedbackStatus } from '../constants/feedback';

const router = new Router({ prefix: '/api/dashboard' });

function toLocalDateOnly(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * GET /api/dashboard/stats - 获取总览统计（管理员）
 */
router.get('/stats', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const today = toLocalDateOnly(new Date());

        const [
            totalBookings,
            todayBookings,
            activeBookings,
            totalUsers,
            pendingChangeRequests,
            totalActivities,
            pendingFeedback,
        ] = await Promise.all([
            Booking.count(),
            Booking.count({ where: { date: today } }),
            Booking.count({
                where: {
                    status: {
                        [Op.in]: [
                            BookingStatus.UPCOMING,
                            BookingStatus.ONGOING,
                        ],
                    },
                },
            }),
            User.countDocuments(),
            BookingChangeRequest.count({ where: { status: 'pending' } }),
            Activity.countDocuments(),
            Feedback.countDocuments({ status: FeedbackStatus.PENDING }),
        ]);

        ctx.body = {
            success: true,
            data: {
                totalBookings,
                todayBookings,
                activeBookings,
                totalUsers,
                pendingChangeRequests,
                totalActivities,
                pendingFeedback,
            },
        };
    } catch (error) {
        console.error('[dashboard] GET /stats error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.DASHBOARD_STATS_ERROR,
                message: '获取统计数据失败',
            },
        };
    }
});

/**
 * GET /api/dashboard/trends - 获取过去 N 天的预约趋势（管理员）
 * 可选 ?days=7 (默认7天)
 */
router.get('/trends', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const days = Math.min(90, Math.max(1, Number(ctx.query.days) || 7));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (days - 1));
        const startDateStr = toLocalDateOnly(startDate);

        const bookingTrends = await Booking.findAll({
            attributes: [
                [fn('DATE', col('date')), 'day'],
                [fn('COUNT', col('id')), 'count'],
            ],
            where: {
                date: { [Op.gte]: startDateStr },
            },
            group: [fn('DATE', col('date'))],
            order: [[fn('DATE', col('date')), 'ASC']],
            raw: true,
        });

        ctx.body = {
            success: true,
            data: {
                days,
                bookingTrends: (bookingTrends || []).map((item: any) => ({
                    day: String(item.day || ''),
                    count: Number(item.count || 0),
                })),
            },
        };
    } catch (error) {
        console.error('[dashboard] GET /trends error:', error);
        ctx.status = 500;
        ctx.body = {
            success: false,
            error: {
                code: ErrorCodes.DASHBOARD_STATS_ERROR,
                message: '获取趋势数据失败',
            },
        };
    }
});

export default router;
