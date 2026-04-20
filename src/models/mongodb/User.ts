import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
    username: string;
    password: string;
    openid?: string;
    email?: string;
    phone?: string;
    studentId?: string;
    name?: string;
    avatar?: string;
    role: number;
    isSuperAdmin?: boolean;
    creditScore: number;
    blacklisted: boolean;
    blacklistReason?: string;
    settings: {
        notifications: {
            bookingSuccess: boolean;
            bookingReminder: boolean;
            checkinReminder: boolean;
            violationNotice: boolean;
            activityNotice: boolean;
            systemNotice: boolean;
            marketingNotice: boolean;
        };
        doNotDisturb: {
            enabled: boolean;
            startTime: string;
            endTime: string;
        };
        privacy: {
            shareLocation: boolean;
            shareUsageData: boolean;
            publicProfile: boolean;
        };
    };
    favorites: number[];
    activityRegistrations?: Array<{
        activity: mongoose.Types.ObjectId;
        registeredAt: Date;
    }>;
    createdBy?: mongoose.Types.ObjectId;
    updatedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>(
    {
        username: { type: String, unique: true, required: true },
        password: { type: String, required: true },
        openid: { type: String, unique: true, sparse: true },
        email: { type: String, unique: true, sparse: true },
        phone: { type: String, unique: true, sparse: true },
        studentId: { type: String, unique: true, sparse: true },
        name: String,
        avatar: String,
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        role: { type: Number, enum: [0, 1], default: 0 },
        isSuperAdmin: { type: Boolean, default: false },
        creditScore: { type: Number, default: 100 },
        blacklisted: { type: Boolean, default: false },
        blacklistReason: String,
        settings: {
            notifications: {
                bookingSuccess: { type: Boolean, default: true },
                bookingReminder: { type: Boolean, default: true },
                checkinReminder: { type: Boolean, default: true },
                violationNotice: { type: Boolean, default: true },
                activityNotice: { type: Boolean, default: true },
                systemNotice: { type: Boolean, default: true },
                marketingNotice: { type: Boolean, default: false },
            },
            doNotDisturb: {
                enabled: { type: Boolean, default: false },
                startTime: String,
                endTime: String,
            },
            privacy: {
                shareLocation: { type: Boolean, default: false },
                shareUsageData: { type: Boolean, default: false },
                publicProfile: { type: Boolean, default: false },
            },
        },
        favorites: [{ type: Number }],
        activityRegistrations: [
            {
                activity: { type: Schema.Types.ObjectId, ref: 'Activity' },
                registeredAt: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// 创建索引（保留非重复索引）
userSchema.index({ role: 1 });
userSchema.index({ openid: 1 });
userSchema.index({ 'activityRegistrations.activity': 1 });

const User = mongoose.model<IUser>('User', userSchema);

export default User;
