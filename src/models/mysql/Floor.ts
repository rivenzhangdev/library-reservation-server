import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';

interface FloorAttributes {
    id: number;
    name: string;
    description?: string;
    totalSeats: number;
}

interface FloorCreationAttributes
    extends Optional<FloorAttributes, 'id' | 'totalSeats'> {}

class Floor
    extends Model<FloorAttributes, FloorCreationAttributes>
    implements FloorAttributes
{
    public id!: number;
    public name!: string;
    public description!: string;
    public totalSeats!: number;
}

Floor.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: '楼层ID',
        },
        name: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: '楼层名称',
        },
        description: {
            type: DataTypes.TEXT,
            comment: '楼层描述',
        },
        totalSeats: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: '总座位数',
        },
    },
    {
        sequelize,
        tableName: 'floors',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '楼层信息表',
    }
);

export default Floor;
