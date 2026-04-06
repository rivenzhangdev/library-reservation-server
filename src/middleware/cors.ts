import { Context, Next } from 'koa';

// CORS 中间件
export async function corsMiddleware(ctx: Context, next: Next) {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    ctx.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept'
    );
    ctx.set('Access-Control-Max-Age', '86400');

    // 处理预检请求
    if (ctx.method === 'OPTIONS') {
        ctx.status = 200;
        return;
    }

    await next();
}
