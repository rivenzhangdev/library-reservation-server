import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
    userId: mongoose.Types.ObjectId;
    type: 'system' | 'booking' | 'activity' | 'marketing';
    title: string;
    content: string;
    time: Date;
    isRead: boolean;
    relatedId?: string;
    data?: any;
}

const notificationSchema = new Schema<INotification>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: {
            type: String,
            enum: ['system', 'booking', 'activity', 'marketing'],
            required: true,
        },
        title: { type: String, required: true },
        content: { type: String, required: true },
        time: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false },
        relatedId: String,
        data: Schema.Types.Mixed,
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
