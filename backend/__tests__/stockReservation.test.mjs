// Regression tests for stock reservation (check_and_reserve_stock / release_stock_reservation).
//
// Root cause (see supabase/migrations/003_triggers_functions.sql):
//   check_and_reserve_stock declared `item RECORD` and iterated
//   `FOR item IN SELECT * FROM jsonb_array_elements(p_items) AS elem`.
//   `item` is a RECORD whose single field `elem` is jsonb, but the body used
//   `item->>'product_id'` (9 places), i.e. the `->>` operator on a RECORD,
//   which raises: operator does not exist: record ->> unknown
//   The fix accesses the jsonb field via `item.elem->>'...'` (9 occurrences).
//
// These tests exercise the service-layer contract
// (orderService.reserveStock / releaseStockReservation / createOrder) against
// a fake Supabase client. The SQL function itself cannot be executed here
// (no local Postgres listener and cloud changes are restricted pending
// approval); the unit tests lock in the RPC request/response contract that the
// fixed function must honor: p_items is a JSONB array of {product_id, quantity}
// and each result row is {product_id, success, message}.

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

import test from 'node:test';
import assert from 'node:assert/strict';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');

const { createOrder, reserveStock, releaseStockReservation } = orderService;

// ---------------------------------------------------------------------------
// In-memory Supabase fake (mirrors the pattern used by pricing.test.mjs /
// kbzpay-cod-payment.test.mjs, but self-contained).
// ---------------------------------------------------------------------------

function createFakeSupabase(handlers) {
  const calls = [];
  const created = {
    orders: [],
    store_orders: [],
    order_items: [],
    payments: [],
    stock_reservations: [],
    stock_releases: [],
  };

  const makeQuery = (table) => {
    const state = { write: null, filters: {} };

    const settle = (op) => {
      const payload = state.write?.payload ?? null;
      calls.push({ table, op, payload, filters: { ...state.filters } });
      const handler = handlers[table];
      if (!handler) {
        return { data: null, error: { message: `unexpected table: ${table}` } };
      }
      return handler({ op, payload, filters: state.filters, calls, created });
    };

    const builder = {
      select: () => builder,
      insert: (payload) => { state.write = { type: 'insert', payload }; return builder; },
      update: (payload) => { state.write = { type: 'update', payload }; return builder; },
      delete: () => { state.write = { type: 'delete' }; return builder; },
      eq: (column, value) => { state.filters[column] = value; return builder; },
      order: () => builder,
      single: async () => settle(state.write?.type ?? 'select'),
      maybeSingle: async () => settle(state.write?.type ?? 'select'),
      then: (resolve, reject) =>
        Promise.resolve().then(() => settle(state.write?.type ?? 'select')).then(resolve, reject),
    };
    return builder;
  };

  return {
    calls,
    created,
    from: (table) => makeQuery(table),
    rpc: async (fn, args) => {
      calls.push({ table: 'rpc', op: fn, args });
      if (!handlers.rpc) {
        return { data: null, error: { message: `unexpected rpc: ${fn}` } };
      }
      return handlers.rpc(fn, args, calls, created);
    },
  };
}

function installFakeSupabase(handlers) {
  const original = { from: supabaseAdmin.from, rpc: supabaseAdmin.rpc };
  const fake = createFakeSupabase(handlers);
  supabaseAdmin.from = fake.from;
  supabaseAdmin.rpc = fake.rpc;
  return { fake, restore: () => { supabaseAdmin.from = original.from; supabaseAdmin.rpc = original.rpc; } };
}

const store = {
  id: 'store-1',
  name: 'Test Store',
  address: {},
  phone: '0800000000',
  delivery_fee: 20,
  minimum_order: 0,
  estimated_delivery_time: 30,
  delivery_type: 'store_delivery',
};

const product = (overrides = {}) => ({
  id: 'prod-1',
  store_id: 'store-1',
  name: 'Test Product',
  price: 100,
  discount_price: null,
  stock: 100,
  images: ['https://cdn.example.com/p.jpg'],
  is_active: true,
  ...overrides,
});

const orderInput = (items, paymentMethod = 'cod', extraFields = {}) => ({
  items,
  payment_method: paymentMethod,
  customer_notes: null,
  delivery_address: { name: 'C', phone: '0800000000', address: 'addr' },
  customer_coordinates: null,
  ...extraFields,
});

function buildOrderHandlers({ options = {} } = {}) {
  let storeOrderSeq = 0;
  const handlers = {
    products: ({ filters }) => {
      const product = options.products?.[filters.id];
      if (!product) return { data: null, error: { message: 'product not found' } };
      return { data: product, error: null };
    },
    settings: ({ filters }) => {
      const row = options.settings?.[filters.key];
      if (row === undefined) return { data: null, error: null };
      return { data: row, error: null };
    },
    profiles: () => ({ data: { name: 'Test Customer', phone: '0800000000', email: 'c@example.com', address: {} }, error: null }),
    stores: ({ filters }) => {
      const store = options.stores?.[filters.id];
      if (!store) return { data: null, error: { message: 'store not found' } };
      return { data: store, error: null };
    },
    orders: ({ op, payload, filters, created }) => {
      if (op === 'insert') {
        const order = { id: 'order-1', ...payload };
        created.orders.push(order);
        return { data: order, error: null };
      }
      if (op === 'update') {
        const order = created.orders.find((o) => o.id === filters.id);
        if (!order) return { data: null, error: { message: 'order not found' } };
        Object.assign(order, payload);
        return { data: order, error: null };
      }
      const order = created.orders.find((o) => o.id === filters.id);
      if (!order) return { data: null, error: { message: 'order not found' } };
      return {
        data: {
          ...order,
          store_orders: created.store_orders
            .filter((so) => so.parent_order_id === order.id)
            .map((so) => ({
              ...so,
              order_items: created.order_items.filter((oi) => oi.store_order_id === so.id),
            })),
          payments: created.payments.filter((p) => p.order_id === order.id),
        },
        error: null,
      };
    },
    store_orders: ({ op, payload, created }) => {
      if (op === 'insert') {
        const storeOrder = { id: `so-${++storeOrderSeq}`, ...payload };
        created.store_orders.push(storeOrder);
        return { data: storeOrder, error: null };
      }
      return { data: null, error: { message: 'unexpected store_orders op' } };
    },
    order_items: ({ payload, created }) => {
      created.order_items.push(...payload);
      return { data: null, error: null };
    },
  };
  return handlers;
}

function buildRpcHandlers({ options = {} } = {}) {
  let capturedItems = null;
  return (fn, args, calls, created) => {
    switch (fn) {
      case 'generate_order_number':
        return { data: 'ORD20260101001', error: null };
      case 'generate_store_order_number':
        return { data: `SO${String(created.store_orders.length + 1).padStart(3, '0')}`, error: null };
      case 'check_and_reserve_stock': {
        capturedItems = args.p_items;
        if (options.failStockReservation) {
          return { data: [{ product_id: 'prod-1', success: false, message: 'Insufficient stock' }], error: null };
        }
        if (options.rpcError) {
          return { data: null, error: { message: 'rpc failure' } };
        }
        created.stock_reservations.push(args.p_store_order_id);
        return {
          data: [{ product_id: 'prod-1', success: true, message: 'Stock reserved' }],
          error: null,
        };
      }
      case 'release_stock_reservation': {
        created.stock_releases.push(args.p_store_order_id);
        return { data: null, error: null };
      }
      default:
        return { data: null, error: { message: `unexpected rpc: ${fn}` } };
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reserveStock: happy path returns all-success reservation rows', async () => {
  const handlers = buildOrderHandlers();
  const rpc = buildRpcHandlers();
  const { fake, restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    const data = await reserveStock('so-1', [{ product_id: 'prod-1', quantity: 2 }]);
    assert.equal(data.length, 1);
    assert.equal(data[0].product_id, 'prod-1');
    assert.equal(data[0].success, true);
    assert.equal(data[0].message, 'Stock reserved');
    // p_items is passed as a JSONB array of {product_id, quantity} objects.
    assert.equal(Array.isArray(fake.calls.find((c) => c.op === 'check_and_reserve_stock').args.p_items), true);
    assert.equal(fake.calls.find((c) => c.op === 'check_and_reserve_stock').args.p_items[0].product_id, 'prod-1');
    assert.equal(fake.calls.find((c) => c.op === 'check_and_reserve_stock').args.p_items[0].quantity, 2);
    assert.equal(fake.created.stock_reservations.length, 1);
  } finally {
    restore();
  }
});

test('reserveStock: any failed item throws ValidationError and triggers release', async () => {
  const handlers = buildOrderHandlers();
  const rpc = buildRpcHandlers({ options: { failStockReservation: true } });
  const { fake, restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    await assert.rejects(
      () => reserveStock('so-1', [{ product_id: 'prod-1', quantity: 200 }]),
      /Stock reservation failed: Insufficient stock/
    );
    // Rollback: release stock reservation was invoked for the store order.
    assert.equal(fake.created.stock_releases.length, 1);
    assert.equal(fake.created.stock_releases[0], 'so-1');
  } finally {
    restore();
  }
});

test('reserveStock: RPC error throws AppError', async () => {
  const handlers = buildOrderHandlers();
  const rpc = buildRpcHandlers({ options: { rpcError: true } });
  const { restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    await assert.rejects(
      () => reserveStock('so-1', [{ product_id: 'prod-1', quantity: 1 }]),
      /Stock reservation failed: rpc failure/
    );
  } finally {
    restore();
  }
});

test('releaseStockReservation: calls release_stock_reservation RPC and swallows RPC errors', async () => {
  const handlers = buildOrderHandlers();
  const rpc = buildRpcHandlers();
  const { fake, restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    await releaseStockReservation('so-1');
    assert.equal(fake.created.stock_releases.length, 1);
    assert.equal(fake.created.stock_releases[0], 'so-1');
  } finally {
    restore();
  }
});

test('createOrder COD: successful stock reservation completes the order (no payment record)', async () => {
  const handlers = buildOrderHandlers({
    options: {
      products: { 'prod-1': product() },
      stores: { 'store-1': store },
    },
  });
  const rpc = buildRpcHandlers();
  const { fake, restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    const order = await createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 1 }], 'cod'));
    assert.equal(order.payment_method, 'cod');
    assert.equal(order.payment_status, 'pending');
    assert.equal(fake.created.orders.length, 1, 'order was created');
    assert.equal(fake.created.payments.length, 0, 'no payment record for COD');
    assert.equal(fake.created.stock_reservations.length, 1, 'stock reserved');
    assert.equal(fake.created.stock_releases.length, 0, 'no stock released on success');
  } finally {
    restore();
  }
});

test('createOrder COD: failed stock reservation rolls back (no order left behind)', async () => {
  const handlers = buildOrderHandlers({
    options: {
      products: { 'prod-1': product() },
      stores: { 'store-1': store },
    },
  });
  const rpc = buildRpcHandlers({ options: { failStockReservation: true } });
  const { fake, restore } = installFakeSupabase({ ...handlers, rpc });
  try {
    await assert.rejects(
      () => createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 1 }], 'cod')),
      /Stock reservation failed: Insufficient stock/
    );
    // The order row was created before stock reservation, so on rollback it is
    // left behind in cancelled status (existing rollback behavior is preserved).
    assert.equal(fake.created.orders.length, 1, 'order row exists but is cancelled');
    assert.equal(fake.created.orders[0].status, 'cancelled');
    assert.ok(fake.created.stock_releases.length >= 1, 'stock was released on rollback');
    assert.equal(fake.created.stock_releases[0], 'so-1');
  } finally {
    restore();
  }
});
