import Router from 'koa-router';
import fs from 'fs';
import path from 'path';

const router = new Router({ prefix: '/uploads' });

function contentTypeByExt(ext: string) {
    const e = ext.toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'png') return 'image/png';
    if (e === 'gif') return 'image/gif';
    if (e === 'webp') return 'image/webp';
    if (e === 'svg') return 'image/svg+xml';
    return 'application/octet-stream';
}

router.get('/:name', async (ctx) => {
    const name = ctx.params.name as string;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, name);
    if (!fs.existsSync(filePath)) {
        ctx.status = 404;
        ctx.body = 'Not found';
        return;
    }
    const ext = name.split('.').pop() || '';
    ctx.set('Content-Type', contentTypeByExt(ext));
    ctx.body = fs.createReadStream(filePath);
});

export default router;
