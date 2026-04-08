import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { TimeSlot, BookingStatus } from './types';

interface BookingAttributes {
    id: number;
    userId: string;
    seatId: number;
    date: Date;
    timeSlot: TimeSlot;
    startTime?: Date;
    endTime?: Date;
    status: BookingStatus;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface BookingCreationAttributes
    extends Optional<
        BookingAttributes,
        'id' | 'status' | 'startTime' | 'endTime'
    > {}

class Booking
    extends Model<BookingAttributes, BookingCreationAttributes>
    implements BookingAttributes
{
    public id!: number;
    public userId!: string;
    public seatId!: number;
    public date!: Date;
    public timeSlot!: TimeSlot;
    public startTime!: Date;
    public endTime!: Date;
    public status!: BookingStatus;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

Booking.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: '预约 ID',
        },
        userId: {
            type: DataTypes.STRING(255),
            allowNull: false,
            comment: '用户 ID(MongoDB 中的 ObjectId)',
        },
        seatId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'seats', key: 'id' },
            comment: '座位 ID',
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: '预约日期',
        },
        timeSlot: {
            type: DataTypes.TINYINT,
            allowNull: false,
            comment: '时间段 (0:上午，1:下午，2:晚上)',
        },
        startTime: {
            type: DataTypes.TIME,
            comment: '自定义开始时间',
        },
        endTime: {
            type: DataTypes.TIME,
            comment: '自定义结束时间',
        },
        status: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: BookingStatus.UPCOMING,
            comment:
                '预约状态 (0:待使用，1:进行中，2:已完成，3:已取消，4:违约)',
        },
        createdBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'created_by',
            comment: '创建者 (audit)',
        },
        updatedBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'updated_by',
            comment: '更新者 (audit)',
        },
    },
    {
        sequelize,
        tableName: 'bookings',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '预约信息表',
        indexes: [
            {
                fields: ['userId', 'date'],
                name: 'idx_booking_user_date',
            },
            {
                fields: ['seatId', 'date'],
                name: 'idx_booking_seat_date',
            },
            {
                fields: ['status'],
                name: 'idx_booking_status',
            },
        ],
    }
);

export default Booking;
