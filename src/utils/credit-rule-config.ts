import { CreditRuleConfig } from '../models/mysql';

export interface CreditRuleValues {
    bookingCheckoutRewardPoints: number;
    activityCheckoutRewardPoints: number;
    activityMissedCheckoutPenaltyPoints: number;
    violationDeductPoints: number;
}

export const DEFAULT_CREDIT_RULE_VALUES: CreditRuleValues = {
    bookingCheckoutRewardPoints: Number(
        process.env.BOOKING_CHECKOUT_REWARD_POINTS ?? 2
    ),
    activityCheckoutRewardPoints: Number(
        process.env.ACTIVITY_CHECKOUT_REWARD_POINTS ?? 3
    ),
    activityMissedCheckoutPenaltyPoints: Number(
        process.env.ACTIVITY_MISSED_CHECKOUT_PENALTY_POINTS ?? 0
    ),
    violationDeductPoints: Number(process.env.VIOLATION_DEDUCT_POINTS ?? 5),
};

export async function getCreditRuleValues(): Promise<CreditRuleValues> {
    const config = await CreditRuleConfig.findOne();
    if (!config) {
        await CreditRuleConfig.create(DEFAULT_CREDIT_RULE_VALUES);
        return DEFAULT_CREDIT_RULE_VALUES;
    }

    return {
        bookingCheckoutRewardPoints:
            config.bookingCheckoutRewardPoints ??
            DEFAULT_CREDIT_RULE_VALUES.bookingCheckoutRewardPoints,
        activityCheckoutRewardPoints:
            config.activityCheckoutRewardPoints ??
            DEFAULT_CREDIT_RULE_VALUES.activityCheckoutRewardPoints,
        activityMissedCheckoutPenaltyPoints:
            config.activityMissedCheckoutPenaltyPoints ??
            DEFAULT_CREDIT_RULE_VALUES.activityMissedCheckoutPenaltyPoints,
        violationDeductPoints:
            config.violationDeductPoints ??
            DEFAULT_CREDIT_RULE_VALUES.violationDeductPoints,
    };
}
