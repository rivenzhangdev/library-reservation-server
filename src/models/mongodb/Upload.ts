import mongoose, { Document, Schema } from 'mongoose';

export interface IUpload extends Document {
    url: string;
    filename: string;
    mime?: string;
    size?: number;
    uploaderId?: mongoose.Types.ObjectId | string;
    uploaderName?: string;
    refType?: string; // e.g. 'feedback', 'user'
    refId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const uploadSchema = new Schema<IUpload>(
    {
        url: { type: String, required: true },
        filename: { type: String, required: true },
        mime: String,
        size: Number,
        uploaderId: { type: Schema.Types.ObjectId, ref: 'User' },
        uploaderName: String,
        refType: String,
        refId: String,
    },
    { timestamps: true }
);

uploadSchema.index({ createdAt: -1 });

const Upload = mongoose.model<IUpload>('Upload', uploadSchema);

export default Upload;
