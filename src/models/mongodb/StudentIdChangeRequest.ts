import mongoose, { Document, Schema } from 'mongoose';

export type StudentIdChangeRequestStatus = 'pending' | 'approved' | 'rejected';
export type StudentIdChangeRequestType = 'change' | 'appeal';

export interface IStudentIdChangeRequest extends Document {
    userId: mongoose.Types.ObjectId;
    requestType: StudentIdChangeRequestType;
    oldStudentId?: string;
    oldName?: string;
    newStudentId: string;
    newRealName: string;
    reason?: string;
    precheckReasonCode?: string;
    status: StudentIdChangeRequestStatus;
    reviewerId?: mongoose.Types.ObjectId;
    reviewerName?: string;
    reviewComment?: string;
    reviewedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const studentIdChangeRequestSchema = new Schema<IStudentIdChangeRequest>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        requestType: {
            type: String,
            enum: ['change', 'appeal'],
            default: 'change',
            index: true,
        },
        oldStudentId: String,
        oldName: String,
        newStudentId: { type: String, required: true },
        newRealName: { type: String, required: true },
        reason: String,
        precheckReasonCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: '',
        },
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

studentIdChangeRequestSchema.index({ userId: 1 });
studentIdChangeRequestSchema.index({ status: 1 });
studentIdChangeRequestSchema.index({ newStudentId: 1 });
studentIdChangeRequestSchema.index({ userId: 1, status: 1, requestType: 1 });

const StudentIdChangeRequest = mongoose.model<IStudentIdChangeRequest>(
    'StudentIdChangeRequest',
    studentIdChangeRequestSchema
);

export default StudentIdChangeRequest;
