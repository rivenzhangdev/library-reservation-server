import mongoose, { Document, Schema } from 'mongoose';

export interface IZone extends Document {
    name: string;
    description?: string;
    createdBy?: mongoose.Types.ObjectId;
    updatedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const zoneSchema = new Schema<IZone>(
    {
        name: { type: String, required: true, unique: true },
        description: { type: String },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

const Zone = mongoose.model<IZone>('Zone', zoneSchema);
export default Zone;
