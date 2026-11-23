// Tests for signPaymentSlipUrl path normalization.
//
// Root cause: signPaymentSlipUrl() passed the raw stored object key directly to
// createSignedUrl(). The Supabase SDK prepends the bucket id itself, so a stored
// key like `payment-slips/<orderId>/file.jpg` was signed as
// `payment-slips/payment-slips/<orderId>/file.jpg` — a double-prefixed key that
// does not exist in the bucket. The fix routes through getSignedUrl() from
// upload.js, which normalizes the key (strips the bucket prefix) before signing.
//
// Run with:  npm --prefix backend test

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin } = await import('../config/supabase.js');
const { signPaymentSlipUrl } = await import('../services/orderService.js');

const bucket = 'payment-slips';
const orderId = 'order-1';
const canonicalKey = `${orderId}/2026/11/slip.jpg`;                  // new format (no bucket prefix)
const prefixedKey = `${bucket}/${canonicalKey}`;                     // stored in DB (legacy/multi-order flow)
const doublePrefixedKey = `${bucket}/${prefixedKey}`;                // double-prefixed (worst case)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Install a mock storage layer on the real supabaseAdmin for the duration of
// the test. Mirrors the pattern used by payment-slip.test.mjs and
// multi-order-slip.test.mjs.
function installStorageFake(existingKeys = []) {
  const original = { storage: supabaseAdmin.storage };
  const exists = async (path) => ({
    data: existingKeys.includes(path),
    error: existingKeys.includes(path) ? null : { code: 'NoSuchKey', status: 404, message: 'NoSuchKey' },
  });
  const createSignedUrl = async (path) => {
    if (!existingKeys.includes(path)) {
      return { data: null, error: { message: 'Object not found' } };
    }
    return { data: { signedUrl: `https://dummy.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc` } };
  };
  supabaseAdmin.storage = { from: () => ({ exists, createSignedUrl }) };
  return { restore: () => { supabaseAdmin.storage = original.storage; } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('signPaymentSlipUrl signs a canonical key (no bucket prefix)', async () => {
  const { restore } = installStorageFake([canonicalKey]);
  try {
    const url = await signPaymentSlipUrl(canonicalKey);
    assert.ok(url, 'should return a signed URL');
    assert.ok(url.includes(`/object/sign/${bucket}/${canonicalKey}?token=abc`));
  } finally {
    restore();
  }
});

test('signPaymentSlipUrl strips the bucket prefix before signing (prefixed key)', async () => {
  // The DB stores `payment-slips/<orderId>/...` — the SDK would double-prefix
  // without normalization. The signed URL must target the canonical key.
  const { restore } = installStorageFake([canonicalKey]);
  try {
    const url = await signPaymentSlipUrl(prefixedKey);
    assert.ok(url, 'should return a signed URL for the prefixed key');
    assert.ok(url.includes(`/object/sign/${bucket}/${canonicalKey}?token=abc`));
  } finally {
    restore();
  }
});

test('signPaymentSlipUrl strips repeated bucket prefixes (double-prefixed key)', async () => {
  const { restore } = installStorageFake([canonicalKey]);
  try {
    const url = await signPaymentSlipUrl(doublePrefixedKey);
    assert.ok(url, 'should return a signed URL for the double-prefixed key');
    assert.ok(url.includes(`/object/sign/${bucket}/${canonicalKey}?token=abc`));
  } finally {
    restore();
  }
});

test('signPaymentSlipUrl resolves a legacy-prefixed key to the canonical object', async () => {
  // Old DB rows may store the path with the bucket prefix; the backend must
  // resolve to the canonical key and sign that, never fabricate a URL.
  const { restore } = installStorageFake([canonicalKey]);
  try {
    const url = await signPaymentSlipUrl(prefixedKey);
    assert.ok(url);
    assert.ok(!url.includes(`${bucket}/${bucket}/`), 'signed URL must not contain a double bucket prefix');
  } finally {
    restore();
  }
});

test('signPaymentSlipUrl returns null when the object exists in neither shape', async () => {
  const { restore } = installStorageFake([]);
  try {
    const url = await signPaymentSlipUrl(canonicalKey);
    assert.strictEqual(url, null);
  } finally {
    restore();
  }
});

test('signPaymentSlipUrl returns null for empty/invalid input', async () => {
  const { restore } = installStorageFake([canonicalKey]);
  try {
    assert.strictEqual(await signPaymentSlipUrl(null), null);
    assert.strictEqual(await signPaymentSlipUrl(''), null);
    assert.strictEqual(await signPaymentSlipUrl(123), null);
  } finally {
    restore();
  }
});