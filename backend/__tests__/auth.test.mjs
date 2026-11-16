// Unit tests for the auth service session rules (Phase 2A).
//
// These never touch the network: the Supabase client's DB surface is replaced
// with the in-memory fake (./helpers/fakeSupabase.mjs) and the Auth surface
// (supabase.auth.* / supabaseAdmin.auth.admin.*) is replaced with small fakes.
// They prove the rules that Phase 2A must hold:
//   - register/login return Supabase access_token + refresh_token (never custom JWT)
//   - login rejects deactivated accounts
//   - refresh rotates a Supabase session, and falls back to the legacy custom
//     JWT path only for legacy tokens
//   - logout revokes sessions through the admin API
//   - social login with an existing email on another account is rejected (409)
//   - Facebook server-side verification rejects an invalid token
//
// Run with:  npm --prefix backend test
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin, supabaseAuth } = await import('../config/supabase.js');
const authService = await import('../services/authService.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');

// ---------------------------------------------------------------------------
// Fakes for the Supabase Auth surface
// ---------------------------------------------------------------------------

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Track created users so we can assert on admin calls.
function makeAuthFake({ passwordByEmail = {}, usersById = {} } = {}) {
  const signOutCalls = [];
  const updateCalls = [];
  const createdUsers = [];

  const admin = {
    createUser: async ({ email, phone, password, email_confirm, user_metadata }) => {
      const id = UUID(createdUsers.length + 1);
      const user = { id, email, phone, email_confirm, user_metadata };
      createdUsers.push(user);
      usersById[id] = user;
      passwordByEmail[email || `phone:${phone}`] = password;
      return { data: { user }, error: null };
    },
    updateUserById: async (id, updates) => {
      updateCalls.push({ id, updates });
      return { data: { user: { id } }, error: null };
    },
    deleteUser: async () => ({ data: { user: null }, error: null }),
    getUserById: async (id) => ({ data: { user: usersById[id] || null }, error: null }),
    signOut: async (jwt, scope) => { signOutCalls.push({ jwt, scope }); return { data: {}, error: null }; }
  };

  const goTrue = {
    signInWithPassword: async ({ email, phone, password }) => {
      const key = email || `phone:${phone}`;
      if (passwordByEmail[key] === password) {
        return {
          data: {
            session: {
              access_token: `access-for-${email || phone}`,
              refresh_token: `refresh-for-${email || phone}`,
              user: { id: Object.keys(usersById).find((id) => usersById[id].email === email) || 'anon' }
            },
            user: {}
          },
          error: null
        };
      }
      return { data: { session: null }, error: { message: 'Invalid login credentials' } };
    },
    refreshSession: async ({ refresh_token }) => {
      if (refresh_token === 'good-refresh') {
        return {
          data: {
            session: {
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              user: { id: UUID(1) }
            }
          },
          error: null
        };
      }
      return { data: { session: null }, error: { message: 'Invalid refresh token' } };
    },
    signInWithIdToken: async () => ({ data: { session: null, user: null }, error: { message: 'unsupported' } }),
    signOut: async () => ({ data: {}, error: null })
  };

  return {
    admin,
    goTrue,
    createdUsers,
    signOutCalls,
    updateCalls,
    install(target) {
      const original = target.auth;
      target.auth = { admin, ...goTrue };
      return () => { target.auth = original; };
    }
  };
}

function freshClients() {
  // Ensure a clean fake DB per test.
  const install = installFakeSupabase(supabaseAdmin, { profiles: [] });
  const auth = makeAuthFake();
  const restoreAdminAuth = auth.install(supabaseAdmin);
  // supabaseAuth is used by middleware; for service tests we drive supabase.auth
  const restoreAuth = auth.install(supabaseAuth);
  return {
    auth,
    fake: install.fake,
    restore() {
      restoreAdminAuth();
      restoreAuth();
      install.restore();
    }
  };
}

// The service imports `supabase` (anon) and `supabaseAdmin`. supabaseAuth is the
// same object reference used by the service when anon key is present.
const supabase = supabaseAuth;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {});

test('registerUser returns Supabase session tokens (no custom JWT)', async () => {
  const env = freshClients();
  try {
    const result = await authService.registerUser({
      email: 'new@example.com',
      password: 'secret123',
      name: 'New User',
      role: 'customer'
    });

    assert.equal(result.accessToken, 'access-for-new@example.com');
    assert.equal(result.refreshToken, 'refresh-for-new@example.com');
    assert.equal(result.user.email, 'new@example.com');
    assert.ok(!result.accessToken.startsWith('eyJ'), 'access token must be Supabase, not a custom JWT');
  } finally {
    env.restore();
  }
});

test('loginUser rejects deactivated account (403)', async () => {
  const env = freshClients();
  try {
    await env.fake.from('profiles').insert({
      id: UUID(1), email: 'inactive@example.com', phone: null, role: 'customer', is_active: false
    });

    await assert.rejects(
      () => authService.loginUser('inactive@example.com', 'whatever'),
      (err) => err.statusCode === 403 && /deactivated/i.test(err.message)
    );
  } finally {
    env.restore();
  }
});

test('loginUser returns Supabase session tokens on valid credentials', async () => {
  const env = freshClients();
  try {
    await env.fake.from('profiles').insert({
      id: UUID(2), email: 'active@example.com', phone: null, role: 'customer', is_active: true
    });
    // Password recognized by the fake.
    env.auth.admin.createUser({ email: 'active@example.com', password: 'pw', email_confirm: true, user_metadata: {} });

    const result = await authService.loginUser('active@example.com', 'pw');
    assert.equal(result.accessToken, 'access-for-active@example.com');
    assert.equal(result.refreshToken, 'refresh-for-active@example.com');
  } finally {
    env.restore();
  }
});

test('refreshAccessToken rotates a Supabase session', async () => {
  const env = freshClients();
  try {
    await env.fake.from('profiles').insert({
      id: UUID(1), email: 'user@example.com', phone: null, role: 'customer', is_active: true
    });
    const result = await authService.refreshAccessToken('good-refresh');
    assert.equal(result.accessToken, 'new-access');
    assert.equal(result.refreshToken, 'new-refresh');
  } finally {
    env.restore();
  }
});

test('refreshAccessToken keeps a legacy custom JWT on the legacy path (no password rotation)', async () => {
  const env = freshClients();
  try {
    await env.fake.from('profiles').insert({
      id: UUID(1), email: 'legacy@example.com', phone: null, role: 'customer', is_active: true
    });
    const legacy = jwt.sign({ id: UUID(1), type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // The legacy path must NOT touch the password.
    let updateCalled = false;
    env.auth.admin.updateUserById = async () => { updateCalled = true; return { data: { user: null }, error: null }; };

    const result = await authService.refreshAccessToken(legacy);
    assert.ok(result.accessToken.startsWith('eyJ'), 'legacy refresh returns a legacy JWT');
    assert.equal(updateCalled, false, 'legacy refresh must not rotate the account password');
  } finally {
    env.restore();
  }
});

test('logoutUser revokes sessions via admin signOut passing the ACCESS TOKEN (JWT), not a userId', async () => {
  const env = freshClients();
  try {
    const jwtToken = 'user-access-token-jwt';
    await authService.logoutUser(jwtToken, 'some-refresh');
    // admin.signOut(jwt, scope) requires the user's JWT; default scope is 'local'.
    assert.deepEqual(env.auth.signOutCalls, [{ jwt: jwtToken, scope: 'local' }]);
  } finally {
    env.restore();
  }
});

test('logoutUser honors global scope to revoke every device', async () => {
  const env = freshClients();
  try {
    const jwtToken = 'user-access-token-jwt';
    await authService.logoutUser(jwtToken, 'some-refresh', 'global');
    assert.deepEqual(env.auth.signOutCalls, [{ jwt: jwtToken, scope: 'global' }]);
  } finally {
    env.restore();
  }
});

test('logoutUser falls back without throwing when no access token is available', async () => {
  const env = freshClients();
  try {
    // No Supabase access token -> must NOT call admin.signOut(userId); resolves ok.
    const result = await authService.logoutUser(undefined, 'some-refresh');
    assert.deepEqual(env.auth.signOutCalls, []);
    assert.equal(result.success, true);
  } finally {
    env.restore();
  }
});

test('deactivateAccount sets is_active=false and revokes all sessions via ban_duration', async () => {
  const env = freshClients();
  try {
    await env.fake.from('profiles').insert({
      id: UUID(1), email: 'user@example.com', phone: null, role: 'customer', is_active: true
    });

    await authService.deactivateAccount(UUID(1));

    const row = env.fake.dump('profiles').find((p) => p.id === UUID(1));
    assert.equal(row.is_active, false, 'profile must be deactivated');

    // Revocation is by userId via ban_duration (admin.signOut cannot take a userId).
    const banCall = env.auth.updateCalls.find(
      (c) => c.id === UUID(1) && c.updates && c.updates.ban_duration
    );
    assert.ok(banCall, 'deactivate must revoke sessions with ban_duration');
    assert.equal(banCall.updates.ban_duration, '876000h');
  } finally {
    env.restore();
  }
});

test('socialLogin rejects duplicate email on another account (409, no auto-link)', async () => {
  const env = freshClients();
  try {
    // Existing account owns the email; provider identity does not exist yet.
    await env.fake.from('profiles').insert({
      id: UUID(9), email: 'taken@example.com', phone: null, role: 'customer', is_active: true
    });
    process.env.FACEBOOK_APP_ID = 'fb-app';
    process.env.FACEBOOK_APP_SECRET = 'fb-secret';

    // Fake Facebook Graph API responses.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('debug_token')) {
        return { ok: true, json: async () => ({ data: { is_valid: true, app_id: 'fb-app' } }) };
      }
      if (String(url).includes('/me?')) {
        return { ok: true, json: async () => ({ id: 'fb-123', name: 'FB User', email: 'taken@example.com' }) };
      }
      return { ok: false, json: async () => ({}) };
    };
    try {
      await assert.rejects(
        () => authService.socialLogin('facebook', 'fb-access-token'),
        (err) => err.statusCode === 409 && /already registered/i.test(err.message)
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    env.restore();
  }
});

test('socialLogin rejects an invalid Facebook token (401)', async () => {
  const env = freshClients();
  try {
    process.env.FACEBOOK_APP_ID = 'fb-app';
    process.env.FACEBOOK_APP_SECRET = 'fb-secret';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('debug_token')) {
        return { ok: true, json: async () => ({ data: { is_valid: false, app_id: 'fb-app' } }) };
      }
      return { ok: false, json: async () => ({}) };
    };
    try {
      await assert.rejects(
        () => authService.socialLogin('facebook', 'bad-token'),
        (err) => err.statusCode === 401
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    env.restore();
  }
});

// ---------------------------------------------------------------------------
// LINE login
// ---------------------------------------------------------------------------

function mockLineFetch({ tokenResponse, verifyResponse, profileResponse }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes('oauth2/v2.1/token')) {
      return { ok: true, json: async () => tokenResponse };
    }
    if (u.includes('oauth2/v2.1/verify')) {
      return { ok: true, json: async () => verifyResponse };
    }
    if (u.includes('/v2/profile')) {
      return { ok: true, json: async () => profileResponse };
    }
    return { ok: false, json: async () => ({}) };
  };
  return () => { globalThis.fetch = original; };
}

test('lineLogin verifies iss/aud and rejects a wrong issuer (401)', async () => {
  const env = freshClients();
  try {
    process.env.LINE_CHANNEL_ID = 'line-channel';
    process.env.LINE_CHANNEL_SECRET = 'line-secret';

    const restoreFetch = mockLineFetch({
      tokenResponse: { access_token: 'line-access', id_token: 'line-id-token' },
      verifyResponse: { iss: 'https://evil.example', aud: 'line-channel', sub: 'U123', exp: 9999999999 }
    });
    try {
      await assert.rejects(
        () => authService.lineLogin('code', 'https://app.example/login'),
        (err) => err.statusCode === 401 && /issuer/i.test(err.message)
      );
    } finally {
      restoreFetch();
    }
  } finally {
    env.restore();
  }
});

test('lineLogin rejects when LINE is not configured (403)', async () => {
  const env = freshClients();
  try {
    delete process.env.LINE_CHANNEL_ID;
    delete process.env.LINE_CHANNEL_SECRET;
    // No settings row -> disabled.
    await assert.rejects(
      () => authService.lineLogin('code', 'https://app.example/login'),
      (err) => err.statusCode === 403
    );
  } finally {
    env.restore();
  }
});