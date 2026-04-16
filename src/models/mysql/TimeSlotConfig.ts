import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { TimeSlot } from './types';

interface TimeSlotConfigAttributes {
    id: number;
    timeSlot: TimeSlot;
    value: string;
    label: string;
    startTime: string;
    endTime: string;
    order: number;
    enabled: boolean;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface TimeSlotConfigCreationAttributes
    extends Optional<
        TimeSlotConfigAttributes,
        'id' | 'order' | 'enabled' | 'createdBy' | 'updatedBy'
    > {}

class TimeSlotConfig
    extends Model<TimeSlotConfigAttributes, TimeSlotConfigCreationAttributes>
    implements TimeSlotConfigAttributes
{
    public id!: number;
    public timeSlot!: TimeSlot;
    public value!: string;
    public label!: string;
    public startTime!: string;
    public endTime!: string;
    public order!: number;
    public enabled!: boolean;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

TimeSlotConfig.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'ID',
        },
        timeSlot: {
            type: DataTypes.TINYINT,
            allowNull: false,
            comment: '时间段编号 (0:上午,1:下午,2:晚上)',
        },
        value: {
            type: DataTypes.STRING(32),
            allowNull: false,
            unique: true,
            comment: '时间段标识',
        },
        label: {
            type: DataTypes.STRING(32),
            allowNull: false,
            comment: '时间段标签',
        },
        startTime: {
            type: DataTypes.STRING(5),
            allowNull: false,
            comment: '时间段开始时间',
        },
        endTime: {
            type: DataTypes.STRING(5),
            allowNull: false,
            comment: '时间段结束时间',
        },
        order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: '显示顺序',
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: '是否启用',
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
        tableName: 'time_slot_config',
        timestamps: true,
        underscored: true,
        comment: '时间段配置表',
    }
);

export default TimeSlotConfig;
