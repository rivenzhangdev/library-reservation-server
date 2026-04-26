import mongoose, { Document, Schema } from 'mongoose';

export interface IStudentRegistry extends Document {
    studentId: string;
    realName: string;
    college?: string;
    major?: string;
    grade?: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const studentRegistrySchema = new Schema<IStudentRegistry>(
    {
        studentId: { type: String, required: true, unique: true, index: true },
        realName: { type: String, required: true },
        college: { type: String },
        major: { type: String },
        grade: { type: String },
        active: { type: Boolean, default: true, index: true },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

studentRegistrySchema.index({ studentId: 1, active: 1 });

const StudentRegistry = mongoose.model<IStudentRegistry>(
    'StudentRegistry',
    studentRegistrySchema
);

export default StudentRegistry;
