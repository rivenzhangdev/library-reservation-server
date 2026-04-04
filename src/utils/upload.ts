/* eslint-disable @typescript-eslint/no-require-imports */
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function ensureDir() {
    if (!fs.existsSync(UPLOAD_DIR))
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function saveBase64Image(dataUrl: string): string {
    ensureDir();
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
    const filePath = path.join(UPLOAD_DIR, name);
    fs.writeFileSync(filePath, buf);

    // try to persist metadata to Mongo Uploads collection if available
    try {
        // lazy-require to avoid startup ordering issues
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Upload } = require('../models/mongodb');
        if (Upload) {
            const doc = new Upload({
                url: `/uploads/${name}`,
                filename: name,
                mime,
                size: buf.length,
            });
            // fire and forget
            doc.save().catch((e: any) =>
                console.error('Failed to save upload metadata', e)
            );
        }
    } catch {
        // ignore failures to avoid blocking uploads
    }

    return `/uploads/${name}`;
}

export function getUploadPath(filename: string): string {
    return path.join(UPLOAD_DIR, filename);
}

export async function deleteUploadByFilename(filename: string): Promise<boolean> {
    const filePath = getUploadPath(filename);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error('Failed to unlink', e);
    }

    try {
        // lazy-require Upload model to avoid startup ordering
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Upload } = require('../models/mongodb');
        if (Upload) {
            await Upload.deleteMany({ filename }).exec();
        }
    } catch (e) {
        // ignore metadata deletion failures
    }

    return true;
}

export async function deleteUploadById(id: string): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Upload } = require('../models/mongodb');
        if (!Upload) return false;
        const doc = await Upload.findById(id).exec();
        if (!doc) return false;
        const filename = doc.filename;
        const filePath = getUploadPath(filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.error('Failed to unlink', e);
        }
        await Upload.deleteOne({ _id: id }).exec();
        return true;
    } catch (e) {
        console.error('Failed to delete upload by id', e);
        return false;
    }
}
