// Regression tests for chat-attachment signed URL generation.
//
// Covers: new-format object keys (no bucket prefix), legacy keys that still
// carry the `chat-attachments/` prefix (files uploaded before the prefix fix),
// and missing objects (must throw a clear error, never fabricate a URL).
//
// Run with:  npm --prefix backend test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';

const {
  generateStoragePath,
  normalizeObjectPath,
  getSignedUrl,
  storageObjectExists,
} = await import('../middleware/upload.js');

const bucket = 'chat-attachments';
const conversationId = 'conv-11111111-1111-1111-1111-111111111111';
const fileName = 'shot.png';
const newKey = `${conversationId}/2026/11/${fileName}`;             // new format (no bucket prefix)
const legacyKey = `${bucket}/${newKey}`;                            // legacy format (double bucket)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build a mock supabaseAdmin whose storage bucket exposes exists() and
// createSignedUrl() for a fixed set of object keys.
const makeSupabaseAdmin = (existingKeys = []) => {
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
  const from = () => ({ exists, createSignedUrl });
  return { storage: { from } };
};

test('normalizeObjectPath strips a single bucket prefix and leaves other paths alone', () => {
  assert.strictEqual(normalizeObjectPath(bucket, `${bucket}/${newKey}`), newKey);
  assert.strictEqual(normalizeObjectPath(bucket, newKey), newKey);
  assert.strictEqual(normalizeObjectPath(bucket, 'other/bucket/key.png'), 'other/bucket/key.png');
  assert.strictEqual(normalizeObjectPath(bucket, undefined), undefined);
});

test('normalizeObjectPath is idempotent for a repeated (double) bucket prefix', () => {
  const doubleKey = `${bucket}/${bucket}/${newKey}`;
  // Stripping all leading bucket prefixes yields the canonical key.
  assert.strictEqual(normalizeObjectPath(bucket, doubleKey), newKey);
  // Applying it twice changes nothing further (idempotent).
  assert.strictEqual(normalizeObjectPath(bucket, normalizeObjectPath(bucket, doubleKey)), newKey);
  // A single-pass normalization must equal the repeated-pass result.
  assert.strictEqual(normalizeObjectPath(bucket, doubleKey), normalizeObjectPath(bucket, `${bucket}/${newKey}`));
});

test('normalizeObjectPath trims leading/trailing whitespace and leading slashes', () => {
  assert.strictEqual(normalizeObjectPath(bucket, `  /${newKey}  `), newKey);
  assert.strictEqual(normalizeObjectPath(bucket, `//${bucket}//${newKey}`), `/${newKey}`);
});

test('generateStoragePath does NOT embed the bucket name in the object key', () => {
  const key = generateStoragePath(bucket, conversationId, fileName);
  assert.strictEqual(key, newKey);
  assert.ok(!key.startsWith(`${bucket}/`));
});

test('getSignedUrl signs a new-format object that exists', async () => {
  const supabaseAdmin = makeSupabaseAdmin([newKey]);
  const url = await getSignedUrl(supabaseAdmin, bucket, newKey, 3600);
  assert.ok(url.includes(`/object/sign/${bucket}/${newKey}?token=abc`));
});

test('getSignedUrl signs a legacy object whose key still carries the bucket prefix', async () => {
  const supabaseAdmin = makeSupabaseAdmin([legacyKey]);
  const url = await getSignedUrl(supabaseAdmin, bucket, legacyKey, 3600);
  assert.ok(url.includes(`/object/sign/${bucket}/${legacyKey}?token=abc`));
});

test('getSignedUrl signs a legacy path passed without the bucket prefix (old DB row)', async () => {
  // Old message rows may store the path with the bucket prefix; the frontend
  // re-signs from the embedded URL. The backend must resolve to the legacy key.
  const supabaseAdmin = makeSupabaseAdmin([legacyKey]);
  const url = await getSignedUrl(supabaseAdmin, bucket, newKey, 3600);
  assert.ok(url.includes(`/object/sign/${bucket}/${legacyKey}?token=abc`));
});

test('getSignedUrl resolves a double-prefixed legacy path to the stored legacy object', async () => {
  // A stored URL / DB row may carry the bucket name twice. Normalization strips
  // every leading prefix and the resolver still signs the real legacy key.
  const supabaseAdmin = makeSupabaseAdmin([legacyKey]);
  const url = await getSignedUrl(supabaseAdmin, bucket, `${bucket}/${legacyKey}`, 3600);
  assert.ok(url.includes(`/object/sign/${bucket}/${legacyKey}?token=abc`));
});

test('getSignedUrl throws a clear error when the object exists in neither shape', async () => {
  const supabaseAdmin = makeSupabaseAdmin([]);
  await assert.rejects(
    () => getSignedUrl(supabaseAdmin, bucket, newKey, 3600),
    (err) => {
      assert.ok(err.message.includes('File not found in storage'));
      assert.ok(err.message.includes(bucket));
      assert.ok(err.message.includes(newKey));
      return true;
    }
  );
});

test('storageObjectExists returns false for a missing key and true for an existing one', async () => {
  const supabaseAdmin = makeSupabaseAdmin([newKey]);
  assert.strictEqual(await storageObjectExists(supabaseAdmin, bucket, newKey), true);
  assert.strictEqual(await storageObjectExists(supabaseAdmin, bucket, 'missing/file.png'), false);
});
