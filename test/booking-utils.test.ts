import assert from 'node:assert';
import { releaseBookingTimeSlot, buildRenewBookingData, expireBookingIfNeeded, markAllExpiredBookings, performBookingCheckin, performBookingCheckout, performBookingRenew } from '../src/routes/booking';
import { TimeSlotStatus, Booking } from '../src/models/mysql';
import { TimeSlotStatusValue, BookingStatus } from '../src/models/mysql/types';

type UpdateCall = {
  values: any;
  options: any;
};

export async function runTests() {
  await testReleaseBookingTimeSlot();
  await testReleaseBookingTimeSlotWithTransaction();
  await testExpireBookingIfNeededPastDate();
  await testMarkAllExpiredBookings();
  await testPerformBookingCheckin();
  await testPerformBookingCheckout();
  await testPerformBookingCheckoutOverdue();
  await testPerformBookingRenew();
  await testPerformBookingRenewConflict();
  await testBuildRenewBookingDataForAfternoon();
}

async function testReleaseBookingTimeSlot() {
  const calls: UpdateCall[] = [];
  const originalUpdate = (TimeSlotStatus as any).update;
  (TimeSlotStatus as any).update = async (values: any, options: any) => {
    calls.push({ values, options });
    return [1];
  };

  try {
    await releaseBookingTimeSlot({ seatId: 123, date: '2026-04-15', timeSlot: 0 });
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].values, {
      status: TimeSlotStatusValue.AVAILABLE,
      bookingId: undefined,
    });
    assert.deepStrictEqual(calls[0].options.where, {
      seatId: 123,
      date: '2026-04-15',
      timeSlot: 0,
    });
    assert.strictEqual(calls[0].options.transaction, undefined);
  } finally {
    (TimeSlotStatus as any).update = originalUpdate;
  }
}

async function testReleaseBookingTimeSlotWithTransaction() {
  const calls: UpdateCall[] = [];
  const originalUpdate = (TimeSlotStatus as any).update;
  (TimeSlotStatus as any).update = async (values: any, options: any) => {
    calls.push({ values, options });
    return [1];
  };

  const fakeTransaction = { id: 'tx' } as any;
  try {
    await releaseBookingTimeSlot({ seatId: 456, date: '2026-04-16', timeSlot: 1 }, fakeTransaction);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.transaction, fakeTransaction);
  } finally {
    (TimeSlotStatus as any).update = originalUpdate;
  }
}

async function testExpireBookingIfNeededPastDate() {
  let updatedBooking: any = null;
  let releaseCallCount = 0;
  const booking = {
    id: 1,
    seatId: 123,
    status: BookingStatus.UPCOMING,
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    timeSlot: 0,
    update: async function (values: any) {
      updatedBooking = values;
      Object.assign(this, values);
      return this;
    },
  };

  const originalUpdate = (TimeSlotStatus as any).update;
  (TimeSlotStatus as any).update = async () => {
    releaseCallCount += 1;
    return [1];
  };

  try {
    const result = await expireBookingIfNeeded(booking as any);
    assert.strictEqual(result, true);
    assert.strictEqual(updatedBooking?.status, BookingStatus.VIOLATED);
    assert.strictEqual(releaseCallCount, 1);
  } finally {
    (TimeSlotStatus as any).update = originalUpdate;
  }
}

async function testMarkAllExpiredBookings() {
  const originalFindAll = (Booking as any).findAll;
  const originalUpdate = (TimeSlotStatus as any).update;
  let processed = 0;

  (Booking as any).findAll = async () => [
    {
      id: 2,
      seatId: 123,
      status: BookingStatus.UPCOMING,
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      timeSlot: 0,
      update: async function (values: any) {
        processed += 1;
        Object.assign(this, values);
        return this;
      },
    },
  ];

  (TimeSlotStatus as any).update = async () => {
    return [1];
  };

  try {
    await markAllExpiredBookings();
    assert.strictEqual(processed, 1);
  } finally {
    (Booking as any).findAll = originalFindAll;
    (TimeSlotStatus as any).update = originalUpdate;
  }
}

async function testPerformBookingCheckin() {
  const now = new Date();
  const booking = {
    id: 3,
    userId: 'user123',
    status: BookingStatus.UPCOMING,
    date: now.toISOString().split('T')[0],
    timeSlot: 0,
    startTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(now.getHours() + 1).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  let createdCreditRecord: any = null;
  const fakeCreditRecordModel = {
    create: async (data: any) => {
      createdCreditRecord = data;
      return data;
    },
  };

  await performBookingCheckin(booking as any, 'operator123', fakeCreditRecordModel as any);
  assert.strictEqual(booking.status, BookingStatus.ONGOING);
  assert.strictEqual(createdCreditRecord?.userId, 'user123');
}

async function testPerformBookingCheckout() {
  const now = new Date();
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  const booking = {
    id: 4,
    userId: 'user456',
    status: BookingStatus.ONGOING,
    date: now.toISOString().split('T')[0],
    timeSlot: 0,
    startTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  let releaseCount = 0;
  const fakeRelease = async () => {
    releaseCount += 1;
  };
  const fakeExpire = async () => false;

  await performBookingCheckout(booking as any, 'operator456', fakeRelease as any, fakeExpire as any);
  assert.strictEqual(booking.status, BookingStatus.COMPLETED);
  assert.strictEqual(releaseCount, 1);
}

async function testPerformBookingCheckoutOverdue() {
  const booking = {
    id: 10,
    userId: 'user999',
    status: BookingStatus.ONGOING,
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    timeSlot: 0,
    startTime: '08:00',
    endTime: '09:00',
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  let expireCalled = 0;
  const fakeRelease = async () => {
    throw new Error('release should not be called for overdue checkout');
  };
  const fakeExpire = async () => {
    expireCalled += 1;
    booking.status = BookingStatus.VIOLATED;
    return true;
  };

  await assert.rejects(
    async () => {
      await performBookingCheckout(booking as any, 'operator999', fakeRelease as any, fakeExpire as any);
    },
    {
      message: 'Booking has expired and is marked as violated; check-out is not allowed',
    }
  );
  assert.strictEqual(expireCalled, 1);
  assert.strictEqual(booking.status, BookingStatus.VIOLATED);
}

async function testPerformBookingRenew() {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const booking = {
    id: 5,
    userId: 'user789',
    seatId: 200,
    status: BookingStatus.UPCOMING,
    date: futureDate,
    timeSlot: 0,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  let releaseCalled = 0;
  let upsertCalled = 0;
  const fakeBookingModel = {
    create: async (data: any, _options: any) => ({ ...data, id: 999 }),
  };
  const fakeTimeSlotStatusModel = {
    findOne: async () => null,
    upsert: async () => { upsertCalled += 1; },
  };
  const fakeTransactionProvider = async (callback: any) => callback({} as any);
  const fakeRelease = async () => { releaseCalled += 1; };

  const newBooking = await performBookingRenew(
    booking as any,
    1,
    {} as any,
    {
      resolveTimeSlot: async () => 1,
      validateBookingTimeRange: async () => ({
        isCustomTime: false,
        startTime: '13:00',
        endTime: '17:00',
      }),
      bookingModel: fakeBookingModel as any,
      timeSlotStatusModel: fakeTimeSlotStatusModel as any,
      transactionProvider: fakeTransactionProvider,
      releaseFn: fakeRelease,
      buildAuditFieldsFn: () => ({}),
      buildUpdatedByFn: () => ({}),
    }
  );

  assert.strictEqual(booking.status, BookingStatus.CANCELED);
  assert.strictEqual(releaseCalled, 1);
  assert.strictEqual(upsertCalled, 1);
  assert.strictEqual(newBooking.id, 999);
}

async function testPerformBookingRenewConflict() {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const booking = {
    id: 6,
    userId: 'user999',
    seatId: 201,
    status: BookingStatus.UPCOMING,
    date: futureDate,
    timeSlot: 0,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  const fakeBookingModel = {
    create: async (data: any, _options: any) => ({ ...data, id: 1000 }),
  };
  const fakeTimeSlotStatusModel = {
    findOne: async () => ({ status: TimeSlotStatusValue.BOOKED }),
    upsert: async () => { throw new Error('upsert should not be called'); },
  };
  const fakeTransactionProvider = async (callback: any) => callback({} as any);

  await assert.rejects(
    async () => {
      await performBookingRenew(
        booking as any,
        1,
        {} as any,
        {
          resolveTimeSlot: async () => 1,
          validateBookingTimeRange: async () => ({
            isCustomTime: false,
            startTime: '13:00',
            endTime: '17:00',
          }),
          bookingModel: fakeBookingModel as any,
          timeSlotStatusModel: fakeTimeSlotStatusModel as any,
          transactionProvider: fakeTransactionProvider,
          releaseFn: async () => {},
          buildAuditFieldsFn: () => ({}),
          buildUpdatedByFn: () => ({}),
        }
      );
    },
    {
      message: 'This time slot has been booked',
    }
  );
}

async function testBuildRenewBookingDataForAfternoon() {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  const renewalData = await buildRenewBookingData({ date: futureDate } as any, 1);
  assert.strictEqual(renewalData.timeSlot, 1);
  assert.strictEqual(renewalData.startTime, '13:00');
  assert.strictEqual(renewalData.endTime, '17:00');
  assert.strictEqual(renewalData.date.toISOString().split('T')[0], futureDate);
}
