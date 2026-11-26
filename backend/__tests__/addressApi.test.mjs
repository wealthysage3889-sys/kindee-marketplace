import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin, supabaseAuth } = await import('../config/supabase.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const addressRoutes = (await import('../routes/addressRoutes.js')).default;
const { errorHandler } = await import('../middleware/errorHandler.js');

const customerId = '11111111-1111-4111-8111-111111111111';
const outsiderId = '22222222-2222-4222-8222-222222222222';
const newUserId = '33333333-3333-4333-8333-333333333333';

const customerToken = 'customer-address-token';
const outsiderToken = 'outsider-address-token';
const newUserToken = 'new-user-address-token';

const primaryAddressId = 'aaaaaaaa-0000-4000-8000-000000000001';
const secondaryAddressId = 'aaaaaaaa-0000-4000-8000-000000000002';
const outsiderAddressId = 'bbbbbbbb-0000-4000-8000-000000000001';

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const address = (overrides = {}) => ({
  label: 'บ้าน',
  recipient_name: 'ลูกค้า',
  phone: '0978929968',
  street: '99/1 ถนนสุขุมวิท',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postal_code: '10110',
  lat: 13.7563,
  lng: 100.5018,
  is_default: false,
  created_at: iso(-100000),
  updated_at: iso(-100000),
  ...overrides,
});

function makeSeed() {
  return {
    profiles: [
      [customerId, { id: customerId, name: 'ลูกค้า', email: 'customer@example.com', role: 'customer', is_active: true }],
      [outsiderId, { id: outsiderId, name: 'คนนอก', email: 'outsider@example.com', role: 'customer', is_active: true }],
      [newUserId, { id: newUserId, name: 'ผู้ใช้ใหม่', email: 'new@example.com', role: 'customer', is_active: true }],
    ],
    profile_addresses: [
      [primaryAddressId, address({ id: primaryAddressId, profile_id: customerId, is_default: true })],
      [secondaryAddressId, address({
        id: secondaryAddressId,
        profile_id: customerId,
        label: 'ที่ทำงาน',
        recipient_name: 'ลูกค้าที่ทำงาน',
        is_default: false,
        created_at: iso(-50000),
        updated_at: iso(-50000),
      })],
      [outsiderAddressId, address({ id: outsiderAddressId, profile_id: outsiderId, label: 'ของคนนอก' })],
    ],
  };
}

const app = express();
app.use(express.json());
app.use('/api/addresses', addressRoutes);
app.use(errorHandler);

let server;
let baseUrl;
let restoreFake;
let currentFake;

before(async () => {
  supabaseAuth.auth.getUser = async (token) => {
    if (token === customerToken) return { data: { user: { id: customerId } }, error: null };
    if (token === outsiderToken) return { data: { user: { id: outsiderId } }, error: null };
    if (token === newUserToken) return { data: { user: { id: newUserId } }, error: null };
    return { data: { user: null }, error: { message: 'Invalid token' } };
  };

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/api/addresses`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  const installed = installFakeSupabase(supabaseAdmin, makeSeed());
  currentFake = installed.fake;
  restoreFake = installed.restore;
});

afterEach(() => {
  if (restoreFake) restoreFake();
  restoreFake = null;
});

async function api(path = '', { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const validPayload = {
  label: 'บ้านใหม่',
  recipient_name: 'ผู้รับใหม่',
  phone: '081-234-5678',
  street: '123/4 ถนนรามอินทรา',
  district: 'สะพานสอง',
  province: 'กรุงเทพมหานคร',
  postal_code: '10210',
  lat: 13.8,
  lng: 100.6,
  is_default: false,
};

test('a request without a token is rejected with 401', async () => {
  const { status } = await api('');
  assert.equal(status, 401);
});

test('customer only receives its own addresses', async () => {
  const { status, data } = await api('', { token: customerToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.data));
  assert.deepEqual(
    data.data.map((row) => row.id).sort(),
    [primaryAddressId, secondaryAddressId].sort()
  );
  assert.ok(data.data.every((row) => row.profile_id === customerId));
});

test('customer can create an address with a normalized Thai phone', async () => {
  const { status, data } = await api('', {
    token: customerToken,
    method: 'POST',
    body: validPayload,
  });

  assert.equal(status, 201);
  assert.equal(data.data.profile_id, customerId);
  assert.equal(data.data.phone, '+66812345678');
  assert.equal(data.data.is_default, false);
});

test('the first address for a profile becomes the default', async () => {
  const { status, data } = await api('', {
    token: newUserToken,
    method: 'POST',
    body: {
      ...validPayload,
      label: 'บ้านแรก',
      recipient_name: 'ผู้ใช้ใหม่',
      phone: '0812345678',
    },
  });

  assert.equal(status, 201);
  assert.equal(data.data.profile_id, newUserId);
  assert.equal(data.data.is_default, true);
});

test('create rejects an invalid phone without writing a row', async () => {
  const { status, data } = await api('', {
    token: customerToken,
    method: 'POST',
    body: { ...validPayload, phone: '123' },
  });

  assert.equal(status, 400);
  assert.match(data.message, /phone/i);
  assert.ok(!currentFake.calls.some((call) => call.table === 'profile_addresses' && call.op === 'insert'));
});

test('create accepts an address without a map pin', async () => {
  const { status, data } = await api('', {
    token: newUserToken,
    method: 'POST',
    body: {
      ...validPayload,
      label: 'บ้านไม่มีหมุด',
      recipient_name: 'ผู้ใช้ใหม่',
      phone: '0812345678',
      lat: null,
      lng: null,
    },
  });

  assert.equal(status, 201);
  assert.equal(data.data.lat, null);
  assert.equal(data.data.lng, null);
});

test('customer can update its own address', async () => {
  const { status, data } = await api(`/${primaryAddressId}`, {
    token: customerToken,
    method: 'PUT',
    body: {
      label: 'บ้านหลัก',
      recipient_name: 'ผู้แก้ไข',
      is_default: true,
    },
  });

  assert.equal(status, 200);
  assert.equal(data.data.label, 'บ้านหลัก');
  assert.equal(data.data.recipient_name, 'ผู้แก้ไข');
});

test('a customer cannot update another customer address', async () => {
  const { status } = await api(`/${outsiderAddressId}`, {
    token: customerToken,
    method: 'PUT',
    body: { label: 'hack' },
  });

  assert.equal(status, 404);
});

test('a customer cannot delete another customer address', async () => {
  const { status } = await api(`/${outsiderAddressId}`, {
    token: customerToken,
    method: 'DELETE',
  });

  assert.equal(status, 404);
});

test('deleting the default promotes the next saved address', async () => {
  const { status } = await api(`/${primaryAddressId}`, {
    token: customerToken,
    method: 'DELETE',
  });

  assert.equal(status, 200);
  const secondary = currentFake
    .dump('profile_addresses')
    .find((row) => row.id === secondaryAddressId);
  assert.equal(secondary.is_default, true);
});

test('setting a default address is owner scoped', async () => {
  const denied = await api(`/${outsiderAddressId}/default`, {
    token: customerToken,
    method: 'POST',
  });
  assert.equal(denied.status, 404);

  const { status, data } = await api(`/${secondaryAddressId}/default`, {
    token: customerToken,
    method: 'POST',
  });
  assert.equal(status, 200);
  assert.equal(data.data.is_default, true);
});