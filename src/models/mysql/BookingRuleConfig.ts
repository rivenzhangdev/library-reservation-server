import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';
import { BookingRuleCategory } from './types';

interface BookingRuleConfigAttributes {
    id: number;
    ruleKey: string;
    ruleValue: string;
    description: string | null;
    category: BookingRuleCategory;
    enabled: boolean;
    createdBy: string | null;
    updatedBy: string | null;
}

interface BookingRuleConfigCreationAttributes
    extends Optional<
        BookingRuleConfigAttributes,
        | 'id'
        | 'description'
        | 'category'
        | 'enabled'
        | 'createdBy'
        | 'updatedBy'
    > {}

class BookingRuleConfig
    extends Model<
        BookingRuleConfigAttributes,
        BookingRuleConfigCreationAttributes
    >
    implements BookingRuleConfigAttributes
{
    public id!: number;
    public ruleKey!: string;
    public ruleValue!: string;
    public description!: string | null;
    public category!: BookingRuleCategory;
    public enabled!: boolean;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

BookingRuleConfig.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        ruleKey: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            comment: '规则键名',
        },
        ruleValue: {
            type: DataTypes.STRING(500),
            allowNull: false,
            comment: '规则值',
        },
        description: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: '规则描述',
        },
        category: {
            type: DataTypes.ENUM('booking', 'renewal', 'cancel', 'general'),
            defaultValue: 'general',
            comment: '规则分类',
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            comment: '是否启用',
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
        tableName: 'booking_rule_config',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        comment: '预约规则配置表',
    }
);

export default BookingRuleConfig;
