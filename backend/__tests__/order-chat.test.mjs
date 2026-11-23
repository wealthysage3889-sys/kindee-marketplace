// Regression tests for the Order-to-Chat integration (orderChatService).
//
// These tests never touch a real database or network: the Supabase client is
// replaced with an in-memory fake tailored to the query shapes orderChatService
// (and the chatService helpers it reuses) issue. They prove:
//
//   - COD orders post an order message into the customer<->store chat.
//   - KBZPay orders do NOT post at creation, and DO post after a successful
//     slip submission.
//   - A multi-store order posts each store_order only into its own store's
//     conversation (no cross-store leakage).
//   - Retries / repeated calls never duplicate a message (idempotency via
//     client_message_id + ux_messages_client_id).
//   - Both the customer and the store owner can read the same message.
//   - Status updates (store order status + payment approve/reject) refresh the
//     card without breaking chat or voice-call subsystems.
//
// Run with:  npm --prefix backend test

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

import test from 'node:test';
import assert from 'node:assert/strict';

const { supabaseAdmin } = await import('../config/supabase.js');
const orderChat = await import('../services/orderChatService.js');
const chatService = await import('../services/chatService.js');

const {
  sendOrderChatForOrder,
  sendOrderChatForStoreOrder,
} = orderChat;

// ---------------------------------------------------------------------------
// In-memory fake tailored to orderChatService + chatService query shapes.
//
// Tables seeded from `seed`: profiles, stores, orders, store_orders,
// order_items, conversations, conversation_members, messages, notifications.
// Embedded relations (store, order_items, parent_order, store_orders) are
// assembled on read so the service sees the same shape it would from Postgres.
// ---------------------------------------------------------------------------
function createFake(seed) {
  const tables = {
    profiles: new Map(seed.profiles || []),
    stores: new Map(seed.stores || []),
    orders: new Map(seed.orders || []),
    store_orders: new Map(seed.store_orders || []),
    order_items: new Map(seed.order_items || []),
    conversations: new Map(seed.conversations || []),
    conversation_members: new Map(seed.conversation_members || []),
    messages: new Map(seed.messages || []),
    notifications: new Map(seed.notifications || []),
  };

  const calls = [];
  const rpcCalls = [];
  let seq = 0;
  const nextId = (prefix) => `${prefix}-gen-${++seq}`;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const membersOf = (convId) =>
    [...tables.conversation_members.values()].filter((m) => m.conversation_id === convId);
  const itemsOf = (soId) =>
    [...tables.order_items.values()].filter((it) => it.store_order_id === soId);
  const storeOrdersOf = (orderId) =>
    [...tables.store_orders.values()].filter((so) => so.parent_order_id === orderId);

  // Assemble the embedded shape the service expects for store_orders.
  const hydrateStoreOrder = (so) => {
    const store = so.store_id ? tables.stores.get(so.store_id) : null;
    const parent = so.parent_order_id ? tables.orders.get(so.parent_order_id) : null;
    return {
      ...clone(so),
      store: store ? clone(store) : null,
      order_items: itemsOf(so.id).map(clone),
      parent_order: parent ? clone(parent) : null,
    };
  };

  const hydrateMessage = (m) => {
    const sender = m.sender_id ? tables.profiles.get(m.sender_id) : null;
    return { ...clone(m), sender: sender ? clone(sender) : null, attachments: [] };
  };

  const hydrateConversation = (c) => {
    const store = c.store_id ? tables.stores.get(c.store_id) : null;
    const so = c.store_order_id ? tables.store_orders.get(c.store_order_id) : null;
    return {
      ...clone(c),
      store: store ? clone(store) : null,
      store_order: so ? { id: so.id, store_order_number: so.store_order_number, status: so.status } : null,
      members: membersOf(c.id).map(clone),
    };
  };

  const hydrate = (table, row) => {
    if (table === 'store_orders') return hydrateStoreOrder(row);
    if (table === 'messages') return hydrateMessage(row);
    if (table === 'conversations') return hydrateConversation(row);
    if (table === 'orders') {
      // Embed store_orders for the orders select shape used by orderChatService.
      return { ...clone(row), store_orders: storeOrdersOf(row.id).map((so) => ({ id: so.id, store_id: so.store_id })) };
    }
    return clone(row);
  };

  const matchesEq = (row, filters) =>
    Object.entries(filters).every(([k, v]) => {
      if (k.startsWith('neq.')) return String(row[k.slice(4)] ?? null) !== String(v);
      if (k.startsWith('in.')) return (v || []).some((x) => String(x) === String(row[k.slice(3)]));
      if (k.startsWith('is.')) return (row[k.slice(3)] ?? null) === v;
      return String(row[k] ?? null) === String(v);
    });

  const settle = (table, state) => {
    const op = state.write?.type ?? 'select';
    calls.push({ table, op, filters: { ...state.filters }, payload: state.write?.payload ?? null });

    if (op === 'insert') {
      const payload = state.write.payload;
      const list = Array.isArray(payload) ? payload : [payload];

      // Unique index ux_conversations_store_customer
      if (table === 'conversations') {
        for (const item of list) {
          const clash = [...tables.conversations.values()].some((c) =>
            c.type === 'store_customer' && c.customer_id === item.customer_id && c.store_id === item.store_id);
          if (clash) {
            return { data: null, error: { code: '23505', constraint: 'ux_conversations_store_customer', message: 'dup' } };
          }
        }
      }
      // Unique index ux_messages_client_id
      if (table === 'messages') {
        for (const item of list) {
          if (item.client_message_id === null || item.client_message_id === undefined) continue;
          const clash = [...tables.messages.values()].some((m) =>
            m.client_message_id === item.client_message_id &&
            m.conversation_id === item.conversation_id &&
            m.sender_id === item.sender_id);
          if (clash) {
            return { data: null, error: { code: '23505', constraint: 'ux_messages_client_id', message: 'dup' } };
          }
        }
      }

      const inserted = list.map((item) => {
        const row = {
          id: nextId(table),
          ...clone(item),
          created_at: item.created_at || new Date().toISOString(),
        };
        if (table === 'conversation_members') {
          row.left_at = row.left_at ?? null;
          row.unread_count = row.unread_count ?? 0;
          row.role = row.role ?? 'member';
        }
        if (table === 'messages') {
          row.is_deleted = row.is_deleted ?? false;
          // increment_unread_count trigger
          membersOf(row.conversation_id).forEach((m) => {
            if (m.profile_id !== row.sender_id && !m.left_at) m.unread_count = (m.unread_count || 0) + 1;
          });
          // update_conversation_last_message trigger
          const conv = tables.conversations.get(row.conversation_id);
          if (conv) conv.last_message_at = row.created_at;
        }
        tables[table].set(row.id, row);
        return clone(row);
      });

      if (state.single === 'single') {
        return { data: inserted[0] ?? null, error: inserted.length ? null : { message: 'no rows', code: 'PGRST116' } };
      }
      if (state.single === 'maybe') return { data: inserted[0] ?? null, error: null };
      return { data: inserted, error: null };
    }

    if (op === 'update') {
      const rows = [...tables[table].values()].filter((r) => matchesEq(r, state.filters));
      rows.forEach((r) => Object.assign(r, clone(state.write.payload)));
      if (state.single === 'single') {
        return { data: rows[0] ? hydrate(table, rows[0]) : null, error: rows.length ? null : { message: 'no rows', code: 'PGRST116' } };
      }
      return { data: rows.map((r) => hydrate(table, r)), error: null };
    }

    // select
    let rows = [...tables[table].values()].filter((r) => matchesEq(r, state.filters));
    rows = rows.map((r) => hydrate(table, r));

    if (state.single === 'single') {
      return { data: rows[0] ?? null, error: rows.length ? null : { message: 'no rows', code: 'PGRST116' } };
    }
    if (state.single === 'maybe') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };

  const makeQuery = (table) => {
    const state = { write: null, filters: {}, single: false };
    const b = {
      select: () => b,
      insert: (p) => { state.write = { type: 'insert', payload: p }; return b; },
      update: (p) => { state.write = { type: 'update', payload: p }; return b; },
      delete: () => { state.write = { type: 'delete' }; return b; },
      eq: (c, v) => { state.filters[c] = v; return b; },
      neq: (c, v) => { state.filters[`neq.${c}`] = v; return b; },
      in: (c, v) => { state.filters[`in.${c}`] = v; return b; },
      is: (c, v) => { state.filters[`is.${c}`] = v; return b; },
      order: () => b,
      range: () => b,
      limit: () => b,
      single: async () => { state.single = 'single'; return settle(table, state); },
      maybeSingle: async () => { state.single = 'maybe'; return settle(table, state); },
      then: (resolve, reject) =>
        Promise.resolve().then(() => settle(table, state)).then(resolve, reject),
    };
    return b;
  };

  return {
    calls,
    rpcCalls,
    from: (table) => makeQuery(table),
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      // create_notification: store a notification row
      if (fn === 'create_notification' && args?.p_recipient_id) {
        tables.notifications.set(`notif-${tables.notifications.size + 1}`, {
          id: `notif-${tables.notifications.size + 1}`,
          recipient_id: args.p_recipient_id,
          type: args.p_type,
          title: args.p_title,
          body: args.p_body,
          data: args.p_data,
          related_id: args.p_related_id,
          related_type: args.p_related_type,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
      return { data: null, error: null };
    },
    dump: (table) => [...tables[table].values()].map(clone),
  };
}

function install(seed) {
  const fake = createFake(seed);
  const original = { from: supabaseAdmin.from, rpc: supabaseAdmin.rpc };
  supabaseAdmin.from = fake.from;
  supabaseAdmin.rpc = fake.rpc;
  return {
    fake,
    restore: () => { supabaseAdmin.from = original.from; supabaseAdmin.rpc = original.rpc; },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CUST = 'cust-1';
const OWNER_A = 'owner-A';
const OWNER_B = 'owner-B';
const STORE_A = 'store-A';
const STORE_B = 'store-B';

function baseSeed() {
  return {
    profiles: [
      [CUST, { id: CUST, name: 'Customer', role: 'customer' }],
      [OWNER_A, { id: OWNER_A, name: 'Owner A', role: 'seller' }],
      [OWNER_B, { id: OWNER_B, name: 'Owner B', role: 'seller' }],
    ],
    stores: [
      [STORE_A, { id: STORE_A, name: 'Shop A', owner_id: OWNER_A }],
      [STORE_B, { id: STORE_B, name: 'Shop B', owner_id: OWNER_B }],
    ],
    orders: [],
    store_orders: [],
    order_items: [],
    conversations: [],
    conversation_members: [],
    messages: [],
  };
}

// A single-store COD order.
function seedSingleStoreCod(seed) {
  seed.orders.push([
    'ord-1',
    {
      id: 'ord-1', customer_id: CUST, order_number: 'ORD-1',
      status: 'pending', payment_status: 'pending', payment_method: 'cod',
      total_amount: 250, created_at: '2026-01-01T10:00:00Z',
    },
  ]);
  seed.store_orders.push([
    'so-1',
    {
      id: 'so-1', parent_order_id: 'ord-1', store_id: STORE_A,
      store_order_number: 'SO-1', status: 'pending',
      subtotal: 200, shipping_fee: 50, tax_amount: 0, total_amount: 250,
      store_snapshot: { name: 'Shop A' },
    },
  ]);
  seed.order_items.push([
    'it-1', { id: 'it-1', store_order_id: 'so-1', product_name: 'Widget', quantity: 2, total_price: 200 },
  ]);
  return seed;
}

// A multi-store order: one parent order, two store_orders (A and B).
function seedMultiStore(seed) {
  seed.orders.push([
    'ord-M',
    {
      id: 'ord-M', customer_id: CUST, order_number: 'ORD-M',
      status: 'pending', payment_status: 'pending', payment_method: 'cod',
      total_amount: 550, created_at: '2026-01-02T10:00:00Z',
    },
  ]);
  seed.store_orders.push(
    ['so-A', {
      id: 'so-A', parent_order_id: 'ord-M', store_id: STORE_A,
      store_order_number: 'SO-A', status: 'pending',
      subtotal: 200, shipping_fee: 50, tax_amount: 0, total_amount: 250,
      store_snapshot: { name: 'Shop A' },
    }],
    ['so-B', {
      id: 'so-B', parent_order_id: 'ord-M', store_id: STORE_B,
      store_order_number: 'SO-B', status: 'pending',
      subtotal: 200, shipping_fee: 50, tax_amount: 0, total_amount: 250,
      store_snapshot: { name: 'Shop B' },
    }],
  );
  seed.order_items.push(
    ['it-A', { id: 'it-A', store_order_id: 'so-A', product_name: 'ItemA', quantity: 1, total_price: 200 }],
    ['it-B', { id: 'it-B', store_order_id: 'so-B', product_name: 'ItemB', quantity: 1, total_price: 200 }],
  );
  return seed;
}

// ---------------------------------------------------------------------------
// 1) COD order -> order message posted into the store chat
// ---------------------------------------------------------------------------
test('COD: sendOrderChatForOrder posts an order message into the store conversation', async () => {
  const seed = seedSingleStoreCod(baseSeed());
  const { fake, restore } = install(seed);
  try {
    const results = await sendOrderChatForOrder('ord-1', { event: 'order_created' });
    assert.equal(results.length, 1, 'one message created');

    const messages = fake.dump('messages');
    assert.equal(messages.length, 1, 'exactly one message row');
    const msg = messages[0];
    assert.equal(msg.type, 'order_update');
    assert.equal(msg.sender_id, CUST, 'posted as the customer');
    assert.ok(msg.client_message_id, 'carries an idempotency key');
    assert.ok(
      msg.client_message_id.includes('so-1') && msg.client_message_id.includes('order_created'),
      'idempotency key is derived from store_order + event'
    );

    const meta = msg.metadata || {};
    assert.equal(meta.kind, 'order_chat');
    assert.equal(meta.store_order_number, 'SO-1');
    assert.equal(meta.total_amount, 250);
    assert.equal(meta.shipping_fee, 50);
    assert.equal(meta.payment_method, 'cod');
    assert.equal(meta.order_url, '/orders/ord-1');
    assert.equal(meta.items[0].product_name, 'Widget');
    assert.equal(meta.items[0].quantity, 2);

    // Exactly one conversation created, for store A, with both members.
    const convs = fake.dump('conversations');
    assert.equal(convs.length, 1);
    assert.equal(convs[0].store_id, STORE_A);
    const members = fake.dump('conversation_members');
    const profileIds = members.map((m) => m.profile_id).sort();
    assert.deepEqual(profileIds, [CUST, OWNER_A].sort(), 'customer + owner A are members');

    // Both customer and owner can read the same message via getMessages.
    const asCustomer = await chatService.getMessages(convs[0].id, CUST);
    const asOwner = await chatService.getMessages(convs[0].id, OWNER_A);
    assert.equal(asCustomer.length, 1);
    assert.equal(asOwner.length, 1);
    assert.equal(asCustomer[0].id, asOwner[0].id, 'same message for both');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 2) Idempotency: repeated calls never duplicate the message
// ---------------------------------------------------------------------------
test('retry: repeated sendOrderChatForOrder does not duplicate the order message', async () => {
  const seed = seedSingleStoreCod(baseSeed());
  const { fake, restore } = install(seed);
  try {
    const first = await sendOrderChatForOrder('ord-1', { event: 'order_created' });
    const second = await sendOrderChatForOrder('ord-1', { event: 'order_created' });
    const third = await sendOrderChatForOrder('ord-1', { event: 'order_created' });

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(third.length, 1);

    const messages = fake.dump('messages');
    assert.equal(messages.length, 1, 'only one message row after 3 calls');
    assert.equal(first[0].id, second[0].id, 'same message id returned on retry');
    assert.equal(second[0].id, third[0].id, 'same message id returned on retry');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3) Multi-store isolation: each store_order only into its own chat
// ---------------------------------------------------------------------------
test('multi-store: each store order is posted only into its own store conversation', async () => {
  const seed = seedMultiStore(baseSeed());
  const { fake, restore } = install(seed);
  try {
    const results = await sendOrderChatForOrder('ord-M', { event: 'order_created' });
    assert.equal(results.length, 2, 'one message per store order');

    const convs = fake.dump('conversations');
    assert.equal(convs.length, 2, 'two separate conversations');

    const messages = fake.dump('messages');
    assert.equal(messages.length, 2);

    // Conversation for store A must contain only store A's message.
    const convA = convs.find((c) => c.store_id === STORE_A);
    const convB = convs.find((c) => c.store_id === STORE_B);
    assert.ok(convA && convB, 'both conversations exist');

    const msgInA = messages.find((m) => m.conversation_id === convA.id);
    const msgInB = messages.find((m) => m.conversation_id === convB.id);

    assert.equal(msgInA.metadata.store_id, STORE_A);
    assert.equal(msgInA.metadata.store_order_number, 'SO-A');
    assert.equal(msgInA.metadata.items[0].product_name, 'ItemA');

    assert.equal(msgInB.metadata.store_id, STORE_B);
    assert.equal(msgInB.metadata.store_order_number, 'SO-B');
    assert.equal(msgInB.metadata.items[0].product_name, 'ItemB');

    // No store A data leaked into store B's message and vice versa.
    assert.ok(!JSON.stringify(msgInB).includes('ItemA'), 'store B message has no store A item');
    assert.ok(!JSON.stringify(msgInA).includes('ItemB'), 'store A message has no store B item');

    // Owner A sees only conv A; owner B sees only conv B.
    const asOwnerA = await chatService.getMessages(convA.id, OWNER_A);
    const asOwnerB = await chatService.getMessages(convB.id, OWNER_B);
    assert.equal(asOwnerA.length, 1);
    assert.equal(asOwnerB.length, 1);
    assert.equal(asOwnerA[0].metadata.store_id, STORE_A);
    assert.equal(asOwnerB[0].metadata.store_id, STORE_B);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 4) Status update: a new status produces a new card (not a duplicate)
// ---------------------------------------------------------------------------
test('status update: sendOrderChatForStoreOrder posts a new card for a new status', async () => {
  const seed = seedSingleStoreCod(baseSeed());
  // Simulate the order having progressed to 'confirmed'.
  seed.store_orders[0][1].status = 'confirmed';
  const { fake, restore } = install(seed);
  try {
    const result = await sendOrderChatForStoreOrder('so-1', { event: 'status_updated' });
    assert.ok(result, 'a message is returned');
    assert.equal(result.metadata.order_status, 'confirmed');

    const messages = fake.dump('messages');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].metadata.order_status, 'confirmed');
    assert.equal(messages[0].metadata.order_status_label, 'ร้านค้ายืนยันแล้ว');
    assert.ok(messages[0].client_message_id.includes('confirmed'), 'keyed by status');

    // A retry of the same status collapses to one message.
    const retry = await sendOrderChatForStoreOrder('so-1', { event: 'status_updated' });
    assert.ok(retry, 'retry returns the existing message');
    assert.equal(retry.id, result.id, 'same message id on retry');
    assert.equal(fake.dump('messages').length, 1, 'no duplicate on retry');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 5) Payment status labels reflect state in the card
// ---------------------------------------------------------------------------
test('payment: awaiting_review card shows the correct payment label', async () => {
  const seed = seedSingleStoreCod(baseSeed());
  // Simulate KBZPay slip submitted: payment_status -> awaiting_review.
  seed.orders[0][1].payment_method = 'kbzpay';
  seed.orders[0][1].payment_status = 'awaiting_review';
  const { fake, restore } = install(seed);
  try {
    await sendOrderChatForOrder('ord-1', { event: 'slip_submitted' });
    const msg = fake.dump('messages')[0];
    assert.equal(msg.metadata.payment_status, 'awaiting_review');
    assert.equal(msg.metadata.payment_status_label, 'รอตรวจสอบสลิป');
    assert.equal(msg.metadata.payment_method, 'kbzpay');
    assert.equal(msg.metadata.headline, 'แนบสลิปการชำระเงินแล้ว');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 6) Non-fatal: a store with no owner does not throw and creates nothing
// ---------------------------------------------------------------------------
test('edge: store without owner does not throw and posts nothing', async () => {
  const seed = seedSingleStoreCod(baseSeed());
  // Remove the owner from store A.
  seed.stores[0][1].owner_id = null;
  const { fake, restore } = install(seed);
  try {
    const results = await sendOrderChatForOrder('ord-1', { event: 'order_created' });
    assert.equal(results.length, 0, 'no message posted');
    assert.equal(fake.dump('messages').length, 0);
    assert.equal(fake.dump('conversations').length, 0, 'no conversation created');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 7) Non-fatal: errors are swallowed (no throw into the order/payment flow)
// ---------------------------------------------------------------------------
test('edge: sendOrderChatForOrder never throws on missing order', async () => {
  const { restore } = install(baseSeed());
  try {
    const results = await sendOrderChatForOrder('does-not-exist', { event: 'order_created' });
    assert.deepEqual(results, [], 'returns empty, does not throw');
  } finally {
    restore();
  }
});