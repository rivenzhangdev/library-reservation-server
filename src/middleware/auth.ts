import { Context, Next } from 'koa';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { ErrorCodes } from '../utils/error-codes';
import { User } from '../models/mongodb';
import { normalizeUploadUrl } from '../utils/upload';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';

// JWT 验证中间件
export async function authMiddleware(ctx: Context, next: Next) {
    // 支持多种传输方式：`Authorization` header（Bearer）优先，其次尝试 `x-access-token`、query/body 中的 `token`、或 cookie
    const rawAuthHeader: any =
        (ctx.header &&
            ((ctx.header.authorization as any) ||
                (ctx.header.Authorization as any))) ||
        ctx.get('authorization') ||
        '';
    const authHeader = Array.isArray(rawAuthHeader)
        ? rawAuthHeader[0]
        : rawAuthHeader;
    let token =
        typeof authHeader === 'string'
            ? authHeader.replace(/Bearer\s+/i, '').trim()
            : '';
    if (!token)
        token =
            ctx.get('x-access-token') ||
            ctx.get('x-access_token') ||
            (ctx.request.body as any)?.token ||
            (ctx.query && (ctx.query.token as string)) ||
            ctx.cookies.get?.('token');

    // 开发环境下输出调试信息，帮助诊断 token 来源与解析结果（仅在 development 时记录）
    if (process.env.NODE_ENV !== 'production') {
        try {
            const authHeader = !!ctx.header.authorization;
            const cookieTokenPresent = !!ctx.cookies.get?.('token');
            const mask = (t: string | undefined | null) => {
                if (!t) return '';
                try {
                    if (t.length <= 12) return t;
                    return `${t.slice(0, 6)}...${t.slice(-4)}`;
                } catch (e) {
                    return '';
                }
            };
            console.debug(
                '[auth-debug] header.Authorization present=',
                authHeader,
                ' cookieToken=',
                cookieTokenPresent,
                ' chosenToken=',
                mask(token)
            );
        } catch (e) {
            // ignore
        }
    }

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

        // Normalize role to numeric value so downstream checks work consistently
        const normalizeRole = (r: any) => {
            try {
                if (r === undefined || r === null) return 0;
                if (typeof r === 'number') return r;
                return 0;
            } catch (e) {
                return 0;
            }
        };

        // normalize id and role for downstream usage
        const d: any = decoded || {};
        const extractedId = d.id ?? d._id ?? d.sub ?? undefined;
        const normalizedId =
            extractedId !== undefined && extractedId !== null
                ? String(extractedId)
                : extractedId;
        const latestUser = normalizedId
            ? await User.findById(normalizedId)
                  .select('_id username name role avatar blacklisted')
                  .lean()
            : null;

        if (normalizedId && !latestUser) {
            ctx.status = 401;
            ctx.body = {
                success: false,
                error: {
                    code: String(ErrorCodes.UNAUTHORIZED),
                    message: '用户不存在或登录状态已失效',
                },
            };
            return;
        }

        (ctx as any).state.user = {
            ...(d as any),
            ...(latestUser || {}),
            id: latestUser?._id ? String(latestUser._id) : normalizedId,
            role: normalizeRole(latestUser?.role ?? d.role),
            username: latestUser?.username ?? d.username,
            name: latestUser?.username ?? latestUser?.name ?? d.name,
            avatar: normalizeUploadUrl(
                String(latestUser?.avatar || d.avatar || '')
            ),
            blacklisted: !!latestUser?.blacklisted,
        };

        if (process.env.NODE_ENV !== 'production') {
            try {
                const u: any = decoded as any;
                console.debug('[auth-debug] decoded user:', {
                    id: u?.id,
                    username: u?.username || u?.openid,
                    role: u?.role,
                });
            } catch (e) {
                // ignore
            }
        }
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
    // 支持同样的 token 来源策略为可选认证
    const rawAuthHeader: any =
        (ctx.header &&
            ((ctx.header.authorization as any) ||
                (ctx.header.Authorization as any))) ||
        ctx.get('authorization') ||
        '';
    const authHeader = Array.isArray(rawAuthHeader)
        ? rawAuthHeader[0]
        : rawAuthHeader;
    let token =
        typeof authHeader === 'string'
            ? authHeader.replace(/Bearer\s+/i, '').trim()
            : '';
    if (!token)
        token =
            ctx.get('x-access-token') ||
            ctx.get('x-access_token') ||
            (ctx.request.body as any)?.token ||
            (ctx.query && (ctx.query.token as string)) ||
            ctx.cookies.get?.('token');

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            // normalize role for optional auth as well
            const normalizeRole = (r: any) => {
                try {
                    if (r === undefined || r === null) return 0;
                    if (typeof r === 'number') return r;
                    return 0;
                } catch (e) {
                    return 0;
                }
            };
            const d: any = decoded || {};
            const extractedId = d.id ?? d._id ?? d.sub ?? undefined;
            const normalizedId =
                extractedId !== undefined && extractedId !== null
                    ? String(extractedId)
                    : extractedId;
            const latestUser = normalizedId
                ? await User.findById(normalizedId)
                      .select('_id username name role avatar blacklisted')
                      .lean()
                : null;
            (ctx as any).state.user = {
                ...(d || {}),
                ...(latestUser || {}),
                id: latestUser?._id ? String(latestUser._id) : normalizedId,
                role: normalizeRole(latestUser?.role ?? d.role),
                username: latestUser?.username ?? d.username,
                name: latestUser?.username ?? latestUser?.name ?? d.name,
                avatar: latestUser?.avatar ?? d.avatar,
                blacklisted: !!latestUser?.blacklisted,
            };
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
        if (process.env.NODE_ENV !== 'production') {
            try {
                console.warn(
                    '[auth-debug] adminMiddleware: access denied, user role=',
                    user?.role,
                    'userId=',
                    user?.id,
                    'username=',
                    user?.username
                );
            } catch (e) {
                // ignore
            }
        }
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
