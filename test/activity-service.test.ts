import assert from 'node:assert';

const activityService: any = require('../src/services/activity-service');
const { Activity } = require('../src/models/mongodb');
const { ActivityStatus } = require('../src/models/mysql/types');

export async function runTests() {
  await testRefreshActivityStatuses();
  await testJoinActivityAtomicSuccess();
  await testJoinActivityFullFallback();
  await testJoinActivityAlreadyJoinedFallback();
}

async function testRefreshActivityStatuses() {
  const originalUpdateMany = Activity.updateMany;
  const calls: Array<{ query: any; update: any }> = [];

  Activity.updateMany = async (query: any, update: any) => {
    calls.push({ query, update });
    return { modifiedCount: 1 };
  };

  try {
    const now = new Date('2026-04-21T10:00:00.000Z');
    await activityService.refreshActivityStatuses(now);

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].query.status, ActivityStatus.UPCOMING);
    assert.strictEqual(calls[0].update.$set.status, ActivityStatus.ONGOING);
    assert.deepStrictEqual(calls[1].query.status.$in, [
      ActivityStatus.UPCOMING,
      ActivityStatus.ONGOING,
    ]);
    assert.strictEqual(calls[1].update.$set.status, ActivityStatus.ENDED);
  } finally {
    Activity.updateMany = originalUpdateMany;
  }
}

async function testJoinActivityAtomicSuccess() {
  const originalUpdateMany = Activity.updateMany;
  const originalFindOneAndUpdate = Activity.findOneAndUpdate;
  const originalFindById = Activity.findById;

  let atomicCalled = false;
  Activity.updateMany = async () => ({ modifiedCount: 0 });
  Activity.findOneAndUpdate = async (_query: any, _update: any, _options: any) => {
    atomicCalled = true;
    return { _id: 'activity-1' };
  };
  Activity.findById = async () => {
    throw new Error('findById should not be called on atomic success');
  };

  try {
    await activityService.joinActivity('activity-1', 'user-1');
    assert.strictEqual(atomicCalled, true);
  } finally {
    Activity.updateMany = originalUpdateMany;
    Activity.findOneAndUpdate = originalFindOneAndUpdate;
    Activity.findById = originalFindById;
  }
}

async function testJoinActivityFullFallback() {
  const originalUpdateMany = Activity.updateMany;
  const originalFindOneAndUpdate = Activity.findOneAndUpdate;
  const originalFindById = Activity.findById;

  Activity.updateMany = async () => ({ modifiedCount: 0 });
  Activity.findOneAndUpdate = async () => null;
  Activity.findById = async () => ({
    _id: 'activity-2',
    status: ActivityStatus.UPCOMING,
    startTime: new Date(Date.now() + 60 * 60 * 1000),
    endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    maxParticipants: 1,
    participants: ['u1'],
    save: async function () { return this; },
  });

  try {
    await assert.rejects(
      async () => {
        await activityService.joinActivity('activity-2', 'u2');
      },
      {
        message: 'Activity is full',
      }
    );
  } finally {
    Activity.updateMany = originalUpdateMany;
    Activity.findOneAndUpdate = originalFindOneAndUpdate;
    Activity.findById = originalFindById;
  }
}

async function testJoinActivityAlreadyJoinedFallback() {
  const originalUpdateMany = Activity.updateMany;
  const originalFindOneAndUpdate = Activity.findOneAndUpdate;
  const originalFindById = Activity.findById;

  Activity.updateMany = async () => ({ modifiedCount: 0 });
  Activity.findOneAndUpdate = async () => null;
  Activity.findById = async () => ({
    _id: 'activity-3',
    status: ActivityStatus.UPCOMING,
    startTime: new Date(Date.now() + 60 * 60 * 1000),
    endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    maxParticipants: 3,
    participants: ['u3'],
    save: async function () { return this; },
  });

  try {
    await assert.rejects(
      async () => {
        await activityService.joinActivity('activity-3', 'u3');
      },
      {
        message: 'You have already joined this activity',
      }
    );
  } finally {
    Activity.updateMany = originalUpdateMany;
    Activity.findOneAndUpdate = originalFindOneAndUpdate;
    Activity.findById = originalFindById;
  }
}
