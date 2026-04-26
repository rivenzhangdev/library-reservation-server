import assert from 'node:assert';

const bookingModule: any = require('../src/routes/booking');
const { Booking } = require('../src/models/mysql');
const { BookingStatus } = require('../src/models/mysql/types');

function toLocalDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function runTests() {
  await testCheckinBookingSuccess();
  await testCheckinBookingNotFound();
  await testCheckoutBookingSuccess();
  await testCheckoutBookingNotFound();
  await testRenewBookingMissingTimeSlot();
  await testRenewBookingNotFound();
  await testRenewBookingSuccess();
  await testCreateBookingMissingParams();
  await testCreateBookingSuccess();
  await testCancelBookingSuccess();
  await testCancelBookingRejectedAfterStart();
  await testCancelBookingNotFound();
}

async function testCheckinBookingSuccess() {
  const now = new Date();
  const start = new Date(now.getTime() + 5 * 60 * 1000);
  const end = new Date(now.getTime() + 35 * 60 * 1000);
  const booking = {
    id: 'b1',
    userId: 'user1',
    status: BookingStatus.UPCOMING,
    date: now.toISOString().split('T')[0],
    startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  const originalFindOne = Booking.findOne;
  const originalFindAll = Booking.findAll;
  const originalPerform = bookingModule.bookingRouteDependencies.performBookingCheckin;

  Booking.findOne = async () => booking;
  Booking.findAll = async () => [];
  bookingModule.bookingRouteDependencies.performBookingCheckin = async (foundBooking: any, userId: string) => {
    assert.strictEqual(foundBooking, booking);
    assert.strictEqual(userId, 'user1');
    await booking.update({ status: BookingStatus.ONGOING });
  };

  try {
    const ctx: any = {
      params: { id: 'b1' },
      state: { user: { id: 'user1' } },
    };
    await bookingModule.checkinBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(booking.status, BookingStatus.ONGOING);
  } finally {
    bookingModule.bookingRouteDependencies.performBookingCheckin = originalPerform;
    Booking.findOne = originalFindOne;
    Booking.findAll = originalFindAll;
  }
}

async function testCheckinBookingNotFound() {
  const originalFindOne = Booking.findOne;
  const originalFindAll = Booking.findAll;

  Booking.findOne = async () => null;
  Booking.findAll = async () => [];

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'user1' } },
    };
    await assert.rejects(
      async () => {
        await bookingModule.checkinBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    Booking.findOne = originalFindOne;
    Booking.findAll = originalFindAll;
  }
}

async function testCheckoutBookingSuccess() {
  const booking = {
    id: 'b2',
    userId: 'user2',
    status: BookingStatus.ONGOING,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  const originalFindOne = Booking.findOne;
  const originalPerform = bookingModule.bookingRouteDependencies.performBookingCheckout;

  Booking.findOne = async () => booking;
  bookingModule.bookingRouteDependencies.performBookingCheckout = async (
    foundBooking: any,
    userId: string
  ) => {
    assert.strictEqual(foundBooking, booking);
    assert.strictEqual(userId, 'user2');
  };

  try {
    const ctx: any = {
      params: { id: 'b2' },
      state: { user: { id: 'user2' } },
    };
    await bookingModule.checkoutBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
  } finally {
    bookingModule.bookingRouteDependencies.performBookingCheckout = originalPerform;
    Booking.findOne = originalFindOne;
  }
}

async function testCheckoutBookingNotFound() {
  const originalFindOne = Booking.findOne;
  Booking.findOne = async () => null;

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'user2' } },
    };
    await assert.rejects(
      async () => {
        await bookingModule.checkoutBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    Booking.findOne = originalFindOne;
  }
}

async function testRenewBookingMissingTimeSlot() {
  const ctx: any = {
    params: { id: 'b3' },
    state: { user: { id: 'user3' } },
    request: { body: {} },
  };

  await assert.rejects(
    async () => {
      await bookingModule.renewBooking(ctx);
    },
    {
      message: 'Missing time slot parameter',
    }
  );
}

async function testRenewBookingNotFound() {
  const originalFindOne = Booking.findOne;
  Booking.findOne = async () => null;

  try {
    const ctx: any = {
      params: { id: 'b4' },
      state: { user: { id: 'user4' } },
      request: { body: { timeSlot: 1 } },
    };
    await assert.rejects(
      async () => {
        await bookingModule.renewBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    Booking.findOne = originalFindOne;
  }
}

async function testRenewBookingSuccess() {
  const booking = {
    id: 'b5',
    userId: 'user5',
    status: BookingStatus.UPCOMING,
  };

  const originalFindOne = Booking.findOne;
  const originalPerform = bookingModule.bookingRouteDependencies.performBookingRenew;

  Booking.findOne = async () => booking;
  bookingModule.bookingRouteDependencies.performBookingRenew = async (
    foundBooking: any,
    requestTimeSlot: any,
    ctx: any
  ) => {
    assert.strictEqual(foundBooking, booking);
    assert.strictEqual(requestTimeSlot, 2);
    assert.strictEqual(ctx.params.id, 'b5');
    return { id: 'new-booking' };
  };

  try {
    const ctx: any = {
      params: { id: 'b5' },
      state: { user: { id: 'user5' } },
      request: { body: { timeSlot: 2 } },
    };
    await bookingModule.renewBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.data.id, 'new-booking');
  } finally {
    Booking.findOne = originalFindOne;
    bookingModule.bookingRouteDependencies.performBookingRenew = originalPerform;
  }
}

async function testCreateBookingMissingParams() {
  const ctx: any = {
    request: { body: { seatId: 1 } },
    state: { user: { id: 'user1' } },
  };

  await assert.rejects(
    async () => {
      await bookingModule.createBooking(ctx);
    },
    {
      message: 'Missing required parameters',
    }
  );
}

async function testCreateBookingSuccess() {
  const originalSeatFind = bookingModule.bookingRouteDependencies.Seat.findByPk;
  const originalBookingFind = Booking.findOne;
  const originalBookingFindAll = Booking.findAll;
  const originalBookingCreate = Booking.create;
  const originalTimeSlotFind = bookingModule.bookingRouteDependencies.TimeSlotStatus.findOne;
  const originalTimeSlotCreate = bookingModule.bookingRouteDependencies.TimeSlotStatus.create;
  const originalNotificationCreate = bookingModule.bookingRouteDependencies.Notification.create;
  const originalMarkUserExpired = bookingModule.bookingRouteDependencies.markUserExpiredBookings;
  const originalTransaction = bookingModule.bookingRouteDependencies.sequelizeTransaction;
  const originalResolveTimeSlot = bookingModule.bookingRouteDependencies.resolveTimeSlot;
  const originalValidateTime = bookingModule.bookingRouteDependencies.validateBookingTimeRange;
  const originalCheckBookingPermissions = bookingModule.bookingRouteDependencies.checkBookingPermissions;
  const originalBuildPayload = bookingModule.bookingRouteDependencies.buildWechatTemplatePayload;
  const originalUserModel = bookingModule.bookingRouteDependencies.UserModel;
  const originalSendWechat = bookingModule.bookingRouteDependencies.sendWechatSubscribeMessage;
  const originalConfig = bookingModule.bookingRouteDependencies.wechatTemplateConfig;

  bookingModule.bookingRouteDependencies.Seat.findByPk = async () => ({ id: 1 });
  Booking.findOne = async () => null;
  Booking.findAll = async () => [];
  bookingModule.bookingRouteDependencies.TimeSlotStatus.findOne = async () => null;
  Booking.create = async (data: any) => ({ ...data, id: 101, update: async function (values: any) { Object.assign(this, values); return this; } });
  bookingModule.bookingRouteDependencies.TimeSlotStatus.create = async () => ({ });
  bookingModule.bookingRouteDependencies.Notification.create = async () => ({ });
  bookingModule.bookingRouteDependencies.markUserExpiredBookings = async () => {};
  bookingModule.bookingRouteDependencies.sequelizeTransaction = async (callback: any) =>
    callback({ LOCK: { UPDATE: 'UPDATE' } } as any);
  bookingModule.bookingRouteDependencies.resolveTimeSlot = async (value: any) => value;
  bookingModule.bookingRouteDependencies.validateBookingTimeRange = async () => ({
    isCustomTime: false,
    startTime: '08:00',
    endTime: '12:00',
  });
  bookingModule.bookingRouteDependencies.checkBookingPermissions = async () => ({
    studentId: '20260001',
    creditScore: 100,
  });
  bookingModule.bookingRouteDependencies.buildWechatTemplatePayload = async () => undefined;
  bookingModule.bookingRouteDependencies.UserModel = {
    findById: async () => ({
      select: () => ({
        lean: async () => null,
      }),
    }),
  };
  bookingModule.bookingRouteDependencies.sendWechatSubscribeMessage = async () => {};
  bookingModule.bookingRouteDependencies.wechatTemplateConfig = {
    BOOKING_SUCCESS: { templateId: 'TEMPLATE_ID_' },
  };

  try {
    const ctx: any = {
      request: { body: { seatId: 1, date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], timeSlot: 0 } },
      state: { user: { id: 'user1' } },
    };
    await bookingModule.createBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.data.id, 101);
  } finally {
    bookingModule.bookingRouteDependencies.Seat.findByPk = originalSeatFind;
    Booking.findOne = originalBookingFind;
    Booking.findAll = originalBookingFindAll;
    Booking.create = originalBookingCreate;
    bookingModule.bookingRouteDependencies.TimeSlotStatus.findOne = originalTimeSlotFind;
    bookingModule.bookingRouteDependencies.TimeSlotStatus.create = originalTimeSlotCreate;
    bookingModule.bookingRouteDependencies.Notification.create = originalNotificationCreate;
    bookingModule.bookingRouteDependencies.markUserExpiredBookings = originalMarkUserExpired;
    bookingModule.bookingRouteDependencies.sequelizeTransaction = originalTransaction;
    bookingModule.bookingRouteDependencies.resolveTimeSlot = originalResolveTimeSlot;
    bookingModule.bookingRouteDependencies.validateBookingTimeRange = originalValidateTime;
    bookingModule.bookingRouteDependencies.checkBookingPermissions = originalCheckBookingPermissions;
    bookingModule.bookingRouteDependencies.buildWechatTemplatePayload = originalBuildPayload;
    bookingModule.bookingRouteDependencies.UserModel = originalUserModel;
    bookingModule.bookingRouteDependencies.sendWechatSubscribeMessage = originalSendWechat;
    bookingModule.bookingRouteDependencies.wechatTemplateConfig = originalConfig;
  }
}

async function testCancelBookingSuccess() {
  const originalFindOne = Booking.findOne;
  const originalRelease = bookingModule.bookingRouteDependencies.releaseBookingTimeSlot;
  const originalExpire = bookingModule.bookingRouteDependencies.expireBookingIfNeeded;

  const booking = {
    id: 'b6',
    userId: 'user6',
    status: BookingStatus.UPCOMING,
    seatId: 1,
    date: '2026-04-20',
    timeSlot: 0,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  Booking.findOne = async () => booking;
  bookingModule.bookingRouteDependencies.expireBookingIfNeeded = async () => false;
  bookingModule.bookingRouteDependencies.releaseBookingTimeSlot = async (foundBooking: any) => {
    assert.strictEqual(foundBooking, booking);
  };

  try {
    const ctx: any = {
      params: { id: 'b6' },
      state: { user: { id: 'user6' } },
    };
    await bookingModule.cancelBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(booking.status, BookingStatus.CANCELED);
  } finally {
    Booking.findOne = originalFindOne;
    bookingModule.bookingRouteDependencies.releaseBookingTimeSlot = originalRelease;
    bookingModule.bookingRouteDependencies.expireBookingIfNeeded = originalExpire;
  }
}

async function testCancelBookingRejectedAfterStart() {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 5 * 60 * 1000);
  const booking = {
    id: 'b6-started',
    userId: 'user6',
    status: BookingStatus.UPCOMING,
    seatId: 1,
    date: toLocalDateOnly(now),
    timeSlot: 0,
    startTime: `${String(startedAt.getHours()).padStart(2, '0')}:${String(startedAt.getMinutes()).padStart(2, '0')}`,
    update: async function (values: any) {
      Object.assign(this, values);
      return this;
    },
  };

  const originalFindOne = Booking.findOne;
  const originalRelease = bookingModule.bookingRouteDependencies.releaseBookingTimeSlot;
  const originalExpire = bookingModule.bookingRouteDependencies.expireBookingIfNeeded;
  let released = false;

  Booking.findOne = async () => booking;
  bookingModule.bookingRouteDependencies.expireBookingIfNeeded = async () => false;
  bookingModule.bookingRouteDependencies.releaseBookingTimeSlot = async () => {
    released = true;
  };

  try {
    const ctx: any = {
      params: { id: 'b6-started' },
      state: { user: { id: 'user6' } },
    };
    await assert.rejects(
      async () => {
        await bookingModule.cancelBooking(ctx);
      },
      {
        message: 'Cancellation is not allowed after booking start time',
      }
    );
    assert.strictEqual(released, false);
    assert.strictEqual(booking.status, BookingStatus.UPCOMING);
  } finally {
    Booking.findOne = originalFindOne;
    bookingModule.bookingRouteDependencies.releaseBookingTimeSlot = originalRelease;
    bookingModule.bookingRouteDependencies.expireBookingIfNeeded = originalExpire;
  }
}

async function testCancelBookingNotFound() {
  const originalFindOne = Booking.findOne;
  Booking.findOne = async () => null;

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'user6' } },
    };
    await assert.rejects(
      async () => {
        await bookingModule.cancelBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    Booking.findOne = originalFindOne;
  }
}
