import { describe, it, expect } from "vitest";
import {
  extractStorageObjectPath,
  isSupabaseStorageUrl,
  hasDuplicatedBucketPrefix,
  getSignedUrlExpiryMs,
  isSignedUrlExpired,
} from "./storageUrl";

// The single canonical standard: an object path NEVER carries the bucket name
// as its first segment. `extractStorageObjectPath` normalises every input
// (normal, single-prefixed, double-prefixed, multi-prefixed) down to the one
// key that lives *within* the bucket, so the Storage API is always called with
// exactly one correct object path.
describe("extractStorageObjectPath - normalisation to a single standard", () => {
  it("extracts bucket and path from a signed URL with a normal (un-prefixed) path", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/chat-1.png",
    });
  });

  it("extracts bucket and path from a public URL with a normal path", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/public/chat-attachments/conv-1/2026/11/pic.png";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/pic.png",
    });
  });

  it("strips a duplicated (double) bucket prefix from a signed URL", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/chat-1.png",
    });
  });

  it("strips a doubly-duplicated (triple) bucket prefix", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/chat-1.png",
    });
  });

  it("strips a duplicated bucket prefix from a public URL too", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/public/chat-attachments/chat-attachments/conv-1/2026/11/pic.png";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/pic.png",
    });
  });

  it("produces the SAME result for a normal path and a bucket-prefixed path", () => {
    const normal = extractStorageObjectPath(
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat-1.png?token=a"
    );
    const prefixed = extractStorageObjectPath(
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=b"
    );
    expect(prefixed).toEqual(normal);
  });

  it("is idempotent: re-normalising an already-normalised path changes nothing", () => {
    const legacyUrl =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=x";
    const once = extractStorageObjectPath(legacyUrl);
    // Rebuild a URL from the normalised { bucket, path } and extract again.
    const rebuilt = `https://test.supabase.co/storage/v1/object/sign/${once.bucket}/${once.path}?token=y`;
    const twice = extractStorageObjectPath(rebuilt);
    expect(twice).toEqual(once);
    expect(twice.path).toBe("conv-1/2026/11/chat-1.png");
  });

  it("decodes percent-encoded path segments", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/my%20photo.png?token=x";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/my photo.png",
    });
  });

  it("returns null for non-storage URLs", () => {
    expect(extractStorageObjectPath("https://example.com/image.png")).toBeNull();
    expect(extractStorageObjectPath("")).toBeNull();
    expect(extractStorageObjectPath(null)).toBeNull();
    expect(extractStorageObjectPath(undefined)).toBeNull();
  });

  it("isSupabaseStorageUrl matches only storage object URLs", () => {
    expect(
      isSupabaseStorageUrl(
        "https://test.supabase.co/storage/v1/object/sign/chat-attachments/a/b.png?token=x"
      )
    ).toBe(true);
    expect(isSupabaseStorageUrl("https://example.com/x.png")).toBe(false);
  });
});

describe("hasDuplicatedBucketPrefix", () => {
  it("detects a duplicated bucket prefix in a signed URL", () => {
    expect(
      hasDuplicatedBucketPrefix(
        "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=x"
      )
    ).toBe(true);
  });

  it("detects a duplicated bucket prefix in a public URL", () => {
    expect(
      hasDuplicatedBucketPrefix(
        "https://test.supabase.co/storage/v1/object/public/chat-attachments/chat-attachments/conv-1/pic.png"
      )
    ).toBe(true);
  });

  it("returns false for a normal, correctly-prefixed URL", () => {
    expect(
      hasDuplicatedBucketPrefix(
        "https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat-1.png?token=x"
      )
    ).toBe(false);
  });

  it("returns false for non-storage or empty input", () => {
    expect(hasDuplicatedBucketPrefix("https://example.com/x.png")).toBe(false);
    expect(hasDuplicatedBucketPrefix("")).toBe(false);
    expect(hasDuplicatedBucketPrefix(null)).toBe(false);
  });
});

function signedUrlWithExp(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat.png?token=header.${payload}.signature`;
}

describe("signed URL expiry", () => {
  it("reads exp from a signed URL token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(getSignedUrlExpiryMs(signedUrlWithExp(exp))).toBe(exp * 1000);
  });

  it("returns null for a URL without a token or a non-storage URL", () => {
    expect(getSignedUrlExpiryMs("https://example.com/x.png")).toBeNull();
    expect(
      getSignedUrlExpiryMs(
        "https://test.supabase.co/storage/v1/object/sign/chat-attachments/a/b.png"
      )
    ).toBeNull();
  });

  it("detects an expired signed URL", () => {
    const expired = signedUrlWithExp(Math.floor(Date.now() / 1000) - 60);
    expect(isSignedUrlExpired(expired)).toBe(true);
  });

  it("does not treat a fresh signed URL as expired", () => {
    const fresh = signedUrlWithExp(Math.floor(Date.now() / 1000) + 3600);
    expect(isSignedUrlExpired(fresh)).toBe(false);
  });

  it("treats a URL expiring within 30 seconds as expired", () => {
    const soon = signedUrlWithExp(Math.floor(Date.now() / 1000) + 10);
    expect(isSignedUrlExpired(soon)).toBe(true);
  });
});