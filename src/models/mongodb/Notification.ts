import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
    userId: mongoose.Types.ObjectId;
    createdBy?: mongoose.Types.ObjectId;
    updatedBy?: mongoose.Types.ObjectId;
    type: number; // 0: system, 1: booking, 2: activity, 3: marketing
    title: string;
    content: string;
    time: Date;
    isRead: boolean;
    relatedId?: string;
    targetType?: 'user' | 'role' | 'floor' | 'all';
    targetRole?: number;
    floorId?: string;
    data?: any;
    templateType?: string;
    templateId?: string;
    templatePage?: string;
    templateData?: any;
    templatePayload?: any;
}

const notificationSchema = new Schema<INotification>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: {
            type: Number,
            enum: [0, 1, 2, 3],
            required: true,
        },
        title: { type: String, required: true },
        content: { type: String, required: true },
        time: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false },
        relatedId: String,
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        targetType: {
            type: String,
            enum: ['user', 'role', 'floor', 'all'],
            default: 'user',
        },
        targetRole: { type: Number, enum: [0, 1] },
        floorId: { type: String },
        data: Schema.Types.Mixed,
        templateType: { type: String },
        templateId: { type: String },
        templatePage: { type: String },
        templateData: Schema.Types.Mixed,
        templatePayload: Schema.Types.Mixed,
    },
    {
        timestamps: true,
    }
);

// 创建索引
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ time: -1 });

const Notification = mongoose.model<INotification>(
    'Notification',
    notificationSchema
);

export default Notification;
