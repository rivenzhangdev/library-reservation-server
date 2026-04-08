import mongoose, { Document, Schema } from 'mongoose';

export interface IActivity extends Document {
    title: string;
    description: string;
    coverImage: string;
    startTime: Date;
    endTime: Date;
    location: string;
    status: number; // 0: upcoming, 1: ongoing, 2: ended
    participants: mongoose.Types.ObjectId[];
    maxParticipants: number;
    rules: string;
    awards: string;
    createdBy: mongoose.Types.ObjectId;
    updatedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const activitySchema = new Schema<IActivity>(
    {
        title: { type: String, required: true },
        description: { type: String, default: '' },
        coverImage: String,
        startTime: { type: Date, required: true },
        endTime: { type: Date, required: true },
        location: { type: String, default: '' },
        status: {
            type: Number,
            enum: [0, 1, 2],
            default: 0,
        },
        participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        maxParticipants: { type: Number, default: 100 },
        rules: String,
        awards: String,
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    {
        timestamps: true,
    }
);

// 创建索引
activitySchema.index({ status: 1, startTime: 1 });
activitySchema.index({ participants: 1 });

const Activity = mongoose.model<IActivity>('Activity', activitySchema);

export default Activity;
