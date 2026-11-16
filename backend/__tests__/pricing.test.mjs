// Mock-based tests for the pricing / payment rules.
//
// These tests never touch Supabase: the client is replaced with an in-memory
// fake that records every write. They prove the rules that protect revenue,
// but they are NOT a substitute for verifying the real database.
//
// Run with:  npm --prefix backend test   (or: node --test __tests__)

import test from 'node:test';
import assert from 'node:assert/strict';

// config/supabase.js needs these to build its clients; no request is made.
process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');
const productService = await import('../services/productService.js');
const pricing = await import('../utils/productPricing.js');

const { createOrder, calculateEffectivePrice, createPaymentRecord } = orderService;
const {
  resolveEffectivePrice,
  validateProductPricing,
  validateUpdatedProductPricing,
  DISCOUNT_ZERO_MESSAGE,
} = pricing;

// ---------------------------------------------------------------------------
// In-memory Supabase fake
// ---------------------------------------------------------------------------

function createFakeSupabase(handlers) {
  const calls = [];

  const makeQuery = (table) => {
    const state = { write: null, filters: {} };

    const settle = (op) => {
      const payload = state.write?.payload ?? null;
      calls.push({ table, op, payload, filters: { ...state.filters } });
      const handler = handlers[table];
      if (!handler) {
        return { data: null, error: { message: `unexpected table: ${table}` } };
      }
      return handler({ op, payload, filters: state.filters, calls });
    };

    const builder = {
      select: () => builder,
      insert: (payload) => {
        state.write = { type: 'insert', payload };
        return builder;
      },
      update: (payload) => {
        state.write = { type: 'update', payload };
        return builder;
      },
      delete: () => {
        state.write = { type: 'delete' };
        return builder;
      },
      eq: (column, value) => {
        state.filters[column] = value;
        return builder;
      },
      neq: (column, value) => {
        state.filters[`neq.${column}`] = value;
        return builder;
      },
      in: (column, values) => {
        state.filters[`in.${column}`] = values;
        return builder;
      },
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      single: async () => settle(state.write?.type ?? 'select'),
      maybeSingle: async () => settle(state.write?.type ?? 'select'),
      then: (resolve, reject) =>
        Promise.resolve().then(() => settle(state.write?.type ?? 'select')).then(resolve, reject),
    };

    return builder;
  };

  return {
    calls,
    from: (table) => makeQuery(table),
    rpc: async (fn, args) => {
      calls.push({ table: 'rpc', op: fn, args });
      if (!handlers.rpc) return { data: null, error: { message: `unexpected rpc: ${fn}` } };
      return handlers.rpc(fn, args, calls);
    },
  };
}

function installFakeSupabase(handlers) {
  const original = { from: supabaseAdmin.from, rpc: supabaseAdmin.rpc };
  const fake = createFakeSupabase(handlers);
  supabaseAdmin.from = fake.from;
  supabaseAdmin.rpc = fake.rpc;
  return {
    fake,
    restore: () => {
      supabaseAdmin.from = original.from;
      supabaseAdmin.rpc = original.rpc;
    },
  };
}

// Builds handlers covering the tables createOrder() touches.
function buildOrderHandlers({ products, stores, options = {} }) {
  const created = {
    orders: [],
    store_orders: [],
    order_items: [],
    payments: [],
    stock_releases: [],
    stock_reservations: [],
  };
  let storeOrderSeq = 0;
  let paymentSeq = 0;

  const handlers = {
    products: ({ filters }) => {
      const product = products[filters.id];
      if (!product) return { data: null, error: { message: 'product not found' } };
      return { data: product, error: null };
    },

    profiles: () => ({
      data: { name: 'Test Customer', phone: '0800000000', email: 'c@example.com', address: {} },
      error: null,
    }),

    stores: ({ filters }) => {
      const store = stores[filters.id];
      if (!store) return { data: null, error: { message: 'store not found' } };
      return { data: store, error: null };
    },

    orders: ({ op, payload, filters }) => {
      if (op === 'insert') {
        if (options.failOrderInsert) return { data: null, error: { message: 'order insert failed' } };
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

    customer_destinations: () => ({ data: null, error: null }),

    store_orders: ({ op, payload }) => {
      if (op === 'insert') {
        const storeOrder = { id: `so-${++storeOrderSeq}`, ...payload };
        created.store_orders.push(storeOrder);
        return { data: storeOrder, error: null };
      }
      return { data: null, error: { message: 'unexpected store_orders op' } };
    },

    order_items: ({ payload }) => {
      created.order_items.push(...payload);
      return { data: null, error: null };
    },

    payments: ({ op, payload }) => {
      if (op === 'insert') {
        if (options.failPayment) {
          return { data: null, error: { message: 'payment insert failed' } };
        }
        const payment = { id: `pay-${++paymentSeq}`, ...payload };
        created.payments.push(payment);
        return { data: payment, error: null };
      }
      return { data: null, error: { message: 'unexpected payments op' } };
    },

    rpc: (fn, args, allCalls) => {
      switch (fn) {
        case 'generate_order_number':
          return { data: 'ORD20260101001', error: null };
        case 'generate_store_order_number':
          return { data: `SO${storeOrderSeq + 1}`.padEnd(3, '0'), error: null };
        case 'generate_payment_number':
          return { data: 'PAY20260101001', error: null };
        case 'check_and_reserve_stock': {
          if (options.failStockReservation) {
            return { data: [{ success: false, message: 'out of stock' }], error: null };
          }
          created.stock_reservations.push(args.p_store_order_id);
          return { data: [{ success: true }], error: null };
        }
        case 'release_stock_reservation':
          created.stock_releases.push(args.p_store_order_id);
          return { data: null, error: null };
        default:
          allCalls.push({ table: 'rpc', op: fn });
          return { data: null, error: { message: `unexpected rpc: ${fn}` } };
      }
    },
  };

  return { handlers, created };
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

const orderInput = (items, paymentMethod = 'promptpay') => ({
  items,
  payment_method: paymentMethod,
  customer_notes: null,
  delivery_address: { name: 'C', phone: '0800000000', address: 'addr' },
  customer_coordinates: null,
});

// ---------------------------------------------------------------------------
// 1-6. discount_price interpretation
// ---------------------------------------------------------------------------

test('1. discount_price NULL -> regular price is charged', () => {
  assert.equal(resolveEffectivePrice(100, null), 100);
  assert.equal(resolveEffectivePrice(100, undefined), 100);
  assert.equal(calculateEffectivePrice(100, null), 100);

  const result = validateProductPricing({ price: 100, discount: null });
  assert.deepEqual(result.errors, []);
  assert.equal(result.price, 100);
  assert.equal(result.discount, null);
});

test('2. discount_price 0 -> rejected on write, charged as regular price on read', () => {
  const result = validateProductPricing({ price: 100, discount: 0 });
  assert.ok(result.errors.includes(DISCOUNT_ZERO_MESSAGE), 'creating a 0 discount must be rejected');

  const update = validateUpdatedProductPricing({ price: 100, discount: 0, currentPrice: 100, currentDiscount: null });
  assert.ok(update.errors.includes(DISCOUNT_ZERO_MESSAGE), 'updating to a 0 discount must be rejected');

  // Legacy rows that already store 0 must never become free items.
  assert.equal(resolveEffectivePrice(100, 0), 100);
  assert.equal(calculateEffectivePrice(100, 0), 100);
  assert.equal(resolveEffectivePrice(100, '0'), 100);
});

test('3. discount_price 80 with price 100 -> 80 is charged', () => {
  assert.equal(resolveEffectivePrice(100, 80), 80);
  assert.equal(resolveEffectivePrice('100.00', '80.00'), 80);

  const result = validateProductPricing({ price: 100, discount: 80 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.discount, 80);
});

test('4. discount_price 100 with price 100 -> rejected', () => {
  const result = validateProductPricing({ price: 100, discount: 100 });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /ต้องน้อยกว่าราคาปกติ/);

  const update = validateUpdatedProductPricing({ price: 100, discount: 100, currentPrice: 100, currentDiscount: null });
  assert.equal(update.errors.length, 1);
});

test('5. discount_price 120 with price 100 -> rejected', () => {
  const result = validateProductPricing({ price: 100, discount: 120 });
  assert.equal(result.errors.length, 1);

  // String inputs (multipart) must be compared numerically: '120' >= '100'.
  const stringResult = validateProductPricing({ price: '100', discount: '120' });
  assert.equal(stringResult.errors.length, 1);

  // A legacy inconsistent row still charges the regular price, never 120.
  assert.equal(resolveEffectivePrice(100, 120), 100);
});

test('6. negative discount_price -> rejected', () => {
  const result = validateProductPricing({ price: 100, discount: -1 });
  assert.ok(result.errors.includes(pricing.DISCOUNT_INVALID_MESSAGE));

  const update = validateUpdatedProductPricing({ price: 100, discount: -5, currentPrice: 100, currentDiscount: null });
  assert.ok(update.errors.includes(pricing.DISCOUNT_INVALID_MESSAGE));

  assert.equal(resolveEffectivePrice(100, -5), 100);
});

// ---------------------------------------------------------------------------
// 7. stock-only update must not touch prices
// ---------------------------------------------------------------------------

test('7. updating only stock leaves price and discount_price untouched', async () => {
  const stored = product({ price: 100, discount_price: 0, stock: 7 });
  let updatePayload = null;

  const { restore } = installFakeSupabase({
    products: ({ op, payload }) => {
      if (op === 'insert') return { data: null, error: { message: 'unexpected insert' } };
      if (op === 'update') {
        updatePayload = payload;
        return { data: { ...stored, ...payload }, error: null };
      }
      return { data: stored, error: null };
    },
    stores: () => ({ data: { id: 'store-1' }, error: null }),
  });

  try {
    const updated = await productService.updateProduct('prod-1', 'store-1', 'owner-1', { stock: 5 });

    assert.deepEqual(updatePayload, { stock: 5 });
    assert.equal(updated.price, 100);
    assert.equal(updated.discount_price, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 8. client prices are ignored
// ---------------------------------------------------------------------------

test('8. a tampered price in the request body is ignored (DB price is charged)', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 100, discount_price: 80 }) },
    stores: { 'store-1': store },
  });
  const { fake, restore } = installFakeSupabase(handlers);

  try {
    const order = await createOrder(
      'cust-1',
      orderInput([
        {
          product_id: 'prod-1',
          quantity: 2,
          // forged by the client:
          price: 1,
          unit_price: 1,
          total_price: 2,
          amount: 2,
        },
      ])
    );

    assert.equal(created.order_items[0].unit_price, 80);
    assert.equal(created.order_items[0].total_price, 160);
    assert.equal(order.total_amount, 191.2); // 160 + 7% tax (11.20) + shipping 20
    assert.ok(fake.calls.some((c) => c.table === 'products'));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 9. payment amount equals the order total
// ---------------------------------------------------------------------------

test('9. payment amount always equals the stored order total', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 100, discount_price: null }) },
    stores: { 'store-1': store },
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    const order = await createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 3 }], 'card'));

    assert.equal(created.payments.length, 1);
    assert.equal(created.payments[0].amount, order.total_amount);
    assert.equal(created.payments[0].amount, 341); // 300 + 21 tax + 20 shipping
    assert.equal(order.total_amount, 341);
    assert.equal(order.subtotal, 300);
    assert.equal(order.tax_amount, 21);
    assert.equal(order.shipping_fee, 20);
    assert.equal(created.order_items[0].total_price, 300);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 10. a failed payment must not leave reserved stock behind
// ---------------------------------------------------------------------------

test('10. failed payment releases reserved stock and cancels the order', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 100 }) },
    stores: { 'store-1': store },
    options: { failPayment: true },
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 1 }], 'card')),
      /payment insert failed|createPaymentRecord|Payment record creation failed/
    );

    assert.equal(created.stock_reservations.length, 1, 'stock was reserved before the payment failed');
    assert.deepEqual(created.stock_releases, ['so-1'], 'reserved stock must be released');
    assert.equal(created.orders[0].status, 'cancelled', 'the orphan order must be cancelled');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Extra: zero-total orders are rejected before anything is written
// ---------------------------------------------------------------------------

test('11. a zero-priced item is rejected before any order or stock write', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 0, discount_price: null }) },
    stores: { 'store-1': store },
  });
  const { fake, restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 1 }])),
      /invalid price/i
    );

    assert.equal(created.orders.length, 0, 'no order may be created');
    assert.equal(created.store_orders.length, 0, 'no store order may be created');
    assert.equal(created.stock_reservations.length, 0, 'stock must not be reserved');
    assert.equal(fake.calls.filter((c) => c.table === 'payments').length, 0);
  } finally {
    restore();
  }
});

test('12. a legacy 0 discount still produces a payable (non-zero) order', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 100, discount_price: 0 }) },
    stores: { 'store-1': store },
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    const order = await createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 2 }], 'promptpay'));

    assert.equal(created.order_items[0].unit_price, 100, 'legacy 0 discount charges the regular price');
    assert.equal(created.payments[0].amount, order.total_amount);
    assert.equal(order.total_amount, 234); // 200 + 14 tax + 20 shipping
  } finally {
    restore();
  }
});

test('13. non-integer or non-positive quantity is rejected', async () => {
  const { handlers, created } = buildOrderHandlers({
    products: { 'prod-1': product({ price: 100 }) },
    stores: { 'store-1': store },
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 0 }])),
      /Invalid quantity/i
    );
    await assert.rejects(
      () => createOrder('cust-1', orderInput([{ product_id: 'prod-1', quantity: 1.5 }])),
      /Invalid quantity/i
    );
    assert.equal(created.orders.length, 0);
  } finally {
    restore();
  }
});

test('14. createPaymentRecord refuses amounts <= 0 instead of hitting a DB constraint', async () => {
  assert.rejects(() => createPaymentRecord('order-1', null, 0, 'card'), /greater than 0/);
  assert.rejects(() => createPaymentRecord('order-1', null, -10, 'card'), /greater than 0/);
  assert.rejects(() => createPaymentRecord('order-1', null, Number.NaN, 'card'), /greater than 0/);
});