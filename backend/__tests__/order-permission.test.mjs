// Permission tests for order listing (Admin vs Store Owner) and cross-store protection.
// Runs entirely against an in-memory fake Supabase client — never touches a real DB.
process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key-min-32-chars';
process.env.JWT_SECRET ||= 'test-secret-key-min-32-chars-long';

import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports ตั้งแต่ env ถูกตั้งค่าแล้ว (บาง module อ่าน env ตอนโหลด module)
const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');
const auth = await import('../middleware/auth.js');

const { getStoreOrders } = orderService;
const { verifyAdmin, authorize } = auth;

// ---------------------------------------------------------------------------
// In-memory fake for `stores` + `store_orders` used by getStoreOrders.
// ---------------------------------------------------------------------------
function installStoreFake({ stores = [], storeOrders = [] } = {}) {
  const storesMap = new Map(stores.map((s) => [s.id, s]));
  const ordersMap = new Map(storeOrders.map((o) => [o.id, o]));
  const originalFrom = supabaseAdmin.from;

  const run = (table, state) => {
    if (table === 'stores') {
      let rows = [...storesMap.values()].filter((r) =>
        Object.entries(state.filters).every(([k, v]) => String(r[k] ?? null) === String(v ?? null))
      );
      if (state.single) {
        return {
          data: rows[0] ?? null,
          error: rows.length ? null : { message: 'no rows', code: 'PGRST116' },
          count: rows.length,
        };
      }
      return { data: rows, error: null, count: rows.length };
    }
    if (table === 'store_orders') {
      let rows = [...ordersMap.values()].filter((r) =>
        Object.entries(state.filters).every(([k, v]) => String(r[k] ?? null) === String(v ?? null))
      );
      return { data: rows, error: null, count: rows.length };
    }
    return { data: null, error: { message: `unexpected table: ${table}` } };
  };

  supabaseAdmin.from = (table) => {
    const state = { filters: {}, single: false };
    const builder = {
      select: () => builder,
      eq: (c, v) => { state.filters[c] = v; return builder; },
      order: () => builder,
      range: () => builder,
      single: async () => { state.single = true; return run(table, state); },
      then: (resolve) => Promise.resolve().then(() => run(table, state)).then(resolve),
    };
    return builder;
  };

  return {
    restore: () => { supabaseAdmin.from = originalFrom; },
  };
}

// ---------------------------------------------------------------------------
// Middleware runner: captures res.status/res.json or detects next() call.
// ---------------------------------------------------------------------------
async function runMiddleware(mw, user) {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status: (code) => { statusCode = code; return res; },
    json: (b) => { body = b; },
  };
  const result = mw({ user }, res, () => { nextCalled = true; });
  if (result && typeof result.then === 'function') await result;
  return { statusCode, body, nextCalled };
}

// ===========================================================================
// getStoreOrders — service-level ownership enforcement
// ===========================================================================
test('getStoreOrders: store owner sees orders of their own store', async () => {
  const { restore } = installStoreFake({
    stores: [{ id: 'store-1', owner_id: 'owner-1', name: 'ร้าน A' }],
    storeOrders: [
      { id: 'so-1', store_id: 'store-1', parent_order_id: 'o1', status: 'pending', total_amount: 100, created_at: new Date().toISOString() },
      { id: 'so-2', store_id: 'store-1', parent_order_id: 'o2', status: 'awaiting_review', total_amount: 200, created_at: new Date().toISOString() },
    ],
  });
  try {
    const result = await getStoreOrders('store-1', 'owner-1', {}, { page: 1, limit: 50 });
    assert.ok(Array.isArray(result.storeOrders));
    assert.equal(result.storeOrders.length, 2);
    assert.equal(result.storeOrders[0].id, 'so-1');
    assert.equal(result.storeOrders[1].status, 'awaiting_review');
  } finally {
    restore();
  }
});

test('getStoreOrders: store owner cannot read another store\u2019s orders (cross-store protection)', async () => {
  const { restore } = installStoreFake({
    stores: [{ id: 'store-1', owner_id: 'owner-1' }],
    storeOrders: [{ id: 'so-1', store_id: 'store-1', status: 'pending' }],
  });
  try {
    await assert.rejects(
      () => getStoreOrders('store-1', 'owner-2', {}, {}),
      /Store not found or not authorized/
    );
  } finally {
    restore();
  }
});

test('getStoreOrders: non-existent store is rejected', async () => {
  const { restore } = installStoreFake({ stores: [], storeOrders: [] });
  try {
    await assert.rejects(
      () => getStoreOrders('store-999', 'owner-1', {}, {}),
      /Store not found or not authorized/
    );
  } finally {
    restore();
  }
});

test('getStoreOrders: admin/owner role may read any store they own', async () => {
  const { restore } = installStoreFake({
    stores: [{ id: 'store-1', owner_id: 'admin-1' }],
    storeOrders: [{ id: 'so-1', store_id: 'store-1', status: 'confirmed' }],
  });
  try {
    const result = await getStoreOrders('store-1', 'admin-1', {}, {});
    assert.equal(result.storeOrders.length, 1);
  } finally {
    restore();
  }
});

// ===========================================================================
// verifyAdmin — /api/orders/admin/all must stay admin-only (requirement 6)
// ===========================================================================
test('verifyAdmin: allows admin and owner roles', async () => {
  for (const role of ['admin', 'owner']) {
    const { statusCode, nextCalled } = await runMiddleware(verifyAdmin, { role });
    assert.equal(statusCode, null, `role ${role} should be allowed`);
    assert.equal(nextCalled, true, `role ${role} should call next()`);
  }
});

test('verifyAdmin: rejects seller/customer with "สำหรับผู้ดูแลระบบเท่านั้น"', async () => {
  for (const role of ['seller', 'customer']) {
    const { statusCode, body, nextCalled } = await runMiddleware(verifyAdmin, { role });
    assert.equal(statusCode, 403, `role ${role} should get 403`);
    assert.equal(nextCalled, false, `role ${role} should not call next()`);
    assert.ok(body && typeof body.message === 'string');
    assert.ok(String(body.message).includes('สำหรับผู้ดูแลระบบเท่านั้น'));
  }
});

// ===========================================================================
// authorize('seller','admin','owner') — store owner order endpoint
// ===========================================================================
const mw = authorize('seller', 'admin', 'owner');

test('authorize(seller, admin, owner): allows seller/admin/owner', async () => {
  for (const role of ['seller', 'admin', 'owner']) {
    const { statusCode, nextCalled } = await runMiddleware(mw, { role });
    assert.equal(statusCode, null, `role ${role} should be allowed`);
    assert.equal(nextCalled, true, `role ${role} should call next()`);
  }
});

test('authorize(seller, admin, owner): rejects customer (403)', async () => {
  const { statusCode, body, nextCalled } = await runMiddleware(mw, { role: 'customer' });
  assert.equal(statusCode, 403, 'customer should get 403 on store order endpoint');
  assert.equal(nextCalled, false, 'customer should not call next()');
  assert.ok(body && typeof body.message === 'string');
});
