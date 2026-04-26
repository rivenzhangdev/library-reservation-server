import assert from 'node:assert';
import {
  CHECKIN_WINDOW_MINUTES,
  MIN_CUSTOM_BOOKING_DURATION_MINUTES,
  getBookingEndMinutes,
  getBookingStartMinutes,
  getTimeSlotRange,
  isBeforeToday,
  isCheckinAllowed,
  isPastTimeSlot,
  isSameDay,
  parseLocalDate,
  parseTimeToMinutes,
  validateBookingTimeRange,
} from '../src/utils/booking-rules';
import { resolveTimeSlot } from '../src/utils/time-slot-config';
import { buildRenewBookingData, isBookingOverdue } from '../src/routes/booking';

type BookingStub = {
  startTime?: string;
  endTime?: string;
  timeSlot?: number;
  date?: string;
};

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function runTests() {
  testParseTimeToMinutes();
  testIsSameDay();
  testParseLocalDate();
  await testResolveTimeSlot();
  await testBuildRenewBookingData();
  await testGetBookingStartEndMinutes();
  await testValidateBookingTimeRange();
  await testValidateBookingTimeRangeInvalid();
  await testIsBookingOverdue();
  await testCheckinWindow();
  testIsBeforeToday();
  await testIsPastTimeSlot();
  testConfigConstants();
}

function testParseTimeToMinutes() {
  assert.strictEqual(parseTimeToMinutes('00:00'), 0);
  assert.strictEqual(parseTimeToMinutes('09:30'), 570);
  assert.strictEqual(parseTimeToMinutes('23:59'), 1439);
  assert.strictEqual(parseTimeToMinutes('24:00'), undefined);
  assert.strictEqual(parseTimeToMinutes('09:60'), undefined);
}

function testIsSameDay() {
  const today = new Date();
  const todayStr = toLocalDateString(today);
  assert.strictEqual(isSameDay(todayStr, today), true);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  assert.strictEqual(isSameDay(tomorrow.toISOString(), today), false);

  assert.strictEqual(isSameDay('2000-01-01', today), false);
}

function testParseLocalDate() {
  const parsed = parseLocalDate('2025-12-31');
  assert.ok(parsed instanceof Date);
  assert.strictEqual(parsed?.getFullYear(), 2025);
  assert.strictEqual(parsed?.getMonth(), 11);
  assert.strictEqual(parsed?.getDate(), 31);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const isoParsed = parseLocalDate(tomorrow.toISOString());
  assert.ok(isoParsed instanceof Date);
  assert.strictEqual(isoParsed?.getFullYear(), tomorrow.getFullYear());
  assert.strictEqual(isoParsed?.getMonth(), tomorrow.getMonth());
  assert.strictEqual(isoParsed?.getDate(), tomorrow.getDate());

  assert.strictEqual(parseLocalDate('invalid-date'), undefined);
}

async function testResolveTimeSlot() {
  assert.strictEqual(await resolveTimeSlot(0), 0);
  assert.strictEqual(await resolveTimeSlot('morning'), 0);
  assert.strictEqual(await resolveTimeSlot('afternoon'), 1);
  assert.strictEqual(await resolveTimeSlot('evening'), 2);
  assert.strictEqual(await resolveTimeSlot('nonexistent'), undefined);
}

async function testBuildRenewBookingData() {
  const futureDate = toLocalDateString(
    new Date(Date.now() + 24 * 60 * 60 * 1000)
  );
  const booking = { date: futureDate };
  const renewalData = await buildRenewBookingData(booking as any, 1);
  assert.strictEqual(renewalData.timeSlot, 1);
  assert.strictEqual(renewalData.startTime, '13:00');
  assert.strictEqual(renewalData.endTime, '17:00');
  assert.strictEqual(renewalData.date.toISOString().split('T')[0], futureDate);
}

async function testGetBookingStartEndMinutes() {
  const booking1: BookingStub = {
    startTime: '08:00',
    endTime: '10:00',
  };
  assert.strictEqual(await getBookingStartMinutes(booking1), 480);
  assert.strictEqual(await getBookingEndMinutes(booking1), 600);

  const booking2: BookingStub = {
    timeSlot: 0,
  };
  const range = await getTimeSlotRange(0);
  const expectedStart = parseTimeToMinutes(range.start);
  const expectedEnd = parseTimeToMinutes(range.end);
  assert.strictEqual(await getBookingStartMinutes(booking2), expectedStart);
  assert.strictEqual(await getBookingEndMinutes(booking2), expectedEnd);
}

async function testValidateBookingTimeRange() {
  const futureDate = toLocalDateString(
    new Date(Date.now() + 24 * 60 * 60 * 1000)
  );
  const resultFull = await validateBookingTimeRange({
    date: futureDate,
    timeSlot: 0,
  });
  assert.strictEqual(resultFull.isCustomTime, false);
  assert.strictEqual(resultFull.startTime, '08:00');
  assert.strictEqual(resultFull.endTime, '12:00');

  const customResult = await validateBookingTimeRange({
    date: futureDate,
    timeSlot: 0,
    startTime: '09:00',
    endTime: '10:00',
  });
  assert.strictEqual(customResult.isCustomTime, true);
  assert.strictEqual(customResult.startTime, '09:00');
  assert.strictEqual(customResult.endTime, '10:00');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const isoCustomResult = await validateBookingTimeRange({
    date: tomorrow.toISOString(),
    timeSlot: 2,
    startTime: '18:00',
    endTime: '22:00',
  });
  assert.strictEqual(isoCustomResult.isCustomTime, true);
  assert.strictEqual(isoCustomResult.startTime, '18:00');
  assert.strictEqual(isoCustomResult.endTime, '22:00');
}

async function testValidateBookingTimeRangeInvalid() {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  await assert.rejects(
    async () =>
      validateBookingTimeRange({
        date: futureDate,
        timeSlot: 0,
        startTime: '09:00',
      }),
    {
      message: 'Start time and end time must both be provided for custom time',
    }
  );

  await assert.rejects(
    async () =>
      validateBookingTimeRange({
        date: futureDate,
        timeSlot: 0,
        startTime: '09:00',
        endTime: '09:15',
      }),
    {
      message: 'Custom time must be at least 30 minutes',
    }
  );

  await assert.rejects(
    async () =>
      validateBookingTimeRange({
        date: '2025-13-42',
        timeSlot: 0,
      }),
    {
      message: 'Invalid date',
    }
  );
}

async function testIsBookingOverdue() {
  const pastBooking = {
    date: '2000-01-01',
    timeSlot: 0,
    startTime: '08:00',
    endTime: '12:00',
  };
  assert.strictEqual(await isBookingOverdue(pastBooking as any), true);

  const futureBooking = {
    date: '2099-01-01',
    timeSlot: 0,
    startTime: '08:00',
    endTime: '12:00',
  };
  assert.strictEqual(await isBookingOverdue(futureBooking as any), false);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const sameDayEnd =
    nowMinutes > 0
      ? new Date(now.getTime() - 60 * 1000)
      : new Date(now.getTime() + 60 * 1000);
  const nowStr = toLocalDateString(now);
  const currentBooking = {
    date: nowStr,
    timeSlot: 0,
    startTime: '08:00',
    endTime: `${String(sameDayEnd.getHours()).padStart(2, '0')}:${String(sameDayEnd.getMinutes()).padStart(2, '0')}`,
  };
  const sameDayOverdue = await isBookingOverdue(currentBooking as any);
  if (nowMinutes > 0) {
    assert.strictEqual(sameDayOverdue, true);
  } else {
    assert.strictEqual(typeof sameDayOverdue, 'boolean');
  }
}

async function testCheckinWindow() {
  const now = new Date();
  const start = new Date(now.getTime() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const booking = {
    date: toLocalDateString(now),
    startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
  };
  const allowed = await isCheckinAllowed(booking as any);
  assert.strictEqual(typeof allowed, 'boolean');
}

function testIsBeforeToday() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayStr = toLocalDateString(yesterday);
  assert.strictEqual(isBeforeToday(yesterdayStr), true);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStr = toLocalDateString(tomorrow);
  assert.strictEqual(isBeforeToday(tomorrowStr), false);
}

async function testIsPastTimeSlot() {
  const today = new Date();
  const todayStr = toLocalDateString(today);
  const timeSlot = 0;
  const result = await isPastTimeSlot(todayStr, timeSlot);
  assert.strictEqual(typeof result, 'boolean');
}

function testConfigConstants() {
  assert.strictEqual(typeof CHECKIN_WINDOW_MINUTES, 'number');
  assert.strictEqual(typeof MIN_CUSTOM_BOOKING_DURATION_MINUTES, 'number');
  assert.ok(MIN_CUSTOM_BOOKING_DURATION_MINUTES > 0);
}
