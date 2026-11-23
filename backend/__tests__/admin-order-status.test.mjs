// Tests for the admin order-status change flow (Admin vs Store Owner split).
//
// Scope of this file:
//  - updateOrderStatusAdmin enforces the fulfilment workflow (no step skipping)
//    and persists to the DB (orders table), never touching payment_status.
//  - ORDER_STATUS_TRANSITIONS / getAllowedOrderStatusTransitions expose the rules
//    the AdminOrders dropdown renders.
//  - The store-owner path (updateStoreOrderStatus) keeps its own ownership +
//    transition rules and is NOT reachable through the admin endpoint.
//
// Runs entirely against an in-memory fake Supabase client — never a real DB.
process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key-min-32-chars';
process.env.JWT_SECRET ||= 'test-secret-key-min-32-chars-long';

import test from 'node:test';
import assert from 'node:assert/strict';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');

const { updateOrderStatusAdmin, getAllowedOrderStatusTransitions, ORDER_STATUS_TRANSITIONS } = orderService;

// ---------------------------------------------------------------------------
// In-memory fake for the `orders` table used by updateOrderStatusAdmin.
// Supports the exact builder chain the service uses:
//   .from('orders').select(cols).eq('id', id).single()
//   .from('orders').update(data).eq('id', id).select().single()
// ---------------------------------------------------------------------------
function installOrdersFake(seedRows = []) {
  const rowsMap = new Map(seedRows.map((r) => [r.id, { ...r }]));
  const originalFrom = supabaseAdmin.from;
  let updateCount = 0;

  supabaseAdmin.from = (table) => {
    if (table !== 'orders') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: `unexpected table ${table}` } }) }) }) };
    }
    let op = 'select';
    let patch = null;
    let filterId = null;
    let wantSingle = false;

    const runSelect = () => {
      const row = rowsMap.get(filterId) || null;
      return { data: row ? { ...row } : null, error: row ? null : { message: 'no rows', code: 'PGRST116' }, count: row ? 1 : 0 };
    };
    const runUpdate = () => {
      const row = rowsMap.get(filterId);
      if (!row) return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      updateCount += 1;
      Object.assign(row, patch);
      return { data: { ...row }, error: null, count: 1 };
    };

    const builder = {
      select: () => builder,
      update: (data) => { op = 'update'; patch = data; return builder; },
      eq: (col, val) => { if (col === 'id') filterId = val; return builder; },
      single: async () => {
        wantSingle = true;
        return op === 'update' ? runUpdate() : runSelect();
      },
      then: (resolve) => Promise.resolve().then(() => (op === 'update' ? runUpdate() : runSelect())).then(resolve),
    };
    return builder;
  };

  return {
    get: (id) => rowsMap.get(id),
    updates: () => updateCount,
    restore: () => { supabaseAdmin.from = originalFrom; },
  };
}

// ===========================================================================
// Transition rules exposed to the UI
// ===========================================================================
test('getAllowedOrderStatusTransitions: pending -> confirmed/cancelled only', () => {
  assert.deepEqual(getAllowedOrderStatusTransitions('pending').sort(), ['cancelled', 'confirmed']);
});

test('getAllowedOrderStatusTransitions: unknown/terminal status has no next states', () => {
  assert.deepEqual(getAllowedOrderStatusTransitions('refunded'), []);
  assert.deepEqual(getAllowedOrderStatusTransitions('bogus'), []);
});

test('ORDER_STATUS_TRANSITIONS never allows skipping straight to delivered/refunded from pending', () => {
  const fromPending = ORDER_STATUS_TRANSITIONS.pending;
  assert.ok(!fromPending.includes('delivered'));
  assert.ok(!fromPending.includes('refunded'));
  assert.ok(!fromPending.includes('picked_up'));
});

// ===========================================================================
// updateOrderStatusAdmin — persistence + workflow enforcement
// ===========================================================================
test('updateOrderStatusAdmin: pending -> confirmed persists and returns updated row', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'pending', payment_status: 'awaiting_review' }]);
  try {
    const updated = await updateOrderStatusAdmin('o1', 'confirmed', 'ok');
    assert.equal(updated.status, 'confirmed');
    assert.equal(updated.payment_status, 'awaiting_review', 'payment_status must NOT change on order status update');
    assert.equal(fake.get('o1').status, 'confirmed');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: illegal jump (pending -> delivered) is rejected and nothing is written', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'pending' }]);
  try {
    await assert.rejects(
      () => updateOrderStatusAdmin('o1', 'delivered'),
      /Invalid status transition from pending to delivered/
    );
    assert.equal(fake.get('o1').status, 'pending', 'row must be unchanged after a rejected transition');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: step-by-step path (preparing -> ready_for_pickup) works', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'preparing' }]);
  try {
    const updated = await updateOrderStatusAdmin('o1', 'ready_for_pickup');
    assert.equal(updated.status, 'ready_for_pickup');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: cancelling a pending order sets status cancelled (payment untouched)', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'pending', payment_status: 'pending' }]);
  try {
    const updated = await updateOrderStatusAdmin('o1', 'cancelled', 'customer request');
    assert.equal(updated.status, 'cancelled');
    assert.equal(updated.payment_status, 'pending');
    assert.ok(updated.cancelled_at, 'cancelled_at should be stamped');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: unknown order -> NotFoundError', async () => {
  const fake = installOrdersFake([]);
  try {
    await assert.rejects(
      () => updateOrderStatusAdmin('missing', 'confirmed'),
      /Order not found/
    );
  } finally {
    fake.restore();
  }
});

// ===========================================================================
// updateOrderStatusAdmin — same-status idempotency (regression)
// ===========================================================================
// A stale client (e.g. an old order card in chat) may re-send the status the
// order already has. This must be a silent no-op: no error, no DB write, so no
// duplicate status history / notification / chat card is produced.
test('updateOrderStatusAdmin: same-status request (confirmed -> confirmed) is an idempotent no-op', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'confirmed', payment_status: 'pending' }]);
  try {
    const result = await updateOrderStatusAdmin('o1', 'confirmed', '');
    assert.equal(result.status, 'confirmed', 'returns the existing order unchanged');
    assert.equal(fake.updates(), 0, 'must NOT write to the DB for a same-status request');
    assert.equal(fake.get('o1').status, 'confirmed');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: same-status no-op does not touch payment_status', async () => {
  const fake = installOrdersFake([{ id: 'o1', status: 'in_transit', payment_status: 'pending', payment_method: 'cod' }]);
  try {
    const result = await updateOrderStatusAdmin('o1', 'in_transit');
    assert.equal(result.status, 'in_transit');
    assert.equal(result.payment_status, 'pending');
    assert.equal(fake.updates(), 0, 'no DB write at all');
  } finally {
    fake.restore();
  }
});

test('updateOrderStatusAdmin: an illegal transition is still rejected after the same-status guard', async () => {
  // confirmed cannot jump straight to delivered (must go through preparing, etc.)
  const fake = installOrdersFake([{ id: 'o1', status: 'confirmed' }]);
  try {
    await assert.rejects(
      () => updateOrderStatusAdmin('o1', 'delivered'),
      /Invalid status transition from confirmed to delivered/
    );
    assert.equal(fake.updates(), 0, 'a rejected transition must not write');
    assert.equal(fake.get('o1').status, 'confirmed', 'row unchanged after rejection');
  } finally {
    fake.restore();
  }
});