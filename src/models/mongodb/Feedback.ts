import mongoose, { Document, Schema } from 'mongoose';

export interface IFeedback extends Document {
    userId: mongoose.Types.ObjectId;
    typeId: string; // suggestion|bug|complaint|other
    typeName: string;
    urgencyId?: string; // low|medium|high|urgent
    urgencyName?: string;
    title: string;
    description: string;
    contact?: string;
    images?: string[];
    status: 'pending' | 'processing' | 'resolved' | 'rejected';
    reply?: string;
    repliedBy?: mongoose.Types.ObjectId;
    replyAt?: Date;
    processedBy?: mongoose.Types.ObjectId;
    processedAt?: Date;
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
            type: String,
            required: true,
            enum: ['suggestion', 'bug', 'complaint', 'other'],
        },
        typeName: { type: String, required: true },
        urgencyId: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
        },
        urgencyName: String,
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true },
        contact: String,
        images: [String],
        status: {
            type: String,
            enum: ['pending', 'processing', 'resolved', 'rejected'],
            default: 'pending',
        },
        reply: String,
        repliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        replyAt: Date,
        processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        processedAt: Date,
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
