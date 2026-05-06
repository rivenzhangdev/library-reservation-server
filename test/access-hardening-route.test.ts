import assert from 'node:assert';

const configModule: any = require('../src/routes/config');
const authModule: any = require('../src/middleware/auth');
const { Roles } = require('../src/constants/roles');

export async function runTests() {
  await testConfigWriteRoutesUseAuthThenAdmin();
  await testAdminMiddlewareRejectsNonAdmin();
  await testAdminMiddlewareAllowsAdmin();
}

function getRouteLayer(path: string, method: 'POST' | 'PUT' | 'DELETE') {
  return configModule.default.stack.find(
    (item: any) => item.path === path && item.methods.includes(method)
  );
}

async function testConfigWriteRoutesUseAuthThenAdmin() {
  const writeRoutes: Array<{ path: string; method: 'POST' | 'PUT' | 'DELETE' }> = [
    { path: '/api/config/credit-rules', method: 'PUT' },
    { path: '/api/config/time-slots', method: 'POST' },
    { path: '/api/config/time-slots/:id', method: 'PUT' },
    { path: '/api/config/time-slots/:id', method: 'DELETE' },
    { path: '/api/config/seat-types', method: 'POST' },
    { path: '/api/config/seat-types/:id', method: 'PUT' },
    { path: '/api/config/seat-types/:id', method: 'DELETE' },
    { path: '/api/config/seat-facilities', method: 'POST' },
    { path: '/api/config/seat-facilities/:id', method: 'PUT' },
    { path: '/api/config/seat-facilities/:id', method: 'DELETE' },
  ];

  for (const route of writeRoutes) {
    const layer = getRouteLayer(route.path, route.method);
    assert.ok(layer, `${route.method} ${route.path} route not found`);
    assert.strictEqual(
      layer.stack[0],
      authModule.authMiddleware,
      `${route.method} ${route.path} first middleware should be authMiddleware`
    );
    assert.strictEqual(
      layer.stack[1],
      authModule.adminMiddleware,
      `${route.method} ${route.path} second middleware should be adminMiddleware`
    );
  }
}

async function testAdminMiddlewareRejectsNonAdmin() {
  const ctx: any = {
    state: { user: { id: 'u-1', role: Roles.USER } },
  };
  let calledNext = false;

  await authModule.adminMiddleware(ctx, async () => {
    calledNext = true;
  });

  assert.strictEqual(calledNext, false);
  assert.strictEqual(ctx.status, 403);
  assert.strictEqual(ctx.body.success, false);
  assert.strictEqual(String(ctx.body.error.code), '1003');
}

async function testAdminMiddlewareAllowsAdmin() {
  const ctx: any = {
    state: { user: { id: 'a-1', role: Roles.ADMIN } },
  };
  let calledNext = false;

  await authModule.adminMiddleware(ctx, async () => {
    calledNext = true;
  });

  assert.strictEqual(calledNext, true);
  assert.strictEqual(ctx.status, undefined);
  assert.strictEqual(ctx.body, undefined);
}
