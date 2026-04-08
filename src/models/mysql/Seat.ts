import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { SeatStatus, SeatType } from './types';

interface SeatAttributes {
    id: number;
    floorId: number;
    rowNum: number;
    colNum: number;
    status: SeatStatus;
    type: SeatType;
    hasSocket: boolean;
    isWindow: boolean;
    zone?: string;
    description?: string;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface SeatCreationAttributes
    extends Optional<
        SeatAttributes,
        | 'id'
        | 'status'
        | 'type'
        | 'hasSocket'
        | 'isWindow'
        | 'zone'
        | 'description'
        | 'createdBy'
        | 'updatedBy'
    > {}

class Seat
    extends Model<SeatAttributes, SeatCreationAttributes>
    implements SeatAttributes
{
    public id!: number;
    public floorId!: number;
    public rowNum!: number;
    public colNum!: number;
    public status!: SeatStatus;
    public type!: SeatType;
    public hasSocket!: boolean;
    public isWindow!: boolean;
    public zone!: string;
    public description!: string;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

Seat.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: '座位 ID',
        },
        floorId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'floors', key: 'id' },
            comment: '所属楼层 ID',
        },
        rowNum: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: '行号',
        },
        colNum: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: '列号',
        },
        status: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: SeatStatus.AVAILABLE,
            comment: '座位状态 (0:可用，1:维修中)',
        },
        type: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: SeatType.SINGLE,
            comment: '座位类型 (0:单人间，1:双人间，2:多人间)',
        },
        hasSocket: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: '是否有插座',
        },
        isWindow: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            comment: '是否靠窗',
        },
        zone: {
            type: DataTypes.STRING(50),
            comment: '所属区域',
        },
        description: {
            type: DataTypes.TEXT,
            comment: '座位描述',
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
        tableName: 'seats',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '座位信息表',
        indexes: [
            {
                fields: ['floorId', 'rowNum', 'colNum'],
                unique: true,
                name: 'idx_seat_row_col',
            },
        ],
    }
);

export default Seat;
