import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';

interface SeatFacilityConfigAttributes {
    id: number;
    key: string;
    label: string;
    icon: string;
    order: number;
    enabled: boolean;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface SeatFacilityConfigCreationAttributes
    extends Optional<
        SeatFacilityConfigAttributes,
        'id' | 'order' | 'enabled' | 'createdBy' | 'updatedBy'
    > {}

class SeatFacilityConfig
    extends Model<
        SeatFacilityConfigAttributes,
        SeatFacilityConfigCreationAttributes
    >
    implements SeatFacilityConfigAttributes
{
    public id!: number;
    public key!: string;
    public label!: string;
    public icon!: string;
    public order!: number;
    public enabled!: boolean;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

SeatFacilityConfig.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'ID',
        },
        key: {
            type: DataTypes.STRING(32),
            allowNull: false,
            unique: true,
            comment: 'Facility key',
        },
        label: {
            type: DataTypes.STRING(64),
            allowNull: false,
            comment: 'Facility label',
        },
        icon: {
            type: DataTypes.STRING(64),
            allowNull: false,
            defaultValue: 'search',
            comment: 'Display icon key',
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
            comment: 'Whether this facility is enabled',
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
        tableName: 'seat_facility_config',
        timestamps: true,
        underscored: true,
        comment: 'Seat facility configuration table',
    }
);

export default SeatFacilityConfig;
