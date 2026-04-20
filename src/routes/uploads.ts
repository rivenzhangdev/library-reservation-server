import Router from 'koa-router';
import * as MinioPkg from 'minio';

const Minio = (MinioPkg as any)?.Client
    ? MinioPkg
    : (MinioPkg as any)?.default ?? MinioPkg;
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const MINIO_BUCKET = process.env.MINIO_BUCKET || '';
const MINIO_PATH_PREFIX = (process.env.MINIO_PATH_PREFIX || 'uploads')
    .replace(/^\/+/g, '')
    .replace(/\/+$/g, '');
const USE_MINIO =
    MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY && MINIO_BUCKET;

let minioClient: any;
if (USE_MINIO) {
    minioClient = new Minio.Client({
        endPoint: MINIO_ENDPOINT,
        port: MINIO_PORT,
        useSSL: MINIO_USE_SSL,
        accessKey: MINIO_ACCESS_KEY,
        secretKey: MINIO_SECRET_KEY,
    });
}

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

function getRemoteObjectKey(filename: string) {
    return MINIO_PATH_PREFIX ? `${MINIO_PATH_PREFIX}/${filename}` : filename;
}

function getObjectStream(objectName: string) {
    return new Promise<any>((resolve, reject) => {
        minioClient.getObject(
            MINIO_BUCKET,
            objectName,
            (err: any, dataStream: any) => {
                if (err) return reject(err);
                resolve(dataStream);
            }
        );
    });
}

async function findUploadStream(name: string) {
    const triedKeys = [];
    const candidateKeys = [getRemoteObjectKey(name)];
    if (MINIO_PATH_PREFIX) {
        candidateKeys.push(name);
    }

    for (const objectName of candidateKeys) {
        triedKeys.push(objectName);
        try {
            const stream = await getObjectStream(objectName);
            return { stream, objectName };
        } catch (err: any) {
            if (err?.code === 'NoSuchKey' || err?.statusCode === 404) {
                continue;
            }
            throw { err, objectName, triedKeys };
        }
    }

    throw { notFound: true, triedKeys };
}

router.get('/:name', async (ctx) => {
    const name = ctx.params.name as string;
    if (!name) {
        ctx.status = 400;
        ctx.body = 'Missing file name';
        return;
    }

    const ext = name.split('.').pop() || '';
    ctx.set('Content-Type', contentTypeByExt(ext));

    if (!USE_MINIO) {
        ctx.status = 500;
        ctx.body = 'MinIO is not configured for uploads';
        return;
    }

    try {
        const { stream } = await findUploadStream(name);
        ctx.body = stream;
        return;
    } catch (error: any) {
        if (error?.notFound) {
            console.error('Upload not found in MinIO', {
                bucket: MINIO_BUCKET,
                prefix: MINIO_PATH_PREFIX,
                name,
                tried: error.triedKeys,
            });
            ctx.status = 404;
            ctx.body = 'Not found';
            return;
        }

        console.error('Failed to read upload from MinIO', {
            bucket: MINIO_BUCKET,
            prefix: MINIO_PATH_PREFIX,
            name,
            tried: error?.triedKeys || [getRemoteObjectKey(name)],
            error: error?.err || error,
        });

        ctx.status = 500;
        ctx.body = 'Internal server error';
        return;
    }
});

export default router;
