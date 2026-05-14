import mongoose, { Document, Schema } from 'mongoose';

export interface IFeedback extends Document {
    userId: mongoose.Types.ObjectId;
    typeId: number; // 1: suggestion,2:bug,3:complaint,4:other
    typeName: string;
    urgencyId?: number; // 1:low,2:medium,3:high,4:urgent
    urgencyName?: string;
    title: string;
    description: string;
    contact?: string;
    images?: string[];
    status: number; // 1:pending,2:processing,3:resolved,4:rejected
    reply?: string;
    remark?: string;
    repliedBy?: mongoose.Types.ObjectId;
    replyAt?: Date;
    processedBy?: mongoose.Types.ObjectId;
    updatedBy?: mongoose.Types.ObjectId;
    processedAt?: Date;
    processedReason?: string;
    comments?: Array<{
        operator: string;
        content: string;
        date: Date;
        isOfficial?: boolean;
    }>;
    createdAt: Date;
    updatedAt: Date;
}

const feedbackSchema = new Schema<IFeedback>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        typeId: {
            type: Number,
            required: true,
            enum: [1, 2, 3, 4],
        },
        typeName: { type: String, required: true },
        urgencyId: {
            type: Number,
            enum: [1, 2, 3, 4],
        },
        urgencyName: String,
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true },
        contact: String,
        images: [String],
        status: {
            type: Number,
            enum: [1, 2, 3, 4],
            default: 1,
        },
        reply: String,
        remark: String,
        repliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        replyAt: Date,
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        processedAt: Date,
        processedReason: String,
        comments: [
            {
                operator: String,
                content: String,
                date: Date,
                isOfficial: Boolean,
            },
        ],
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// 创建索引
feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ status: 1 });
feedbackSchema.index({ typeId: 1 });
feedbackSchema.index({ createdAt: -1 });

// 虚拟字段：用户信息
feedbackSchema.virtual('user', {
    ref: 'User',
    localField: 'userId',
    foreignField: '_id',
    justOne: true,
});

const Feedback = mongoose.model<IFeedback>('Feedback', feedbackSchema);

export default Feedback;
