// Tests for the approximate IP geolocation service.
//
// The service is privacy-sensitive: it must stay disabled unless BOTH env flags
// are set, it must never trust forwarding headers by default, it must reject
// private/reserved addresses, it must never expose the raw IP, and it must never
// be used as a routing/delivery destination (that behavior is enforced in the UI
// and route service, and the response here is clearly marked approximate).
//
// Run with:  npm --prefix backend test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin } = await import('../config/supabase.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const ipLocation = await import('../services/ipLocationService.js');

const {
  resolveTrustProxy,
  getClientIp,
  isPublicIp,
  isIpGeolocationEnabled,
  recordCustomerIp,
  getRecordedCustomerIp,
  lookupIpApproximate,
  getConversationIpLocation,
  __resetIpLocationState,
} = ipLocation;

const ENV_KEYS = [
  'TRUST_PROXY',
  'IP_GEOLOCATION_ENABLED',
  'IP_GEOLOCATION_CONSENT',
  'IP_GEOLOCATION_PROVIDER',
  'IP_GEOLOCATION_TTL_MS',
];

const clearEnv = () => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
};

const enableIpGeolocation = () => {
  process.env.IP_GEOLOCATION_ENABLED = 'true';
  process.env.IP_GEOLOCATION_CONSENT = 'acknowledged';
  process.env.IP_GEOLOCATION_PROVIDER = 'ipwhois';
};

const customerId = 'cust-11111111-1111-1111-1111-111111111111';
const ownerId = 'own-22222222-2222-2222-2222-222222222222';
const outsiderId = 'out-33333333-3333-3333-3333-333333333333';
const conversationId = 'conv-55555555-5555-5555-5555-555555555555';

const makeSeed = () => ({
  profiles: [
    [customerId, { id: customerId, name: 'customer', role: 'customer' }],
    [ownerId, { id: ownerId, name: 'owner', role: 'seller' }],
    [outsiderId, { id: outsiderId, name: 'outsider', role: 'customer' }],
  ],
  conversations: [
    [
      conversationId,
      {
        id: conversationId,
        type: 'store_customer',
        store_id: 'store-1',
        customer_id: customerId,
      },
    ],
  ],
  conversation_members: [
    [
      'm-1',
      { id: 'm-1', conversation_id: conversationId, profile_id: customerId, role: 'member', left_at: null },
    ],
    [
      'm-2',
      { id: 'm-2', conversation_id: conversationId, profile_id: ownerId, role: 'admin', left_at: null },
    ],
  ],
});

const fakeFetchOk = (overrides = {}) => {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        success: true,
        country: 'Thailand',
        country_code: 'TH',
        region: 'Bangkok',
        city: 'Bangkok',
        latitude: 13.7563,
        longitude: 100.5018,
        accuracy_radius: 25,
        security: { vpn: false, proxy: false, hosting: false },
        connection: { type: 'mobile' },
        ...overrides,
      }),
    };
  };
  return { impl, calls };
};

test.beforeEach(() => {
  clearEnv();
  __resetIpLocationState();
});

test.after(() => {
  clearEnv();
  __resetIpLocationState();
});

// ---------------------------------------------------------------------------
// TRUST_PROXY
// ---------------------------------------------------------------------------

test('resolveTrustProxy defaults to false when unset or empty', () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(''), false);
  assert.equal(resolveTrustProxy('   '), false);
  assert.equal(resolveTrustProxy('false'), false);
});

test('resolveTrustProxy parses boolean, hop counts and CIDR lists', () => {
  assert.equal(resolveTrustProxy('true'), 1);
  assert.equal(resolveTrustProxy('2'), 2);
  assert.equal(resolveTrustProxy('0'), 0);
  assert.equal(resolveTrustProxy('10.0.0.0/8,172.16.0.0/12'), '10.0.0.0/8,172.16.0.0/12');
});

// ---------------------------------------------------------------------------
// IP extraction & validation
// ---------------------------------------------------------------------------

test('getClientIp uses req.ip and ignores spoofable X-Forwarded-For', () => {
  const req = {
    ip: '8.8.8.8',
    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(getClientIp(req), '8.8.8.8');
});

test('getClientIp strips IPv4-mapped IPv6 prefixes and brackets', () => {
  assert.equal(getClientIp({ ip: '::ffff:9.9.9.9' }), '9.9.9.9');
  assert.equal(getClientIp({ ip: '[2001:4860::8888]' }), '2001:4860::8888');
  assert.equal(getClientIp({}), '');
});

test('isPublicIp rejects private, CGNAT, loopback and reserved ranges', () => {
  [
    '10.1.2.3',
    '172.16.5.4',
    '192.168.1.10',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    'not-an-ip',
    '',
  ].forEach((ip) => assert.equal(isPublicIp(ip), false, `${ip} must be rejected`));

  ['8.8.8.8', '1.1.1.1', '2001:4860::8888', '::ffff:9.9.9.9'].forEach((ip) =>
    assert.equal(isPublicIp(ip), true, `${ip} must be accepted`)
  );
});

// ---------------------------------------------------------------------------
// Individual recording
// ---------------------------------------------------------------------------

test('IP recording is disabled unless both enable and consent flags are set', () => {
  assert.equal(isIpGeolocationEnabled(), false);
  assert.equal(recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8' }), false);
  assert.equal(getRecordedCustomerIp(customerId), null);

  process.env.IP_GEOLOCATION_ENABLED = 'true';
  assert.equal(isIpGeolocationEnabled(), false);
  assert.equal(recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8' }), false);

  process.env.IP_GEOLOCATION_CONSENT = 'acknowledged';
  assert.equal(isIpGeolocationEnabled(), true);
});

test('IP recording only accepts customer role and public addresses', () => {
  enableIpGeolocation();

  assert.equal(recordCustomerIp({ profileId: ownerId, role: 'seller', ip: '8.8.8.8' }), false);
  assert.equal(recordCustomerIp({ profileId: customerId, role: 'customer', ip: '192.168.0.5' }), false);
  assert.equal(getRecordedCustomerIp(customerId), null);

  assert.equal(recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8' }), true);
  const entry = getRecordedCustomerIp(customerId);
  assert.equal(entry.ip, '8.8.8.8');
});

test('recorded IPs expire after the configured TTL', () => {
  enableIpGeolocation();
  process.env.IP_GEOLOCATION_TTL_MS = '60000';
  const now = 1_000_000;
  recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8', now });

  assert.ok(getRecordedCustomerIp(customerId, now + 59_999));
  assert.equal(getRecordedCustomerIp(customerId, now + 60_001), null);
});

// ---------------------------------------------------------------------------
// Provider lookup
// ---------------------------------------------------------------------------

test('lookupIpApproximate reports disabled by default', async () => {
  const result = await lookupIpApproximate('8.8.8.8', { fetchImpl: fakeFetchOk().impl });
  assert.deepEqual(result, { available: false, reason: 'disabled' });
});

test('lookupIpApproximate validates IP and provider configuration', async () => {
  enableIpGeolocation();

  assert.equal((await lookupIpApproximate('')).reason, 'missing_ip');
  assert.equal((await lookupIpApproximate('10.0.0.1')).reason, 'private_or_reserved_ip');

  process.env.IP_GEOLOCATION_PROVIDER = 'none';
  assert.equal((await lookupIpApproximate('8.8.8.8')).reason, 'provider_not_configured');

  process.env.IP_GEOLOCATION_PROVIDER = 'some-unknown';
  assert.equal((await lookupIpApproximate('8.8.8.8')).reason, 'provider_not_supported');
});

test('lookupIpApproximate returns coarse coordinates and never the raw IP', async () => {
  enableIpGeolocation();
  const { impl, calls } = fakeFetchOk();

  const result = await lookupIpApproximate('8.8.8.8', { fetchImpl: impl });

  assert.equal(result.available, true);
  assert.equal(result.approximate, true);
  assert.equal(result.source, 'ip');
  assert.equal(result.city, 'Bangkok');
  assert.equal(result.country_code, 'TH');
  assert.equal(result.latitude, 13.7563);
  assert.equal(result.longitude, 100.5018);
  assert.equal(result.accuracy_radius_km, 25);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(result).includes('8.8.8.8'), 'response must not echo the IP');
});

test('lookupIpApproximate caches successful results per IP', async () => {
  enableIpGeolocation();
  const { impl, calls } = fakeFetchOk();

  await lookupIpApproximate('8.8.8.8', { fetchImpl: impl });
  await lookupIpApproximate('8.8.8.8', { fetchImpl: impl });

  assert.equal(calls.length, 1);
});

test('lookupIpApproximate handles provider failures and empty data', async () => {
  enableIpGeolocation();

  const httpFailure = await lookupIpApproximate('8.8.8.8', {
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.equal(httpFailure.reason, 'provider_error');

  __resetIpLocationState();
  const noData = await lookupIpApproximate('8.8.8.9', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) }),
  });
  assert.equal(noData.reason, 'provider_no_data');

  __resetIpLocationState();
  const thrower = await lookupIpApproximate('8.8.8.10', {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(thrower.reason, 'provider_error');
});

// ---------------------------------------------------------------------------
// Conversation-level lookup
// ---------------------------------------------------------------------------

test('getConversationIpLocation is disabled by default', async () => {
  const { restore } = installFakeSupabase(supabaseAdmin, makeSeed());
  try {
    const result = await getConversationIpLocation(conversationId, ownerId);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(result.source, 'ip');
  } finally {
    restore();
  }
});

test('getConversationIpLocation reports missing recent IP', async () => {
  enableIpGeolocation();
  const { restore } = installFakeSupabase(supabaseAdmin, makeSeed());
  try {
    const result = await getConversationIpLocation(conversationId, ownerId);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'no_recent_customer_location');
  } finally {
    restore();
  }
});

test('getConversationIpLocation resolves the customer IP for a member', async () => {
  enableIpGeolocation();
  const { fake, restore } = installFakeSupabase(supabaseAdmin, makeSeed());
  try {
    recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8' });
    const { impl } = fakeFetchOk();

    const result = await getConversationIpLocation(conversationId, ownerId, { fetchImpl: impl });

    assert.equal(result.available, true);
    assert.equal(result.conversation_id, conversationId);
    assert.equal(result.city, 'Bangkok');
    assert.ok(result.observed_at);
    assert.ok(!JSON.stringify(result).includes('8.8.8.8'), 'response must not echo the IP');
    assert.deepEqual(fake.calls.filter((c) => c.op !== 'select'), []);
  } finally {
    restore();
  }
});

test('getConversationIpLocation rejects non-members before any lookup', async () => {
  enableIpGeolocation();
  const { restore } = installFakeSupabase(supabaseAdmin, makeSeed());
  try {
    recordCustomerIp({ profileId: customerId, role: 'customer', ip: '8.8.8.8' });
    await assert.rejects(
      () => getConversationIpLocation(conversationId, outsiderId, { fetchImpl: fakeFetchOk().impl }),
      (err) => err.statusCode === 403 || err.status === 403
    );
  } finally {
    restore();
  }
});
