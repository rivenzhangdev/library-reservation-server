import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../../database/mysql';

interface CreditRuleConfigAttributes {
    id: number;
    bookingCheckoutRewardPoints: number;
    activityCheckoutRewardPoints: number;
    activityMissedCheckoutPenaltyPoints: number;
    violationDeductPoints: number;
    createdBy?: string | null;
    updatedBy?: string | null;
}

interface CreditRuleConfigCreationAttributes
    extends Optional<
        CreditRuleConfigAttributes,
        'id' | 'createdBy' | 'updatedBy'
    > {}

class CreditRuleConfig
    extends Model<
        CreditRuleConfigAttributes,
        CreditRuleConfigCreationAttributes
    >
    implements CreditRuleConfigAttributes
{
    public id!: number;
    public bookingCheckoutRewardPoints!: number;
    public activityCheckoutRewardPoints!: number;
    public activityMissedCheckoutPenaltyPoints!: number;
    public violationDeductPoints!: number;
    public createdBy!: string | null;
    public updatedBy!: string | null;
}

CreditRuleConfig.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            comment: 'ID',
        },
        bookingCheckoutRewardPoints: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 2,
            comment: 'Booking checkout reward points',
        },
        activityCheckoutRewardPoints: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 3,
            comment: 'Activity checkout reward points',
        },
        activityMissedCheckoutPenaltyPoints: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Points deducted for missed activity checkout',
        },
        violationDeductPoints: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 5,
            comment: 'Points deducted for violations',
        },
        createdBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'created_by',
            comment: 'Created by',
        },
        updatedBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'updated_by',
            comment: 'Updated by',
        },
    },
    {
        sequelize,
        tableName: 'credit_rule_config',
        timestamps: true,
        underscored: true,
        comment: 'Credit rule configuration table',
    }
);

export default CreditRuleConfig;
