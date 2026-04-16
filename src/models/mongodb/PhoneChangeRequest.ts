import mongoose, { Document, Schema } from 'mongoose';

export type PhoneChangeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface IPhoneChangeRequest extends Document {
    userId: mongoose.Types.ObjectId;
    oldPhone?: string;
    newPhone: string;
    reason?: string;
    status: PhoneChangeRequestStatus;
    reviewerId?: mongoose.Types.ObjectId;
    reviewerName?: string;
    reviewComment?: string;
    reviewedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const phoneChangeRequestSchema = new Schema<IPhoneChangeRequest>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        oldPhone: String,
        newPhone: { type: String, required: true },
        reason: String,
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
        },
        reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
        reviewerName: String,
        reviewComment: String,
        reviewedAt: Date,
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

phoneChangeRequestSchema.index({ userId: 1 });
phoneChangeRequestSchema.index({ status: 1 });
phoneChangeRequestSchema.index({ newPhone: 1 });

const PhoneChangeRequest = mongoose.model<IPhoneChangeRequest>(
    'PhoneChangeRequest',
    phoneChangeRequestSchema
);

export default PhoneChangeRequest;
