import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { SeatType } from './types';

interface SeatTypeConfigAttributes {
    id: number;
    type: SeatType;
    value: string;
    label: string;
    order: number;
    enabled: boolean;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface SeatTypeConfigCreationAttributes
    extends Optional<
        SeatTypeConfigAttributes,
        'id' | 'order' | 'enabled' | 'createdBy' | 'updatedBy'
    > {}

class SeatTypeConfig
    extends Model<SeatTypeConfigAttributes, SeatTypeConfigCreationAttributes>
    implements SeatTypeConfigAttributes
{
    public id!: number;
    public type!: SeatType;
    public value!: string;
    public label!: string;
    public order!: number;
    public enabled!: boolean;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

SeatTypeConfig.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'ID',
        },
        type: {
            type: DataTypes.TINYINT,
            allowNull: false,
            comment: 'Seat type code',
        },
        value: {
            type: DataTypes.STRING(32),
            allowNull: false,
            unique: true,
            comment: 'Seat type value key',
        },
        label: {
            type: DataTypes.STRING(64),
            allowNull: false,
            comment: 'Seat type label',
        },
        order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Display order',
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Whether this seat type is enabled',
        },
        createdBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'created_by',
            comment: 'Created by (audit)',
        },
        updatedBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'updated_by',
            comment: 'Updated by (audit)',
        },
    },
    {
        sequelize,
        tableName: 'seat_type_config',
        timestamps: true,
        underscored: true,
        comment: 'Seat type configuration table',
    }
);

export default SeatTypeConfig;
