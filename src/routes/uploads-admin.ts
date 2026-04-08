import Router from 'koa-router';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { Upload } from '../models/mongodb';
import {
    deleteUploadById,
    saveBase64Image,
    normalizeUploadUrl,
} from '../utils/upload';
// fs/path no longer needed; deletion handled in utils/upload

const router = new Router({ prefix: '/api/uploads' });
import { Roles } from '../constants/roles';

function requireAdmin(ctx: any) {
    const user = ctx.state.user;
    if (user?.role !== Roles.ADMIN) {
        throw new CustomError('Forbidden', 403);
    }
}

function makeAbsoluteUrl(ctx: any, url: string) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    const origin = ctx.origin || `${ctx.protocol}://${ctx.host}`;
    if (url.startsWith('/')) {
        return `${origin}${url}`;
    }
    return `${origin}/${url}`;
}

// list uploads
router.get('/', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { page = 1, limit = 20 } = ctx.query as any;
        const p = Math.max(1, parseInt(page as string));
        const l = Math.max(1, parseInt(limit as string));
        const total = await Upload.countDocuments();
        const list = await Upload.find()
            .sort({ createdAt: -1 })
            .skip((p - 1) * l)
            .limit(l)
            .populate('uploaderId', 'name username')
            .lean();
        const normalizedList = list.map((item: any) => ({
            ...item,
            url: makeAbsoluteUrl(
                ctx,
                normalizeUploadUrl(String(item.url || ''))
            ),
        }));
        ctx.body = {
            success: true,
            data: { list: normalizedList, total, page: p, limit: l },
        };
    } catch (e: any) {
        if (e.isCustom) throw e;
        throw new CustomError('Failed to list uploads', 500);
    }
});

/**
 * POST /api/uploads
 * public upload endpoint (兼容 /api/upload)
 * body: { dataUrl: string }
 */
const handleUpload = async (ctx: any) => {
    const body = ctx.request.body as any;
    let dataUrl = body?.dataUrl || body?.data?.dataUrl || body?.data?.url;
    if (!dataUrl && body?.url) dataUrl = body.url;
    console.log(
        'POST /api/uploads received, hasDataUrl=',
        !!dataUrl,
        'dataUrlLength=',
        dataUrl ? dataUrl.length : 0,
        'bodyKeys=',
        Object.keys(body || {}).join(', ')
    );
    if (!dataUrl) ctx.throw(400, 'Missing dataUrl');
    const uploaderId = ctx.state?.user?.id;
    const uploaderName =
        ctx.state?.user?.name || ctx.state?.user?.username || undefined;
    let url = await saveBase64Image(dataUrl, uploaderId, uploaderName);
    url = makeAbsoluteUrl(ctx, url);
    console.log('Saved upload ->', url);
    ctx.body = { success: true, data: { url } };
};

router.post('/', optionalAuthMiddleware, async (ctx) => {
    try {
        await handleUpload(ctx);
    } catch (e: any) {
        console.error('Upload failed', e);
        throw new CustomError('Upload failed', ErrorCodes.INTERNAL_ERROR, 500);
    }
});

router.post('/upload', optionalAuthMiddleware, async (ctx) => {
    try {
        await handleUpload(ctx);
    } catch (e: any) {
        console.error('Upload failed (alias /upload)', e);
        throw new CustomError('Upload failed', ErrorCodes.INTERNAL_ERROR, 500);
    }
});

// delete upload by id (removes file and metadata)
router.delete('/:id', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const id = ctx.params.id;
        const ok = await deleteUploadById(id);
        if (!ok) {
            throw new CustomError('Not found', ErrorCodes.NOT_FOUND, 404);
        }
        ctx.body = { success: true };
    } catch (e: any) {
        if (e.isCustom) throw e;
        throw new CustomError('Failed to delete upload', 500);
    }
});

export default router;
