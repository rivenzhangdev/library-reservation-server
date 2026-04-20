export const CreditReasons = {
    VIOLATION_PENALTY: 'VIOLATION_PENALTY',
    BOOKING_CHECKIN: 'BOOKING_CHECKIN',
    BOOKING_CHECKOUT_REWARD: 'BOOKING_CHECKOUT_REWARD',
    ACTIVITY_CHECKIN: 'ACTIVITY_CHECKIN',
    ACTIVITY_CHECKOUT_REWARD: 'ACTIVITY_CHECKOUT_REWARD',
    ACTIVITY_MISSED_CHECKOUT: 'ACTIVITY_MISSED_CHECKOUT',
    ADMIN_ADD: 'ADMIN_ADD',
    ADMIN_DEDUCT: 'ADMIN_DEDUCT',
    BOOKING_LATE_CANCEL_PENALTY: 'BOOKING_LATE_CANCEL_PENALTY',
} as const;

export enum ViolationRecordType {
    VIOLATION = 1,
}

export const CreditReasonLabels: Record<string, string> = {
    [CreditReasons.VIOLATION_PENALTY]: 'Violation penalty',
    [CreditReasons.BOOKING_CHECKIN]: 'Booking check-in',
    [CreditReasons.BOOKING_CHECKOUT_REWARD]: 'Booking checkout reward',
    [CreditReasons.ACTIVITY_CHECKIN]: 'Activity check-in',
    [CreditReasons.ACTIVITY_CHECKOUT_REWARD]: 'Activity checkout reward',
    [CreditReasons.ACTIVITY_MISSED_CHECKOUT]: 'Activity missed checkout',
    [CreditReasons.ADMIN_ADD]: 'Admin add points',
    [CreditReasons.ADMIN_DEDUCT]: 'Admin deduct points',
    [CreditReasons.BOOKING_LATE_CANCEL_PENALTY]: 'Booking late cancel penalty',
};

const creditReasonLabelToCode: Record<string, string> = Object.entries(
    CreditReasonLabels
).reduce(
    (acc, [code, label]) => {
        acc[label.toLowerCase()] = code;
        return acc;
    },
    {} as Record<string, string>
);

export function normalizeCreditReason(input?: string) {
    const reason = String(input ?? '').trim();
    if (!reason) {
        return {
            reason: '',
            reasonCode: undefined,
            reasonText: '',
        };
    }

    const normalizedInput = reason.trim();
    const normalizedKey = normalizedInput.toUpperCase().replace(/\s+/g, '_');

    if (Object.values(CreditReasons).includes(normalizedInput as any)) {
        return {
            reason: normalizedInput,
            reasonCode: normalizedInput,
            reasonText: CreditReasonLabels[normalizedInput] || normalizedInput,
        };
    }

    if (Object.values(CreditReasons).includes(normalizedKey as any)) {
        return {
            reason: normalizedKey,
            reasonCode: normalizedKey,
            reasonText: CreditReasonLabels[normalizedKey] || normalizedKey,
        };
    }

    const legacyCode = creditReasonLabelToCode[normalizedInput.toLowerCase()];
    if (legacyCode) {
        return {
            reason: legacyCode,
            reasonCode: legacyCode,
            reasonText: normalizedInput,
        };
    }

    return {
        reason: normalizedInput,
        reasonCode: undefined,
        reasonText: normalizedInput,
    };
}

export const SystemDisplayName = 'System' as const;
