import assert from 'node:assert';

const configModule: any = require('../src/routes/config');
const creditConfigUtil: any = require('../src/utils/credit-rule-config');
const { CreditRuleConfig, BookingRuleConfig } = require('../src/models/mysql');

export async function runTests() {
  await testGetCreditRulesReturnsStoredValues();
  await testGetBookingRulesReturnsActiveValues();
  await testUpdateCreditRulesCreatesNewConfig();
  await testUpdateCreditRulesUpdatesExistingConfig();
  await testUpdateCreditRulesRejectsInvalidValues();
}

async function testGetCreditRulesReturnsStoredValues() {
  const originalGetCreditRuleValues = creditConfigUtil.getCreditRuleValues;
  creditConfigUtil.getCreditRuleValues = async () => ({
    bookingCheckoutRewardPoints: 2,
    activityCheckoutRewardPoints: 3,
    activityMissedCheckoutPenaltyPoints: 1,
    violationDeductPoints: 5,
  });

  try {
    const ctx: any = {};
    await configModule.getCreditRules(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.deepStrictEqual(ctx.body.data, {
      bookingCheckoutRewardPoints: 2,
      activityCheckoutRewardPoints: 3,
      activityMissedCheckoutPenaltyPoints: 1,
      violationDeductPoints: 5,
    });
  } finally {
    creditConfigUtil.getCreditRuleValues = originalGetCreditRuleValues;
  }
}

async function testGetBookingRulesReturnsActiveValues() {
  const originalFindOne = BookingRuleConfig.findOne;
  BookingRuleConfig.findOne = async () => ({ ruleValue: '3' });

  try {
    const ctx: any = {};
    await configModule.getBookingRules(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.deepStrictEqual(ctx.body.data, {
      minCustomBookingDurationMinutes: 30,
      checkinWindowMinutes: 15,
      maxRenewalExtraSlots: 3,
    });
  } finally {
    BookingRuleConfig.findOne = originalFindOne;
  }
}

async function testUpdateCreditRulesCreatesNewConfig() {
  const originalFindOne = CreditRuleConfig.findOne;
  const originalCreate = CreditRuleConfig.create;
  CreditRuleConfig.findOne = async () => null;
  let createdPayload: any = null;
  CreditRuleConfig.create = async (payload: any) => {
    createdPayload = payload;
    return payload;
  };

  try {
    const ctx: any = {
      request: {
        body: {
          bookingCheckoutRewardPoints: '4',
          activityCheckoutRewardPoints: '5',
          activityMissedCheckoutPenaltyPoints: '2',
          violationDeductPoints: '6',
        },
      },
      state: { user: { id: 'admin1' } },
    };
    await configModule.updateCreditRules(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.deepStrictEqual(ctx.body.data, {
      bookingCheckoutRewardPoints: 4,
      activityCheckoutRewardPoints: 5,
      activityMissedCheckoutPenaltyPoints: 2,
      violationDeductPoints: 6,
    });
    assert.strictEqual(createdPayload.bookingCheckoutRewardPoints, 4);
    assert.strictEqual(createdPayload.updatedBy, 'admin1');
    assert.strictEqual(createdPayload.createdBy, 'admin1');
  } finally {
    CreditRuleConfig.findOne = originalFindOne;
    CreditRuleConfig.create = originalCreate;
  }
}

async function testUpdateCreditRulesUpdatesExistingConfig() {
  const originalFindOne = CreditRuleConfig.findOne;
  const originalUpdate = CreditRuleConfig.prototype.update;
  const existingConfig: any = {
    update: async function (payload: any) {
      this.data = payload;
      return this;
    },
  };
  CreditRuleConfig.findOne = async () => existingConfig;

  let updatedPayload: any = null;
  existingConfig.update = async (payload: any) => {
    updatedPayload = payload;
    return payload;
  };

  try {
    const ctx: any = {
      request: {
        body: {
          bookingCheckoutRewardPoints: 7,
          activityCheckoutRewardPoints: 8,
          activityMissedCheckoutPenaltyPoints: 3,
          violationDeductPoints: 9,
        },
      },
      state: { user: { id: 'admin2' } },
    };
    await configModule.updateCreditRules(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.deepStrictEqual(ctx.body.data, {
      bookingCheckoutRewardPoints: 7,
      activityCheckoutRewardPoints: 8,
      activityMissedCheckoutPenaltyPoints: 3,
      violationDeductPoints: 9,
    });
    assert.strictEqual(updatedPayload.updatedBy, 'admin2');
  } finally {
    CreditRuleConfig.findOne = originalFindOne;
    CreditRuleConfig.prototype.update = originalUpdate;
  }
}

async function testUpdateCreditRulesRejectsInvalidValues() {
  const ctx: any = {
    request: {
      body: {
        bookingCheckoutRewardPoints: -1,
        activityCheckoutRewardPoints: 5,
        activityMissedCheckoutPenaltyPoints: 2,
        violationDeductPoints: 6,
      },
    },
    state: { user: { id: 'admin3' } },
  };

  await assert.rejects(
    async () => {
      await configModule.updateCreditRules(ctx);
    },
    {
      message: 'Invalid credit rule values',
    }
  );
}
