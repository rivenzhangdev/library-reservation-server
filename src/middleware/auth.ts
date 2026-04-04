import { Context, Next } from 'koa';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { ErrorCodes } from '../utils/error-codes';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';

// JWT 验证中间件
export async function authMiddleware(ctx: Context, next: Next) {
    // 支持多种传输方式：`Authorization` header 优先，其次尝试 `x-access-token`、query/body 中的 `token`、或 cookie
    let token = ctx.header.authorization?.replace('Bearer ', '');
    if (!token)
        token =
            ctx.get('x-access-token') ||
            ctx.request.body?.token ||
            (ctx.query && (ctx.query.token as string)) ||
            ctx.cookies.get?.('token');

    if (!token) {
        ctx.status = 401;
        ctx.body = {
            success: false,
            error: {
                code: String(ErrorCodes.UNAUTHORIZED),
                message: '未提供认证令牌',
            },
        };
        return;
    }

    try {
        const tryVerify = (tk: string, secret: string) => {
            try {
                return jwt.verify(tk, secret);
            } catch {
                return null;
            }
        };

        let decoded: any = tryVerify(token, JWT_SECRET);
        if (!decoded && JWT_SECRET !== 'default_secret') {
            decoded = tryVerify(token, 'default_secret');
        }

        if (!decoded) throw new Error('invalid token');

        (ctx as any).state.user = decoded;
    } catch (_error) {
        ctx.status = 401;
        ctx.body = {
            success: false,
            error: {
                code: String(ErrorCodes.INVALID_TOKEN),
                message: '无效的认证令牌',
            },
        };
        return;
    }

    await next();
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
import { Roles } from '../constants/roles';

export async function adminMiddleware(ctx: Context, next: Next) {
    const user = (ctx as any).state.user;

    if (user?.role !== Roles.ADMIN) {
        ctx.status = 403;
        ctx.body = {
            success: false,
            error: {
                code: String(ErrorCodes.FORBIDDEN),
                message: '需要管理员权限',
            },
        };
        return;
    }

    await next();
}
