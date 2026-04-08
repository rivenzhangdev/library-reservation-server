/* eslint-disable @typescript-eslint/no-require-imports */
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const MINIO_BUCKET = process.env.MINIO_BUCKET || '';

const MINIO_PATH_PREFIX = (process.env.MINIO_PATH_PREFIX || 'uploads').replace(
    /^\/+|\/+$/g,
    ''
);

const USE_MINIO =
    MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY && MINIO_BUCKET;

let minioClient: any;
let minioBucketReady: Promise<void> | null = null;
if (USE_MINIO) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Minio = require('minio');
    minioClient = new Minio.Client({
        endPoint: MINIO_ENDPOINT,
        port: MINIO_PORT,
        useSSL: MINIO_USE_SSL,
        accessKey: MINIO_ACCESS_KEY,
        secretKey: MINIO_SECRET_KEY,
    });
}

function ensureDir() {
    if (!fs.existsSync(UPLOAD_DIR))
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function getRemoteObjectKey(filename: string) {
    return MINIO_PATH_PREFIX ? `${MINIO_PATH_PREFIX}/${filename}` : filename;
}

export function normalizeUploadUrl(url: string): string {
    if (!url) return url;
    if (url.startsWith('/uploads/')) return url;
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname || '';
        const match = pathname.match(
            /\/([^/]+\.(?:jpg|jpeg|png|gif|webp|svg|bin))$/i
        );
        if (match) {
            return `/uploads/${match[1]}`;
        }
    } catch {
        const match = url.match(
            /\/([^/]+\.(?:jpg|jpeg|png|gif|webp|svg|bin))$/i
        );
        if (match) {
            return `/uploads/${match[1]}`;
        }
    }
    return url;
}

async function ensureMinioBucketExists(): Promise<void> {
    if (!USE_MINIO) return;
    if (minioBucketReady) return minioBucketReady;

    minioBucketReady = new Promise<void>((resolve, reject) => {
        minioClient.bucketExists(MINIO_BUCKET, (err: any, exists: boolean) => {
            if (err) return reject(err);
            if (exists) {
                resolve();
                return;
            }

            minioClient.makeBucket(
                MINIO_BUCKET,
                'us-east-1',
                (makeErr: any) => {
                    if (makeErr) return reject(makeErr);
                    resolve();
                }
            );
        });
    });

    return minioBucketReady;
}

async function uploadToMinio(
    filename: string,
    contentType: string,
    buffer: Buffer
) {
    await ensureMinioBucketExists();
    const objectName = getRemoteObjectKey(filename);
    return new Promise<string>((resolve, reject) => {
        minioClient.putObject(
            MINIO_BUCKET,
            objectName,
            buffer,
            { 'Content-Type': contentType },
            (err: any) => {
                if (err) return reject(err);
                resolve(objectName);
            }
        );
    });
}

async function deleteFromMinio(filename: string) {
    const objectName = getRemoteObjectKey(filename);
    return new Promise<void>((resolve, reject) => {
        minioClient.removeObject(MINIO_BUCKET, objectName, (err: any) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

export async function saveBase64Image(
    dataUrl: string,
    uploaderId?: any,
    uploaderName?: string
): Promise<string> {
    const matches =
        /^data:(image\/(png|jpeg|jpg|gif|webp|svg\+xml));base64,(.+)$/.exec(
            dataUrl
        );
    if (!matches) throw new Error('Invalid data URL');
    const mime = matches[1];
    const ext =
        mime.includes('jpeg') || mime.includes('jpg')
            ? 'jpg'
            : mime.includes('png')
              ? 'png'
              : mime.includes('gif')
                ? 'gif'
                : mime.includes('webp')
                  ? 'webp'
                  : mime.includes('svg')
                    ? 'svg'
                    : 'bin';
    const b64 = matches[3];
    const buf = Buffer.from(b64, 'base64');
    const name = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

    const url = `/uploads/${name}`;
    if (USE_MINIO) {
        await uploadToMinio(name, mime, buf);
    } else {
        ensureDir();
        const filePath = path.join(UPLOAD_DIR, name);
        fs.writeFileSync(filePath, buf);
    }

    // try to persist metadata to Mongo Uploads collection if available
    try {
        // lazy-require to avoid startup ordering issues
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Upload } = require('../models/mongodb');
        if (Upload) {
            const docData: any = {
                url,
                filename: name,
                mime,
                size: buf.length,
            };
            if (uploaderId) docData.uploaderId = uploaderId;
            if (uploaderName) docData.uploaderName = uploaderName;
            const doc = new Upload(docData);
            // fire and forget
            doc.save().catch((e: any) =>
                console.error('Failed to save upload metadata', e)
            );
        }
    } catch {
        // ignore failures to avoid blocking uploads
    }

    return url;
}

export function getUploadPath(filename: string): string {
    return path.join(UPLOAD_DIR, filename);
}

export async function deleteUploadByFilename(
    filename: string
): Promise<boolean> {
    try {
        if (USE_MINIO) {
            await deleteFromMinio(filename);
            return true;
        }
        const filePath = getUploadPath(filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return true;
    } catch (e) {
        console.error('Failed to delete upload by filename', e);
        return false;
    }
}

export async function deleteUploadById(id: string): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Upload } = require('../models/mongodb');
        if (!Upload) return false;
        const doc = await Upload.findById(id).exec();
        if (!doc) return false;
        const filename = doc.filename;
        const deleted = await deleteUploadByFilename(filename);
        if (!deleted) {
            return false;
        }
        await Upload.deleteOne({ _id: id }).exec();
        return true;
    } catch (e) {
        console.error('Failed to delete upload by id', e);
        return false;
    }
}
