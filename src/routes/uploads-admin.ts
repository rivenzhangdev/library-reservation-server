import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { ErrorCodes } from '../utils/error-codes';
import { Upload } from '../models/mongodb';
import { deleteUploadById, saveBase64Image } from '../utils/upload';
// fs/path no longer needed; deletion handled in utils/upload

const router = new Router({ prefix: '/api/uploads' });
import { Roles } from '../constants/roles';

function requireAdmin(ctx: any) {
    const user = ctx.state.user;
    if (user?.role !== Roles.ADMIN) {
        throw new CustomError('Forbidden', 403);
    }
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
            .lean();
        ctx.body = { success: true, data: { list, total, page: p, limit: l } };
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
router.post('/', async (ctx) => {
    try {
        const { dataUrl } = ctx.request.body as any;
        if (!dataUrl) ctx.throw(400, 'Missing dataUrl');
        const url = saveBase64Image(dataUrl);
        ctx.body = { success: true, data: { url } };
    } catch (e: any) {
        console.error('Upload failed', e);
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
