import assert from 'node:assert';
import { normalizeCreditReason, CreditReasons } from '../src/constants/credit';

export async function runTests() {
  await testNormalizeCreditReasonCode();
  await testNormalizeCreditReasonLegacyText();
  await testNormalizeCreditReasonUnknownReason();
}

async function testNormalizeCreditReasonCode() {
  const result = normalizeCreditReason(CreditReasons.BOOKING_CHECKOUT_REWARD);
  assert.strictEqual(result.reason, CreditReasons.BOOKING_CHECKOUT_REWARD);
  assert.strictEqual(result.reasonCode, CreditReasons.BOOKING_CHECKOUT_REWARD);
  assert.strictEqual(result.reasonText, 'Booking checkout reward');
}

async function testNormalizeCreditReasonLegacyText() {
  const result = normalizeCreditReason('Violation penalty');
  assert.strictEqual(result.reason, CreditReasons.VIOLATION_PENALTY);
  assert.strictEqual(result.reasonCode, CreditReasons.VIOLATION_PENALTY);
  assert.strictEqual(result.reasonText, 'Violation penalty');
}

async function testNormalizeCreditReasonUnknownReason() {
  const result = normalizeCreditReason('Some custom reason');
  assert.strictEqual(result.reason, 'Some custom reason');
  assert.strictEqual(result.reasonCode, undefined);
  assert.strictEqual(result.reasonText, 'Some custom reason');
}
