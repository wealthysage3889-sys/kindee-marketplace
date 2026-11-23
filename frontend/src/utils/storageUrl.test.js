import { describe, it, expect } from "vitest";
import { extractStorageObjectPath, isSupabaseStorageUrl } from "./storageUrl";

describe("extractStorageObjectPath", () => {
  it("extracts bucket and path from a signed URL (legacy format with double bucket prefix)", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "chat-attachments/conv-1/2026/11/chat-1.png",
    });
  });

  it("extracts bucket and path from a URL whose path repeats the bucket name twice", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    // The bucket is the first segment; everything after it is the (legacy,
    // possibly multi-prefixed) object path the backend will normalize.
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "chat-attachments/chat-attachments/conv-1/2026/11/chat-1.png",
    });
  });

  it("extracts bucket and path from a signed URL (new format without double bucket)", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat-1.png?token=abc123";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/chat-1.png",
    });
  });

  it("extracts bucket and path from a public URL", () => {
    const url =
      "https://test.supabase.co/storage/v1/object/public/chat-attachments/conv-1/2026/11/pic.png";
    expect(extractStorageObjectPath(url)).toEqual({
      bucket: "chat-attachments",
      path: "conv-1/2026/11/pic.png",
    });
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