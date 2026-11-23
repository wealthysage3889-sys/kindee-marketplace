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
export function extractStorageObjectPath(url) {
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

  if (!bucket || !objectPath) return null;
  return { bucket, path: objectPath };
}

// True when the URL points at a Supabase Storage object (so it is a candidate
// for refresh) rather than an external/arbitrary URL.
export function isSupabaseStorageUrl(url) {
  return extractStorageObjectPath(url) !== null;
}