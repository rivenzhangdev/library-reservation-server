import mongoose, { Document, Schema } from 'mongoose';
import { normalizeCreditReason } from '../../constants/credit';

export interface ICreditRecord extends Document {
    userId: mongoose.Types.ObjectId;
    bookingId?: number;
    updatedBy?: mongoose.Types.ObjectId;
    type: number; // 0: add, 1: deduct
    points: number;
    date: Date;
    reason: string;
    reasonCode?: string;
    reasonText?: string;
}

const creditRecordSchema = new Schema<ICreditRecord>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        bookingId: { type: Number, index: true },
        type: { type: Number, enum: [0, 1], required: true },
        points: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        reason: { type: String, required: true },
        reasonCode: { type: String, index: true },
        reasonText: { type: String },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    {
        timestamps: true,
    }
);

creditRecordSchema.pre('save', function (next) {
    if (this.reason) {
        const normalized = normalizeCreditReason(this.reason);
        this.reason = normalized.reason;
        if (!this.reasonCode) {
            this.reasonCode = normalized.reasonCode;
        }
        if (!this.reasonText) {
            this.reasonText = normalized.reasonText;
        }
    }
    next();
});

// 创建索引
creditRecordSchema.index({ userId: 1, date: -1 });

const CreditRecord = mongoose.model<ICreditRecord>(
    'CreditRecord',
    creditRecordSchema
);

export default CreditRecord;
