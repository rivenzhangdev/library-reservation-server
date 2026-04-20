import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { ChangeRequestType, ChangeRequestStatus } from './types';

interface BookingChangeRequestAttributes {
    id: number;
    bookingId: number;
    userId: string;
    changeType: ChangeRequestType;
    targetSeatId: number | null;
    targetDate: Date | null;
    targetTimeSlot: number | null;
    reason: string | null;
    status: ChangeRequestStatus;
    reviewerId: string | null;
    reviewComment: string | null;
    reviewedAt: Date | null;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface BookingChangeRequestCreationAttributes
    extends Optional<
        BookingChangeRequestAttributes,
        | 'id'
        | 'targetSeatId'
        | 'targetDate'
        | 'targetTimeSlot'
        | 'reason'
        | 'status'
        | 'reviewerId'
        | 'reviewComment'
        | 'reviewedAt'
        | 'createdBy'
        | 'updatedBy'
    > {}

class BookingChangeRequest
    extends Model<
        BookingChangeRequestAttributes,
        BookingChangeRequestCreationAttributes
    >
    implements BookingChangeRequestAttributes
{
    public id!: number;
    public bookingId!: number;
    public userId!: string;
    public changeType!: ChangeRequestType;
    public targetSeatId!: number | null;
    public targetDate!: Date | null;
    public targetTimeSlot!: number | null;
    public reason!: string | null;
    public status!: ChangeRequestStatus;
    public reviewerId!: string | null;
    public reviewComment!: string | null;
    public reviewedAt!: Date | null;
    public createdBy?: string | null;
    public updatedBy?: string | null;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

BookingChangeRequest.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        bookingId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'bookings', key: 'id' },
            comment: '原预约 ID',
        },
        userId: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: 'MongoDB User._id',
        },
        changeType: {
            type: DataTypes.ENUM('reschedule', 'seat_change', 'cancel'),
            allowNull: false,
            comment: '变更类型',
        },
        targetSeatId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: '目标座位 ID',
        },
        targetDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: '目标日期',
        },
        targetTimeSlot: {
            type: DataTypes.TINYINT,
            allowNull: true,
            comment: '目标时段',
        },
        reason: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: '变更原因',
        },
        status: {
            type: DataTypes.ENUM(
                'pending',
                'approved',
                'rejected',
                'auto_approved'
            ),
            defaultValue: 'pending',
            comment: '审批状态',
        },
        reviewerId: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: '审批人 User._id',
        },
        reviewComment: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: '审批备注',
        },
        reviewedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: '审批时间',
        },
        createdBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'created_by',
        },
        updatedBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'updated_by',
        },
    },
    {
        sequelize,
        tableName: 'booking_change_requests',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '预约变更申请表',
        indexes: [
            { fields: ['booking_id'], name: 'idx_change_req_booking' },
            { fields: ['user_id'], name: 'idx_change_req_user' },
            { fields: ['status'], name: 'idx_change_req_status' },
        ],
    }
);

export default BookingChangeRequest;
