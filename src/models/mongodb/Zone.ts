import mongoose, { Document, Schema } from 'mongoose';

export interface IZone extends Document {
    name: string;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
}

const zoneSchema = new Schema<IZone>(
    {
        name: { type: String, required: true, unique: true },
        description: { type: String },
    },
    { timestamps: true }
);

const Zone = mongoose.model<IZone>('Zone', zoneSchema);
export default Zone;
