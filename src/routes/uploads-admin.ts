import Router from 'koa-router';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { Upload } from '../models/mongodb';
import { getUserDisplayName } from '../utils/user-display';
import {
    deleteUploadById,
    saveBase64Image,
    normalizeUploadUrl,
} from '../utils/upload';
import { formatRouteDateTimes } from '../utils/route-time-serializer';
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
    const backendBase = (
        process.env.BACKEND_URL ?? `${ctx.protocol}://${ctx.host}`
    ).replace(/\/+$/g, '');
    const normalizedUrl = url.replace(/\/\/{2,}/g, '/');
    return normalizedUrl.startsWith('/')
        ? `${backendBase}${normalizedUrl}`
        : `${backendBase}/${normalizedUrl}`;
}

// list uploads
router.get('/', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const { page = 1, pageSize, limit = 20 } = ctx.query as any;
        const p = Math.max(1, parseInt(page as string));
        const l = Math.max(1, parseInt(String(pageSize ?? limit), 10));
        const total = await Upload.countDocuments();
        const list = await Upload.find()
            .sort({ createdAt: -1 })
            .skip((p - 1) * l)
            .limit(l)
            .populate('uploaderId', 'name username')
            .lean();
        const normalizedList = list.map((item: any) => ({
            ...formatRouteDateTimes({
                ...item,
                id: String(item._id),
                url: makeAbsoluteUrl(
                    ctx,
                    normalizeUploadUrl(String(item.url ?? ''))
                ),
                uploaderName:
                    item.uploaderName ??
                    getUserDisplayName(item.uploaderId as any),
            }),
        }));
        ctx.body = {
            success: true,
            data: { list: normalizedList, total, page: p, pageSize: l },
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
    const dataUrl = body?.dataUrl;
    if (!dataUrl) ctx.throw(400, 'Missing dataUrl');
    const uploaderId = ctx.state?.user?.id;
    const uploaderName = ctx.state?.user?.name ?? undefined;
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
        if (e.isCustom) throw e;
        throw new CustomError(
            e?.message ?? 'Upload failed',
            ErrorCodes.INTERNAL_ERROR,
            500
        );
    }
});

router.post('/upload', optionalAuthMiddleware, async (ctx) => {
    try {
        await handleUpload(ctx);
    } catch (e: any) {
        console.error('Upload failed (alias /upload)', e);
        if (e.isCustom) throw e;
        throw new CustomError(
            e?.message ?? 'Upload failed',
            ErrorCodes.INTERNAL_ERROR,
            500
        );
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

router.post('/batch-delete', authMiddleware, async (ctx) => {
    try {
        requireAdmin(ctx);
        const body = ctx.request.body as any;
        const ids = body?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new CustomError('Missing ids', ErrorCodes.INVALID_PARAMS);
        }
        const results = await Promise.all(
            ids.map((id: string) => deleteUploadById(String(id)))
        );
        if (results.some((ok) => !ok)) {
            throw new CustomError(
                'One or more uploads not found',
                ErrorCodes.NOT_FOUND,
                404
            );
        }
        ctx.body = { success: true };
    } catch (e: any) {
        if (e.isCustom) throw e;
        throw new CustomError('Failed to delete uploads', 500);
    }
});

export default router;
