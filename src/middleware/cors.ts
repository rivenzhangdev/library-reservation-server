import { Context, Next } from 'koa';

// CORS 中间件
export async function corsMiddleware(ctx: Context, next: Next) {
    const origin = ctx.get('Origin') || ctx.get('origin') || '';

    // 如果请求携带 Origin，回显之并允许凭证；否则保留通配符以兼容同源请求
    if (origin) {
        ctx.set('Access-Control-Allow-Origin', origin);
        ctx.set('Access-Control-Allow-Credentials', 'true');
    } else {
        ctx.set('Access-Control-Allow-Origin', '*');
    }

    ctx.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    ctx.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept, X-Forwarded-For'
    );
    ctx.set('Access-Control-Max-Age', '86400');

    // 处理预检请求
    if (ctx.method === 'OPTIONS') {
        ctx.status = 200;
        return;
    }

    await next();
}
