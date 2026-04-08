import { Context, Next } from 'koa';

// 清理查询参数：删除值为空字符串或为 'null'/'undefined' 的查询参数
export async function queryCleaner(ctx: Context, next: Next) {
    try {
        const q = ctx.query as Record<string, any>;
        for (const key of Object.keys(q)) {
            const val = q[key];
            if (typeof val === 'string') {
                if (
                    val.trim() === '' ||
                    val === 'null' ||
                    val === 'undefined'
                ) {
                    delete q[key];
                }
            } else if (Array.isArray(val)) {
                const cleaned = val.filter(
                    (v) => !(typeof v === 'string' && v.trim() === '')
                );
                if (cleaned.length === 0) delete q[key];
                else q[key] = cleaned;
            }
        }

        // compatibility: normalize legacy admin query parameter `from` to `q`
        if (typeof q.from !== 'undefined' && typeof q.q === 'undefined') {
            q.q = q.from;
        }
    } catch (e) {
        // ignore
    }
    await next();
}
