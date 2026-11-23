// Tests for Payment Slip upload/approve/reject (Existing Order Payment — Phase 1)
// Covers TC-PAY-051 to TC-PAY-059

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

import test from 'node:test';
import assert from 'node:assert/strict';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderService = await import('../services/orderService.js');

const { uploadPaymentSlip, getPaymentSlips, approvePaymentSlip, rejectPaymentSlip } = orderService;

// ---------------------------------------------------------------------------
// In-memory Supabase fake with storage mocking
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

// Storage mock
  const storage = {
    from: (bucket) => ({
      upload: async (filePath, fileBuffer, options) => {
        calls.push({ table: 'storage', op: 'upload', bucket, filePath, options });
        const handler = handlers.storage;
        if (!handler) {
          return { data: null, error: { message: `unexpected storage bucket: ${bucket}` } };
        }
        return handler({ op: 'upload', bucket, filePath, fileBuffer, options, calls });
      },
      getPublicUrl: async (filePath) => {
        calls.push({ table: 'storage', op: 'getPublicUrl', bucket, filePath });
        const handler = handlers.storage;
        if (!handler) {
          return { data: null, error: { message: `unexpected storage bucket: ${bucket}` } };
        }
        return handler({ op: 'getPublicUrl', bucket, filePath, calls });
      },
      exists: async (path) => {
        calls.push({ table: 'storage', op: 'exists', bucket, path });
        const handler = handlers.storage;
        if (!handler) {
          return { data: null, error: { message: `unexpected storage bucket: ${bucket}` } };
        }
        return handler({ op: 'exists', bucket, path, calls });
      },
      createSignedUrl: async (path, expiresIn) => {
        calls.push({ table: 'storage', op: 'createSignedUrl', bucket, path, expiresIn });
        const handler = handlers.storage;
        if (!handler) {
          return { data: null, error: { message: `unexpected storage bucket: ${bucket}` } };
        }
        return handler({ op: 'createSignedUrl', bucket, path, expiresIn, calls });
      },
      remove: async (paths) => {
        calls.push({ table: 'storage', op: 'remove', bucket, paths });
        const handler = handlers.storage;
        if (!handler) {
          return { data: null, error: null };
        }
        return handler({ op: 'remove', bucket, paths, calls });
      },
    }),
  };

  return {
    calls,
    from: (table) => makeQuery(table),
    rpc: async (fn, args) => {
      calls.push({ table: 'rpc', op: fn, args });
      if (!handlers.rpc) return { data: null, error: { message: `unexpected rpc: ${fn}` } };
      return handlers.rpc(fn, args, calls);
    },
    storage,
  };
}

function installFakeSupabase(handlers) {
  const original = {
    from: supabaseAdmin.from,
    rpc: supabaseAdmin.rpc,
    storage: supabaseAdmin.storage,
  };
  const fake = createFakeSupabase(handlers);
  supabaseAdmin.from = fake.from;
  supabaseAdmin.rpc = fake.rpc;
  supabaseAdmin.storage = fake.storage;
  return {
    fake,
    restore: () => {
      supabaseAdmin.from = original.from;
      supabaseAdmin.rpc = original.rpc;
      supabaseAdmin.storage = original.storage;
    },
  };
}

function buildPaymentSlipHandlers({
  order,
  existingSlip = null,
  products = { 'prod-1': { id: 'prod-1', store_id: 'store-1', name: 'Test Product', price: 100, discount_price: null, stock: 100, images: [], is_active: true } },
  stores = { 'store-1': { id: 'store-1', name: 'Test Store', address: {}, phone: '0800000000', delivery_fee: 20, minimum_order: 0, estimated_delivery_time: 30, delivery_type: 'store_delivery' } },
  settings = {},
  uploadResult = { data: { path: 'payment-slips/order-1/1234567890-slip.jpg' }, error: null },
  removeResult = { data: null, error: null },
  publicUrlResult = { data: { publicUrl: 'https://example.com/storage/v1/object/public/payment-slips/order-1/1234567890-slip.jpg' }, error: null },
  slipInsertResult = { data: { id: 'slip-1', order_id: 'order-1', customer_id: 'cust-1', slip_status: 'uploaded', amount_thb: 127, slip_url: 'https://example.com/slip.jpg', slip_filename: 'slip.jpg', note: null, created_at: new Date().toISOString() }, error: null },
  options = {},
}) {
  const slips = existingSlip ? [existingSlip] : [];
  const orders = order ? [{ ...order }] : [];

  const handlers = {
    orders: ({ op, payload, filters }) => {
      if (op === 'select' || op === 'update') {
        const orderRow = orders.find((o) => o.id === filters.id);
        if (!orderRow) return { data: null, error: { message: 'order not found' } };
        if (op === 'update') {
          Object.assign(orderRow, payload);
          return { data: orderRow, error: null };
        }
        return { data: orderRow, error: null };
      }
      return { data: null, error: { message: `unexpected orders op: ${op}` } };
    },

    payment_slips: ({ op, payload, filters }) => {
      if (op === 'select') {
        if (filters.order_id) {
          const slip = slips.find((s) => s.order_id === filters.order_id);
          return { data: slip || null, error: null };
        }
        if (filters.id) {
          const slip = slips.find((s) => s.id === filters.id);
          return { data: slip || null, error: null };
        }
        return { data: slips, error: null };
      }
      if (op === 'insert') {
        const slip = { id: 'slip-1', ...payload, created_at: new Date().toISOString() };
        slips.push(slip);
        return { data: slip, error: null };
      }
      if (op === 'update') {
        const slip = slips.find((s) => s.id === filters.id);
        if (!slip) return { data: null, error: { message: 'slip not found' } };
        Object.assign(slip, payload);
        return { data: slip, error: null };
      }
      if (op === 'delete') {
        const idx = slips.findIndex((s) => s.id === filters.id);
        if (idx === -1) return { data: null, error: { message: 'slip not found' } };
        const deleted = slips.splice(idx, 1);
        return { data: deleted, error: null };
      }
      return { data: null, error: { message: `unexpected payment_slips op: ${op}` } };
    },

    products: ({ filters }) => {
      const product = products[filters.id];
      if (!product) return { data: null, error: { message: 'product not found' } };
      return { data: product, error: null };
    },

    settings: ({ filters }) => {
      const row = settings[filters.key];
      if (row === undefined) return { data: null, error: null };
      return { data: row, error: null };
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

storage: ({ op, bucket, filePath, fileBuffer, options, paths }) => {
  if (op === 'upload') {
    return { ...uploadResult, data: { ...(uploadResult.data || {}), path: filePath } };
  }
  if (op === 'getPublicUrl') {
    return { ...publicUrlResult, data: { ...(publicUrlResult.data || {}), publicUrl: `https://example.com/${filePath}` } };
  }
  if (op === 'exists') {
    return { data: true, error: null };
  }
  if (op === 'createSignedUrl') {
    return { data: { signedUrl: `https://example.com/signed/${bucket}/${filePath}?token=xyz` }, error: null };
  }
  if (op === 'remove') {
    return removeResult || { data: null, error: null };
  }
  return { data: null, error: { message: `unexpected storage op: ${op}` } };
},

    rpc: (fn, args, allCalls) => {
      switch (fn) {
        case 'generate_order_number':
          return { data: 'ORD20260101001', error: null };
        case 'generate_store_order_number':
          return { data: 'SO20260101001', error: null };
        case 'generate_payment_number':
          return { data: 'PAY20260101001', error: null };
        case 'check_and_reserve_stock':
          return { data: [{ success: true }], error: null };
        case 'release_stock_reservation':
          return { data: null, error: null };
        case 'update_store_order_status_with_reason':
          return { data: { success: true }, error: null };
        default:
          allCalls.push({ table: 'rpc', op: fn });
          return { data: null, error: { message: `unexpected rpc: ${fn}` } };
      }
    },
  };

  return { handlers, slips, orders };
}

// Helper to create a pending order (not COD, so payment slip upload applies)
const pendingOrder = {
  id: 'order-1',
  customer_id: 'cust-1',
  payment_status: 'pending',
  payment_method: 'transfer',
  total_amount: 127,
  order_number: 'ORD20260101001',
};

// ---------------------------------------------------------------------------
// TC-PAY-051: Customer uploads payment slip for pending order (happy path)
// ---------------------------------------------------------------------------
test('TC-PAY-051: Customer uploads payment slip for pending order', async () => {
  const { handlers, orders } = buildPaymentSlipHandlers({ order: pendingOrder });
  const { restore } = installFakeSupabase(handlers);

  try {
    const result = await uploadPaymentSlip('cust-1', 'order-1', {
      fileBuffer: Buffer.from('fake-image-data'),
      fileName: 'slip.jpg',
      mimeType: 'image/jpeg',
      amountThb: 127,
      note: 'Paid via bank transfer',
    });

    assert.equal(result.slip.slip_status, 'uploaded');
    assert.equal(result.slip.amount_thb, 127);
    assert.equal(result.slip.customer_id, 'cust-1');
    assert.equal(result.slip.order_id, 'order-1');
    assert.equal(result.order.id, 'order-1');
    assert.equal(orders[0].payment_status, 'pending', 'Order payment_status should remain pending after upload');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-052: Duplicate upload rejected (slip already exists with 'uploaded' status)
// ---------------------------------------------------------------------------
test('TC-PAY-052: Duplicate upload rejected when slip already uploaded', async () => {
  const existingSlip = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'uploaded',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    created_at: new Date().toISOString(),
  };
  const { handlers } = buildPaymentSlipHandlers({
    order: pendingOrder,
    existingSlip,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => uploadPaymentSlip('cust-1', 'order-1', {
        fileBuffer: Buffer.from('fake-image-data'),
        fileName: 'slip2.jpg',
        mimeType: 'image/jpeg',
        amountThb: 127,
        note: 'Retry',
      }),
      /ได้อัปโหลดสลิปสำหรับคำสั่งซื้อนี้แล้ว/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-053: Rejected slip can be re-uploaded
// ---------------------------------------------------------------------------
test('TC-PAY-053: Rejected slip can be re-uploaded', async () => {
  const existingSlip = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'rejected',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    reject_reason: 'Image unclear',
    created_at: new Date().toISOString(),
  };
  const { handlers, slips } = buildPaymentSlipHandlers({
    order: pendingOrder,
    existingSlip,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    const result = await uploadPaymentSlip('cust-1', 'order-1', {
      fileBuffer: Buffer.from('fake-image-data'),
      fileName: 'slip2.jpg',
      mimeType: 'image/jpeg',
      amountThb: 127,
      note: 'Re-uploaded',
    });

    assert.equal(result.slip.slip_status, 'uploaded');
    assert.equal(slips.length, 1, 'Old rejected slip should be replaced by new upload');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-054: Cannot upload for already paid order
// ---------------------------------------------------------------------------
test('TC-PAY-054: Cannot upload payment slip for already paid order', async () => {
  const paidOrder = { ...pendingOrder, payment_status: 'paid' };
  const { handlers } = buildPaymentSlipHandlers({ order: paidOrder });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => uploadPaymentSlip('cust-1', 'order-1', {
        fileBuffer: Buffer.from('fake-image-data'),
        fileName: 'slip.jpg',
        mimeType: 'image/jpeg',
        amountThb: 127,
        note: '',
      }),
      /คำสั่งซื้อนี้ได้รับการชำระเงินแล้วหรือไม่อยู่ในสถานะที่รอการชำระเงิน/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-055: Cannot upload for order not owned by customer
// ---------------------------------------------------------------------------
test('TC-PAY-055: Cannot upload payment slip for order owned by another customer', async () => {
  const otherOrder = { ...pendingOrder, customer_id: 'cust-2' };
  const { handlers } = buildPaymentSlipHandlers({ order: otherOrder });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => uploadPaymentSlip('cust-1', 'order-1', {
        fileBuffer: Buffer.from('fake-image-data'),
        fileName: 'slip.jpg',
        mimeType: 'image/jpeg',
        amountThb: 127,
        note: '',
      }),
      /ไม่มีสิทธิ์อัปโหลดสลิปสำหรับคำสั่งซื้อนี้/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-056: Admin approves payment slip (sets order payment_status to 'paid')
// ---------------------------------------------------------------------------
test('TC-PAY-056: Admin approves payment slip, order payment_status becomes paid', async () => {
  const slipWithOrder = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'uploaded',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    created_at: new Date().toISOString(),
    order: { id: 'order-1', payment_status: 'pending', customer_id: 'cust-1' },
  };
  const { handlers, orders, slips } = buildPaymentSlipHandlers({
    order: pendingOrder,
    existingSlip: slipWithOrder,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    const result = await approvePaymentSlip('admin-1', 'slip-1');

    assert.equal(result.slip.slip_status, 'approved');
    assert.equal(result.order.payment_status, 'paid');
    assert.equal(orders[0].payment_status, 'paid', 'Order payment_status should be updated to paid');
    assert.equal(slips[0].slip_status, 'approved');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-057: Admin rejects payment slip (order stays pending)
// ---------------------------------------------------------------------------
test('TC-PAY-057: Admin rejects payment slip, order stays pending', async () => {
  const slipWithOrder = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'uploaded',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    created_at: new Date().toISOString(),
    order: { id: 'order-1', payment_status: 'pending', customer_id: 'cust-1' },
  };
  const { handlers, orders, slips } = buildPaymentSlipHandlers({
    order: pendingOrder,
    existingSlip: slipWithOrder,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    const result = await rejectPaymentSlip('admin-1', 'slip-1', 'Image too blurry to verify');

    assert.equal(result.slip.slip_status, 'rejected');
    assert.equal(result.slip.reject_reason, 'Image too blurry to verify');
    assert.equal(orders[0].payment_status, 'pending', 'Order payment_status should remain pending');
    assert.equal(slips[0].slip_status, 'rejected');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-058: Cannot approve already approved slip
// ---------------------------------------------------------------------------
test('TC-PAY-058: Cannot approve already approved slip', async () => {
  const approvedSlip = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'approved',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    created_at: new Date().toISOString(),
    order: { id: 'order-1', payment_status: 'paid', customer_id: 'cust-1' },
  };
  const { handlers } = buildPaymentSlipHandlers({
    order: { ...pendingOrder, payment_status: 'paid' },
    existingSlip: approvedSlip,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => approvePaymentSlip('admin-1', 'slip-1'),
      /สลิปนี้ได้รับการอนุมัติแล้ว/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// TC-PAY-059: Cannot reject already rejected slip
// ---------------------------------------------------------------------------
test('TC-PAY-059: Cannot reject already rejected slip', async () => {
  const rejectedSlip = {
    id: 'slip-1',
    order_id: 'order-1',
    customer_id: 'cust-1',
    slip_status: 'rejected',
    amount_thb: 127,
    slip_url: 'https://example.com/slip.jpg',
    slip_filename: 'slip.jpg',
    note: null,
    created_at: new Date().toISOString(),
    order: { id: 'order-1', payment_status: 'pending', customer_id: 'cust-1' },
  };
  const { handlers } = buildPaymentSlipHandlers({
    order: pendingOrder,
    existingSlip: rejectedSlip,
  });
  const { restore } = installFakeSupabase(handlers);

  try {
    await assert.rejects(
      () => rejectPaymentSlip('admin-1', 'slip-1', 'Duplicate'),
      /สลิปนี้ถูกปฏิเสธแล้ว/
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
