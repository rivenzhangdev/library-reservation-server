import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { TimeSlot, TimeSlotStatusValue } from './types';

interface TimeSlotStatusAttributes {
    id: number;
    seatId: number;
    date: Date;
    timeSlot: TimeSlot;
    status: TimeSlotStatusValue;
    bookingId?: number;
}

interface TimeSlotStatusCreationAttributes
    extends Optional<TimeSlotStatusAttributes, 'id' | 'status' | 'bookingId'> {}

class TimeSlotStatus
    extends Model<TimeSlotStatusAttributes, TimeSlotStatusCreationAttributes>
    implements TimeSlotStatusAttributes
{
    public id!: number;
    public seatId!: number;
    public date!: Date;
    public timeSlot!: TimeSlot;
    public status!: TimeSlotStatusValue;
    public bookingId!: number;
}

TimeSlotStatus.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'ID',
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
            comment: '日期',
        },
        timeSlot: {
            type: DataTypes.TINYINT,
            allowNull: false,
            comment: '时间段 (0:上午，1:下午，2:晚上)',
        },
        status: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: TimeSlotStatusValue.AVAILABLE,
            comment: '状态 (0:可用，1:已预约，2:维修中)',
        },
        bookingId: {
            type: DataTypes.INTEGER,
            references: { model: 'bookings', key: 'id' },
            comment: '预约 ID',
        },
    },
    {
        sequelize,
        tableName: 'time_slot_status',
        timestamps: true,
        createdAt: false,
        updatedAt: 'updated_at',
        comment: '时间段座位状态表',
        indexes: [
            {
                fields: ['seatId', 'date', 'timeSlot'],
                unique: true,
                name: 'idx_time_slot_status',
            },
        ],
    }
);

export default TimeSlotStatus;
