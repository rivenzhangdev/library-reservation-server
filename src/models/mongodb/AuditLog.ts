import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
    operatorId: string;
    operatorName?: string;
    operatorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    changes?: Record<string, any>;
    metadata?: Record<string, any>;
    ip?: string;
    userAgent?: string;
    createdAt: Date;
    updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
    {
        operatorId: {
            type: String,
            required: true,
            index: true,
            comment: '操作人 User._id',
        },
        operatorName: {
            type: String,
            comment: '操作人显示名（快照）',
        },
        operatorRole: {
            type: String,
            enum: ['user', 'admin', 'operator', 'reviewer'],
            comment: '操作人角色',
        },
        action: {
            type: String,
            required: true,
            comment: '操作类型：如 booking.cancel, feedback.resolve',
        },
        targetType: {
            type: String,
            required: true,
            comment: '目标实体类型：booking, activity, feedback, user, config',
        },
        targetId: {
            type: String,
            required: true,
            comment: '目标实体 ID',
        },
        changes: {
            type: Schema.Types.Mixed,
            comment: '变更内容 { before, after }',
        },
        metadata: {
            type: Schema.Types.Mixed,
            comment: '附加上下文信息',
        },
        ip: { type: String },
        userAgent: { type: String },
    },
    {
        timestamps: true,
        collection: 'audit_logs',
    }
);

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1 });

const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

export default AuditLog;
