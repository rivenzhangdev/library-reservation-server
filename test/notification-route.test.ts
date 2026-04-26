import assert from 'node:assert';

const notificationModule: any = require('../src/routes/notification');
const { Notification } = require('../src/models/mongodb');

export async function runTests() {
  await testReadAllOnlyUpdatesCurrentUser();
}

async function testReadAllOnlyUpdatesCurrentUser() {
  const originalUpdateMany = Notification.updateMany;
  const calls: Array<{ query: any; update: any }> = [];

  Notification.updateMany = async (query: any, update: any) => {
    calls.push({ query, update });
    return { matchedCount: 3, modifiedCount: 2 };
  };

  try {
    const layer = notificationModule.default.stack.find(
      (item: any) => item.path === '/api/notification/read-all' && item.methods.includes('POST')
    );
    assert.ok(layer, 'read-all route not found');

    const handler = layer.stack[layer.stack.length - 1];
    const ctx: any = {
      state: { user: { id: 'admin-user', role: 1 } },
    };

    await handler(ctx, async () => {});

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].query, {
      userId: 'admin-user',
      isRead: false,
    });
    assert.deepStrictEqual(calls[0].update, {
      $set: { isRead: true },
    });

    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.data.matched, 3);
    assert.strictEqual(ctx.body.data.modified, 2);
  } finally {
    Notification.updateMany = originalUpdateMany;
  }
}
