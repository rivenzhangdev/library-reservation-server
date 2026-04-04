import mongoose, { Document, Schema } from 'mongoose';

export interface ICreditRecord extends Document {
    userId: mongoose.Types.ObjectId;
    type: number; // 0: add, 1: deduct
    points: number;
    date: Date;
    reason: string;
}

const creditRecordSchema = new Schema<ICreditRecord>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: { type: Number, enum: [0, 1], required: true },
        points: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        reason: { type: String, required: true },
    },
    {
        timestamps: true,
    }
);

// 创建索引
creditRecordSchema.index({ userId: 1, date: -1 });

const CreditRecord = mongoose.model<ICreditRecord>(
    'CreditRecord',
    creditRecordSchema
);

export default CreditRecord;
