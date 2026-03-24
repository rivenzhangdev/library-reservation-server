import { Context, Next } from 'koa';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';

// JWT 验证中间件
export async function authMiddleware(ctx: Context, next: Next) {
    const token = ctx.header.authorization?.replace('Bearer ', '');

    if (!token) {
        ctx.status = 401;
        ctx.body = {
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: '未提供认证令牌',
            },
        };
        return;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        (ctx as any).state.user = decoded;
        await next();
    } catch (_error) {
        ctx.status = 401;
        ctx.body = {
            success: false,
            error: {
                code: 'INVALID_TOKEN',
                message: '无效的认证令牌',
            },
        };
    }
}

// 可选的 JWT 验证中间件（某些接口允许未登录访问）
export async function optionalAuthMiddleware(ctx: Context, next: Next) {
    const token = ctx.header.authorization?.replace('Bearer ', '');

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            (ctx as any).state.user = decoded;
        } catch (_error) {
            // Token 无效但继续执行，因为这是可选认证
        }
    }

    await next();
}

// 管理员权限中间件
export async function adminMiddleware(ctx: Context, next: Next) {
    const user = (ctx as any).state.user;

    if (user?.role !== 'admin') {
        ctx.status = 403;
        ctx.body = {
            success: false,
            error: {
                code: 'FORBIDDEN',
                message: '需要管理员权限',
            },
        };
        return;
    }

    await next();
}
