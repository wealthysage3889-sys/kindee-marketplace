// Supabase Storage object URLs (both signed and public forms) embed the bucket
// name and the object path:
//   signed: https://<host>/storage/v1/object/sign/<bucket>/<path>?token=...
//   public: https://<host>/storage/v1/object/public/<bucket>/<path>
//
// Chat attachments live in the PRIVATE `chat-attachments` bucket and are
// persisted in the DB as signed URLs that expire (default 1 hour). Once expired
// the stored URL returns 400/403, so the image no longer loads. Extracting the
// { bucket, path } pair lets the client request a fresh signed URL on demand
// (via GET/POST /upload/signed-url) WITHOUT changing where or how files are
// stored.
// Parse a Supabase Storage object URL into its { bucket, path } parts WITHOUT
// normalising the path. Both public and signed forms embed the bucket and the
// object key:
//   signed: https://<host>/storage/v1/object/sign/<bucket>/<path>?token=...
//   public: https://<host>/storage/v1/object/public/<bucket>/<path>
// The returned `path` is the raw key segment (query stripped, percent-decoded)
// and MAY still carry a duplicated bucket prefix (legacy rows). Keeping a single
// parser here means duplicate-detection and path-normalisation can never drift.
function parseStorageUrl(url) {
  if (!url || typeof url !== "string") return null;

  const match = url.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
  if (!match) return null;

  const bucket = match[1];
  let objectPath = match[2];

  // Strip the query string (the signed-URL token) — it is not part of the path.
  const queryIndex = objectPath.indexOf("?");
  if (queryIndex !== -1) objectPath = objectPath.slice(0, queryIndex);

  // The path segment in a URL is percent-encoded; decode it back to the raw
  // object key expected by the Storage API.
  try {
    objectPath = decodeURIComponent(objectPath);
  } catch {
    // If it cannot be decoded, keep the raw (still-encoded) segment.
  }

  return { bucket, path: objectPath };
}

export function extractStorageObjectPath(url) {
  const parsed = parseStorageUrl(url);
  if (!parsed) return null;

  const { bucket } = parsed;
  let objectPath = parsed.path;

  // Normalize away any duplicated leading bucket prefix so callers never send
  // `chat-attachments/chat-attachments/...` to the Storage API. Idempotent:
  // strips every leading `${bucket}/` so it is safe to call repeatedly.
  const prefix = `${bucket}/`;
  while (objectPath.startsWith(prefix)) objectPath = objectPath.slice(prefix.length);

  if (!bucket || !objectPath) return null;
  return { bucket, path: objectPath };
}

// True when the URL points at a Supabase Storage object (so it is a candidate
// for refresh) rather than an external/arbitrary URL.
export function isSupabaseStorageUrl(url) {
  return extractStorageObjectPath(url) !== null;
}

// Supabase signs storage URLs with a JWT in the `token` query parameter. The
// payload carries `exp` (seconds since epoch). Reading it lets the client
// refresh an expired URL BEFORE rendering it, avoiding a guaranteed failed
// image request and a visible broken-image flash.
// True when the URL carries the bucket name more than once in its object path
// (legacy / malformed), so it must be refreshed via a signed URL instead of
// being rendered directly.
export function hasDuplicatedBucketPrefix(url) {
  const parsed = parseStorageUrl(url);
  if (!parsed) return false;
  return parsed.path.startsWith(`${parsed.bucket}/`);
}

export function getSignedUrlExpiryMs(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token");
    if (!token) return null;
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = JSON.parse(decodeBase64(padded));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function decodeBase64(value) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// True only when the URL is a Supabase signed URL whose token is already
// expired (or expires within 30 seconds). Non-signed URLs and signed URLs
// without a readable exp are left alone; the normal <img> onError fallback
// still handles those.
export function isSignedUrlExpired(url, now = Date.now()) {
  const exp = getSignedUrlExpiryMs(url);
  if (exp === null) return false;
  return exp <= now + 30_000;
}