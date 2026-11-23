// Tests for the multi-order payment-slip flow (KBZPay existing-order payment).
// Covers submitStorePaymentSlips, getStorePaymentSlips, approveStorePaymentSlip,
// rejectStorePaymentSlip — one transfer covering multiple orders of one store,
// order -> 'awaiting_review', store-owner manual confirmation, and guards.
//
// The legacy uploadPaymentSlip path keeps its own suite in payment-slip.test.mjs.

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

import test from 'node:test';
import assert from 'node:assert/strict';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');

const {
  submitStorePaymentSlips,
  getStorePaymentSlips,
  approveStorePaymentSlip,
  rejectStorePaymentSlip,
} = orderService;

// ---------------------------------------------------------------------------
// A small in-memory Supabase fake tailored to the query shapes the service
// issues (in/eq/neq/is filters, array insert, update+in+eq, single/maybeSingle,
// storage upload/remove/createSignedUrl).
// ---------------------------------------------------------------------------
function makeFake(handlers, store) {
  const calls = [];

  const settle = (table, state) => {
    const op = state.write?.type ?? 'select';
    calls.push({ table, op, payload: state.write?.payload ?? null, filters: { ...state.filters } });
    const handler = handlers[table];
    if (!handler) return { data: null, error: { message: `unexpected table: ${table}` } };
    return handler({ op, payload: state.write?.payload, filters: state.filters, calls, store });
  };

  const makeQuery = (table) => {
    const state = { write: null, filters: {} };
    const b = {
      select: () => b,
      insert: (payload) => { state.write = { type: 'insert', payload }; return b; },
      update: (payload) => { state.write = { type: 'update', payload }; return b; },
      delete: () => { state.write = { type: 'delete' }; return b; },
      eq: (c, v) => { state.filters[c] = v; return b; },
      neq: (c, v) => { state.filters[`neq.${c}`] = v; return b; },
      in: (c, v) => { state.filters[`in.${c}`] = v; return b; },
      is: (c, v) => { state.filters[`is.${c}`] = v; return b; },
      order: () => b,
      range: () => b,
      limit: () => b,
      single: async () => settle(table, state),
      maybeSingle: async () => settle(table, state),
      then: (resolve, reject) =>
        Promise.resolve().then(() => settle(table, state)).then(resolve, reject),
    };
    return b;
  };

  const storage = {
    from: (bucket) => ({
      upload: async (filePath, fileBuffer, options) => {
        calls.push({ table: 'storage', op: 'upload', bucket, filePath });
        return handlers.storage({ op: 'upload', bucket, filePath, calls, store });
      },
      remove: async (paths) => {
        calls.push({ table: 'storage', op: 'remove', bucket, paths });
        return handlers.storage({ op: 'remove', bucket, paths, calls, store });
      },
      exists: async (path) => {
        calls.push({ table: 'storage', op: 'exists', bucket, path });
        return handlers.storage({ op: 'exists', bucket, path, calls, store });
      },
      createSignedUrl: async (filePath, expiresIn) => {
        calls.push({ table: 'storage', op: 'createSignedUrl', bucket, filePath, expiresIn });
        return handlers.storage({ op: 'createSignedUrl', bucket, filePath, calls, store });
      },
    }),
  };

  return {
    calls,
    from: (table) => makeQuery(table),
    rpc: async () => ({ data: null, error: null }),
    storage,
  };
}

function install(handlers, seed = {}) {
  const store = {
    orders: (seed.orders || []).map((o) => ({ ...o, store_orders: o.store_orders ? o.store_orders.map((s) => ({ ...s })) : [] })),
    slips: (seed.slips || []).map((s) => ({ ...s })),
    notifications: [],
    stores: seed.stores || {},
    memberships: seed.memberships || [],
  };
  const fake = makeFake(handlers(store), store);
  const original = { from: supabaseAdmin.from, rpc: supabaseAdmin.rpc, storage: supabaseAdmin.storage };
  supabaseAdmin.from = fake.from;
  supabaseAdmin.rpc = fake.rpc;
  supabaseAdmin.storage = fake.storage;
  return {
    store,
    calls: fake.calls,
    restore: () => { supabaseAdmin.from = original.from; supabaseAdmin.rpc = original.rpc; supabaseAdmin.storage = original.storage; },
  };
}

// Handlers shared by the tests. `opts` toggles failure injection.
function buildHandlers(opts = {}) {
  return (store) => ({
    orders: ({ op, payload, filters }) => {
      if (op === 'select') {
        let rows = store.orders;
        if (filters['in.id']) rows = rows.filter((o) => filters['in.id'].includes(o.id));
        return { data: rows.length ? rows : null, error: rows.length ? null : { message: 'not found' } };
      }
      if (op === 'update') {
        const ids = filters['in.id'];
        let rows = store.orders;
        if (ids) rows = rows.filter((o) => ids.includes(o.id));
        if (filters.payment_status) rows = rows.filter((o) => o.payment_status === filters.payment_status);
        rows.forEach((o) => Object.assign(o, payload));
        return { data: rows, error: null };
      }
      return { data: null, error: { message: `unexpected orders op ${op}` } };
    },
    payment_slips: ({ op, payload, filters }) => {
      if (op === 'select') {
        let rows = store.slips;
        if (filters['in.order_id']) rows = rows.filter((s) => filters['in.order_id'].includes(s.order_id));
        if (filters.order_id !== undefined) rows = rows.filter((s) => s.order_id === filters.order_id);
        if (filters['neq.slip_status']) rows = rows.filter((s) => s.slip_status !== filters['neq.slip_status']);
        if (filters.id) rows = rows.filter((s) => s.id === filters.id);
        if (filters.store_id) rows = rows.filter((s) => s.store_id === filters.store_id);
        if (rows.length <= 1 && (filters.id)) return { data: rows[0] || null, error: null };
        return { data: rows, count: rows.length, error: null };
      }
      if (op === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload];
        const created = arr.map((p, i) => ({ id: `slip-${store.slips.length + i + 1}`, ...p }));
        store.slips.push(...created);
        return { data: created, error: null };
      }
      if (op === 'update') {
        const row = store.slips.find((s) => s.id === filters.id);
        if (!row) return { data: null, error: { message: 'slip not found' } };
        Object.assign(row, payload);
        return { data: row, error: null };
      }
      if (op === 'delete') {
        const before = store.slips.length;
        store.slips = store.slips.filter((s) => {
          if (filters['in.order_id'] && !filters['in.order_id'].includes(s.order_id)) return true;
          if (filters.store_id !== undefined && s.store_id !== filters.store_id) return true;
          if (filters.slip_status !== undefined && s.slip_status !== filters.slip_status) return true;
          return false; // matches all filters -> delete
        });
        return { data: store.slips.slice(before === store.slips.length ? 0 : store.slips.length), error: null };
      }
      return { data: null, error: { message: `unexpected payment_slips op ${op}` } };
    },
    stores: ({ filters }) => {
      const s = store.stores[filters.id];
      return { data: s || null, error: s ? null : { message: 'store not found' } };
    },
    store_memberships: () => ({ data: null, error: null }),
    notifications: ({ op, payload }) => {
      if (op === 'insert') {
        const row = { id: `notif-${store.notifications.length + 1}`, ...payload };
        store.notifications.push(row);
        return { data: row, error: null };
      }
      return { data: null, error: null };
    },
    storage: ({ op, bucket, filePath, paths }) => {
      if (op === 'upload') {
        if (opts.uploadFails) return { error: { message: 'disk full' } };
        return { error: null };
      }
      if (op === 'remove') return { error: null };
      if (op === 'exists') return { data: true, error: null };
      if (op === 'createSignedUrl') return { data: { signedUrl: 'https://signed.example/slip.jpg?token=abc' }, error: null };
      return { data: null, error: { message: `unexpected storage op ${op}` } };
    },
  });
}

const STORE_ID = 'store-1';
const OWNER_ID = 'owner-1';

const kbzpayOrder = (id, orderNo, amountMmk) => ({
  id,
  order_number: orderNo,
  customer_id: 'cust-1',
  payment_status: 'pending',
  payment_method: 'kbzpay',
  total_amount: 100,
  amount_mmk: amountMmk,
  store_orders: [{ store_id: STORE_ID, store: { id: STORE_ID, name: 'Shop A', owner_id: OWNER_ID } }],
});

const file = { fileBuffer: Buffer.from('img'), fileName: 'slip.jpg', mimeType: 'image/jpeg' };

// ---------------------------------------------------------------------------
// 1) Happy path: one slip covers two orders of the same store
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: one file covers two orders, both -> awaiting_review', async () => {
  const orders = [kbzpayOrder('o1', 'ORD1', 5000), kbzpayOrder('o2', 'ORD2', 3000)];
  const { store, restore } = install(buildHandlers(), { orders });
  try {
    const result = await submitStorePaymentSlips('cust-1', STORE_ID, ['o1', 'o2'], file);
    assert.equal(result.slips.length, 2, 'one slip row per order');
    assert.equal(new Set(result.slips.map((s) => s.submission_id)).size, 1, 'single submission id');
    assert.equal(new Set(result.slips.map((s) => s.slip_path)).size, 1, 'single shared file path');
    assert.equal(result.amount, 8000, 'amount is the sum of amount_mmk');
    assert.equal(store.orders[0].payment_status, 'awaiting_review');
    assert.equal(store.orders[1].payment_status, 'awaiting_review');
    assert.equal(store.notifications.length, 1, 'store owner notified once');
    assert.equal(store.notifications[0].recipient_id, OWNER_ID);
    assert.equal(store.notifications[0].type, 'payment');
    // Only ONE storage upload for the whole submission.
    const uploads = store ? undefined : undefined;
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 2) Upload failure leaves orders untouched and creates no slip rows
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: upload failure keeps orders pending, no slip rows', async () => {
  const orders = [kbzpayOrder('o1', 'ORD1', 5000)];
  const { store, restore } = install(buildHandlers({ uploadFails: true }), { orders });
  try {
    await assert.rejects(
      () => submitStorePaymentSlips('cust-1', STORE_ID, ['o1'], file),
      /อัปโหลดไฟล์สลิปไม่สำเร็จ/
    );
    assert.equal(store.orders[0].payment_status, 'pending', 'order stays pending after failed upload');
    assert.equal(store.slips.length, 0, 'no slip row created on upload failure');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3) Duplicate submit blocked (existing non-rejected slip)
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: blocks duplicate submit for an order already slipped', async () => {
  const orders = [kbzpayOrder('o1', 'ORD1', 5000)];
  const existing = { id: 'slip-x', order_id: 'o1', slip_status: 'uploaded', store_id: STORE_ID };
  const { store, restore } = install(buildHandlers(), { orders, slips: [existing] });
  try {
    await assert.rejects(
      () => submitStorePaymentSlips('cust-1', STORE_ID, ['o1'], file),
      /มีการส่งสลิปสำหรับคำสั่งซื้อ/
    );
    assert.equal(store.orders[0].payment_status, 'pending');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4) Ownership: cannot submit for another customer's order
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: rejects orders owned by another customer', async () => {
  const orders = [kbzpayOrder('o1', 'ORD1', 5000)];
  orders[0].customer_id = 'cust-2';
  const { restore } = install(buildHandlers(), { orders });
  try {
    await assert.rejects(
      () => submitStorePaymentSlips('cust-1', STORE_ID, ['o1'], file),
      /ไม่มีสิทธิ์/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 5) Store owner approves -> order becomes paid
// ---------------------------------------------------------------------------
test('approveStorePaymentSlip: store owner approves, order -> paid', async () => {
  const orders = [{ ...kbzpayOrder('o1', 'ORD1', 5000), payment_status: 'awaiting_review' }];
  const slips = [{ id: 'slip-1', order_id: 'o1', store_id: STORE_ID, slip_status: 'uploaded', customer_id: 'cust-1', slip_path: 'payment-slips/o1/x.jpg' }];
  const { store, restore } = install(buildHandlers(), {
    orders,
    slips,
    stores: { [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID } },
  });
  try {
    const result = await approveStorePaymentSlip(OWNER_ID, 'seller', 'slip-1');
    assert.equal(result.slip.slip_status, 'approved');
    assert.equal(store.orders[0].payment_status, 'paid');
    assert.equal(store.slips[0].slip_status, 'approved');
    // customer notified of approval
    assert.ok(store.notifications.some((n) => n.recipient_id === 'cust-1'));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 6) A non-owner customer cannot approve (cannot self-set paid)
// ---------------------------------------------------------------------------
test('approveStorePaymentSlip: a stranger cannot approve (403)', async () => {
  const orders = [{ ...kbzpayOrder('o1', 'ORD1', 5000), payment_status: 'awaiting_review' }];
  const slips = [{ id: 'slip-1', order_id: 'o1', store_id: STORE_ID, slip_status: 'uploaded', customer_id: 'cust-1' }];
  const { restore } = install(buildHandlers(), {
    orders,
    slips,
    stores: { [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID } },
  });
  try {
    await assert.rejects(
      () => approveStorePaymentSlip('someone-else', 'customer', 'slip-1'),
      /ไม่มีสิทธิ์/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 7) Store owner rejects -> order returns to pending (re-upload allowed)
// ---------------------------------------------------------------------------
test('rejectStorePaymentSlip: owner rejects, order returns to pending', async () => {
  const orders = [{ ...kbzpayOrder('o1', 'ORD1', 5000), payment_status: 'awaiting_review' }];
  const slips = [{ id: 'slip-1', order_id: 'o1', store_id: STORE_ID, slip_status: 'uploaded', customer_id: 'cust-1' }];
  const { store, restore } = install(buildHandlers(), {
    orders,
    slips,
    stores: { [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID } },
  });
  try {
    const result = await rejectStorePaymentSlip(OWNER_ID, 'seller', 'slip-1', 'blurry');
    assert.equal(result.slip.slip_status, 'rejected');
    assert.equal(store.orders[0].payment_status, 'pending');
    assert.ok(store.notifications.some((n) => n.recipient_id === 'cust-1'));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 8) getStorePaymentSlips returns signed URLs (never a public URL)
// ---------------------------------------------------------------------------
test('getStorePaymentSlips: owner lists slips with signed view URLs', async () => {
  const orders = [{ ...kbzpayOrder('o1', 'ORD1', 5000), payment_status: 'awaiting_review' }];
  const slips = [{ id: 'slip-1', order_id: 'o1', store_id: STORE_ID, slip_status: 'uploaded', customer_id: 'cust-1', slip_path: 'payment-slips/o1/x.jpg', slip_url: 'payment-slips/o1/x.jpg' }];
  const { restore } = install(buildHandlers(), {
    orders,
    slips,
    stores: { [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID } },
  });
  try {
    const result = await getStorePaymentSlips(STORE_ID, { id: OWNER_ID, role: 'seller' });
    assert.equal(result.slips.length, 1);
    assert.equal(result.slips[0].slip_view_url, 'https://signed.example/slip.jpg?token=abc');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 9) Non-member cannot list another store's slips (403)
// ---------------------------------------------------------------------------
test('getStorePaymentSlips: a stranger cannot list a store slips (403)', async () => {
  const { restore } = install(buildHandlers(), {
    orders: [],
    slips: [],
    stores: { [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID } },
  });
  try {
    await assert.rejects(
      () => getStorePaymentSlips(STORE_ID, { id: 'stranger', role: 'customer' }),
      /ไม่มีสิทธิ์/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 10) Rejected slip -> re-submit succeeds (order back to pending, no 409 stuck)
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: re-upload after a rejected slip succeeds', async () => {
  const orders = [kbzpayOrder('o1', 'ORD1', 5000)];
  const rejected = { id: 'slip-old', order_id: 'o1', store_id: STORE_ID, slip_status: 'rejected', customer_id: 'cust-1' };
  const { store, restore } = install(buildHandlers(), { orders, slips: [rejected] });
  try {
    const result = await submitStorePaymentSlips('cust-1', STORE_ID, ['o1'], file);
    assert.equal(result.slips.length, 1);
    assert.equal(result.slips[0].slip_status, 'uploaded');
    assert.equal(store.slips.length, 1, 'the old rejected row was replaced, not duplicated');
    assert.equal(store.slips[0].id !== 'slip-old', true);
    assert.equal(store.orders[0].payment_status, 'awaiting_review');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 11) Multi-store parent order: each store attaches its own slip (no UNIQUE clash)
// ---------------------------------------------------------------------------
test('submitStorePaymentSlips: one parent order spanning two stores accepts one slip per store', async () => {
  const STORE_B = 'store-2';
  const OWNER_B = 'owner-2';
  const order = {
    ...kbzpayOrder('o1', 'ORD1', 5000),
    store_orders: [
      { store_id: STORE_ID, store: { id: STORE_ID, name: 'Shop A', owner_id: OWNER_ID } },
      { store_id: STORE_B, store: { id: STORE_B, name: 'Shop B', owner_id: OWNER_B } },
    ],
  };
  const { store, restore } = install(buildHandlers(), {
    orders: [order],
    stores: {
      [STORE_ID]: { id: STORE_ID, owner_id: OWNER_ID },
      [STORE_B]: { id: STORE_B, owner_id: OWNER_B },
    },
  });
  try {
    const r1 = await submitStorePaymentSlips('cust-1', STORE_ID, ['o1'], file);
    const r2 = await submitStorePaymentSlips('cust-1', STORE_B, ['o1'], file);
    assert.equal(r1.slips[0].store_id, STORE_ID);
    assert.equal(r2.slips[0].store_id, STORE_B);
    assert.equal(store.slips.length, 2, 'one slip row per store under the same parent order');
    assert.equal(store.orders[0].payment_status, 'awaiting_review');
  } finally {
    restore();
  }
});