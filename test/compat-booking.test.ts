import assert from 'node:assert';

const compatModule: any = require('../src/routes/compat');
const { Booking } = require('../src/models/mysql');
const { Roles } = require('../src/constants/roles');

export async function runTests() {
  await testAdminCheckinBookingSuccess();
  await testAdminCheckinBookingNotFound();
  await testAdminCheckoutBookingSuccess();
  await testAdminCheckoutBookingNotFound();
  await testAdminDeleteBookingSuccess();
  await testAdminDeleteBookingNotFound();
  await testAdminDeleteBookingForbidden();
}

async function testAdminCheckinBookingSuccess() {
  const originalMarkExpired = compatModule.compatRouteDependencies.markAllExpiredBookings;
  const originalFindOne = Booking.findOne;
  const originalPerform = compatModule.compatRouteDependencies.performBookingCheckin;

  Booking.findOne = async () => ({ id: 'b1', userId: 'user1' });
  compatModule.compatRouteDependencies.markAllExpiredBookings = async () => {};
  compatModule.compatRouteDependencies.performBookingCheckin = async (booking: any, userId: string) => {
    assert.strictEqual(booking.id, 'b1');
    assert.strictEqual(userId, 'admin1');
  };

  try {
    const ctx: any = {
      params: { id: 'b1' },
      state: { user: { id: 'admin1', role: Roles.ADMIN } },
    };
    await compatModule.adminCheckinBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
  } finally {
    compatModule.compatRouteDependencies.markAllExpiredBookings = originalMarkExpired;
    Booking.findOne = originalFindOne;
    compatModule.compatRouteDependencies.performBookingCheckin = originalPerform;
  }
}

async function testAdminCheckinBookingNotFound() {
  const originalMarkExpired = compatModule.compatRouteDependencies.markAllExpiredBookings;
  const originalFindOne = Booking.findOne;

  Booking.findOne = async () => null;
  compatModule.compatRouteDependencies.markAllExpiredBookings = async () => {};

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'admin1', role: Roles.ADMIN } },
    };
    await assert.rejects(
      async () => {
        await compatModule.adminCheckinBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    compatModule.compatRouteDependencies.markAllExpiredBookings = originalMarkExpired;
    Booking.findOne = originalFindOne;
  }
}

async function testAdminCheckoutBookingSuccess() {
  const originalMarkExpired = compatModule.compatRouteDependencies.markAllExpiredBookings;
  const originalFindOne = Booking.findOne;
  const originalPerform = compatModule.compatRouteDependencies.performBookingCheckout;

  Booking.findOne = async () => ({ id: 'b2', userId: 'user2' });
  compatModule.compatRouteDependencies.markAllExpiredBookings = async () => {};
  compatModule.compatRouteDependencies.performBookingCheckout = async (booking: any, userId: string) => {
    assert.strictEqual(booking.id, 'b2');
    assert.strictEqual(userId, 'admin2');
  };

  try {
    const ctx: any = {
      params: { id: 'b2' },
      state: { user: { id: 'admin2', role: Roles.ADMIN } },
    };
    await compatModule.adminCheckoutBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
  } finally {
    compatModule.compatRouteDependencies.markAllExpiredBookings = originalMarkExpired;
    Booking.findOne = originalFindOne;
    compatModule.compatRouteDependencies.performBookingCheckout = originalPerform;
  }
}

async function testAdminCheckoutBookingNotFound() {
  const originalMarkExpired = compatModule.compatRouteDependencies.markAllExpiredBookings;
  const originalFindOne = Booking.findOne;

  Booking.findOne = async () => null;
  compatModule.compatRouteDependencies.markAllExpiredBookings = async () => {};

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'admin2', role: Roles.ADMIN } },
    };
    await assert.rejects(
      async () => {
        await compatModule.adminCheckoutBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    compatModule.compatRouteDependencies.markAllExpiredBookings = originalMarkExpired;
    Booking.findOne = originalFindOne;
  }
}

async function testAdminDeleteBookingSuccess() {
  const originalFindByPk = Booking.findByPk;
  const originalRelease = compatModule.compatRouteDependencies.releaseBookingTimeSlot;

  const booking = {
    id: 'b3',
    seatId: 1,
    date: '2026-04-20',
    timeSlot: 0,
    destroy: async () => {},
  };

  Booking.findByPk = async () => booking;
  compatModule.compatRouteDependencies.releaseBookingTimeSlot = async (foundBooking: any) => {
    assert.strictEqual(foundBooking, booking);
  };

  try {
    const ctx: any = {
      params: { id: 'b3' },
      state: { user: { id: 'admin3', role: Roles.ADMIN } },
    };
    await compatModule.adminDeleteBooking(ctx);
    assert.strictEqual(ctx.body.success, true);
  } finally {
    Booking.findByPk = originalFindByPk;
    compatModule.compatRouteDependencies.releaseBookingTimeSlot = originalRelease;
  }
}

async function testAdminDeleteBookingNotFound() {
  const originalFindByPk = Booking.findByPk;

  Booking.findByPk = async () => null;

  try {
    const ctx: any = {
      params: { id: 'missing' },
      state: { user: { id: 'admin3', role: Roles.ADMIN } },
    };
    await assert.rejects(
      async () => {
        await compatModule.adminDeleteBooking(ctx);
      },
      {
        message: 'Booking not found',
      }
    );
  } finally {
    Booking.findByPk = originalFindByPk;
  }
}

async function testAdminDeleteBookingForbidden() {
  const ctx: any = {
    params: { id: 'b4' },
    state: { user: { id: 'user4', role: 'USER' } },
  };

  await assert.rejects(
    async () => {
      await compatModule.adminDeleteBooking(ctx);
    },
    {
      message: 'Forbidden',
    }
  );
}
