import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';

interface ZoneAttributes {
    id: number;
    name: string;
    description?: string;
    status?: number;
}

interface ZoneCreationAttributes
    extends Optional<ZoneAttributes, 'id' | 'description' | 'status'> {}

class Zone
    extends Model<ZoneAttributes, ZoneCreationAttributes>
    implements ZoneAttributes
{
    public id!: number;
    public name!: string;
    public description!: string;
    public status!: number;
}

Zone.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
        },
        status: {
            type: DataTypes.TINYINT,
            defaultValue: 1,
        },
    },
    {
        sequelize,
        tableName: 'zones',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '区域表 (用于与座位关联)',
    }
);

export default Zone;
