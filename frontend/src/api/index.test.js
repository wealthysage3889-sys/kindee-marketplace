import { describe, it, expect, beforeEach, vi } from "vitest";
import { request, getToken, setToken } from "./index.js";

// Build a minimal fetch Response stand-in. The production code only reads
// `.status`, `.ok` and `.json()`, so that is all we need to emulate.
function fakeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

// Headers of the Nth fetch call (0-based) as a plain Headers object.
function headersOfCall(fetchMock, n) {
  const init = fetchMock.mock.calls[n]?.[1];
  return new Headers(init?.headers);
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn();
});

describe("request() HTTP status handling", () => {
  it("200 OK: returns parsed body without retrying", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: { ok: true } }));

    const res = await request("/widgets");

    expect(res).toEqual({ data: { ok: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toBe("/api/widgets");
  });

  it("200 OK: does NOT send Cache-Control on the first request", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));

    await request("/widgets");

    const h = headersOfCall(globalThis.fetch, 0);
    expect(h.get("Cache-Control")).toBeNull();
    expect(h.get("Pragma")).toBeNull();
  });

  it("403 Forbidden: throws with status 403 and does not retry", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(403, { message: "forbidden" }));

    await expect(request("/secret")).rejects.toMatchObject({
      message: "forbidden",
      status: 403,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("404 Not Found: throws with status 404", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(404, { message: "missing" }));

    await expect(request("/nope")).rejects.toMatchObject({
      message: "missing",
      status: 404,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("500 Server Error: throws with status 500", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(500, { message: "boom" }));

    await expect(request("/boom")).rejects.toMatchObject({
      message: "boom",
      status: 500,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("Network failure (TypeError): maps to 'Cannot connect to server'", async () => {
    globalThis.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(request("/widgets")).rejects.toThrow("Cannot connect to server");
  });
});

describe("request() 304 Not Modified handling", () => {
  it("304 then 200: retries exactly once with Cache-Control + Pragma and returns data", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {})) // first attempt -> 304
      .mockResolvedValueOnce(fakeResponse(200, { data: { fresh: true } })); // retry -> 200

    const res = await request("/widgets");

    expect(res).toEqual({ data: { fresh: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // First request must be a normal cache-validated request.
    const first = headersOfCall(globalThis.fetch, 0);
    expect(first.get("Cache-Control")).toBeNull();

    // Retry must bypass cache.
    const retry = headersOfCall(globalThis.fetch, 1);
    expect(retry.get("Cache-Control")).toBe("no-cache");
    expect(retry.get("Pragma")).toBe("no-cache");
  });

  it("304 then 200: retry preserves the Authorization header", async () => {
    setToken("tok-123", "customer");
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(200, { data: "ok" }));

    await request("/me");

    const retryAuth = headersOfCall(globalThis.fetch, 1).get("Authorization");
    expect(retryAuth).toBe("Bearer tok-123");
  });

  it("persistent 304: never loops forever (exactly 2 fetches) and throws status 304", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(304, {}));

    await expect(request("/stuck")).rejects.toMatchObject({ status: 304 });
    // One original + one no-cache retry only. No infinite loop.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // Both attempts happened; the second one carried no-cache.
    expect(headersOfCall(globalThis.fetch, 1).get("Cache-Control")).toBe("no-cache");
  });
});

describe("request() token refresh + error handling", () => {
  it("401 with valid refresh token: refreshes once and retries with the new token", async () => {
    setToken("old-token", "customer");
    localStorage.setItem("kindee:customer:refreshToken", "refresh-abc");

    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" })) // original
      .mockResolvedValueOnce(fakeResponse(200, { data: { accessToken: "new-token" } })) // refresh
      .mockResolvedValueOnce(fakeResponse(200, { data: { secret: 42 } })); // retry

    const res = await request("/protected");

    expect(res).toEqual({ data: { secret: 42 } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    // The refresh call hit /auth/refresh with the stored refresh token.
    const refreshCall = globalThis.fetch.mock.calls[1];
    expect(refreshCall[0]).toBe("/api/auth/refresh");
    expect(refreshCall[1].method).toBe("POST");
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refreshToken: "refresh-abc" });

    // The retried data call used the NEW token.
    expect(headersOfCall(globalThis.fetch, 2).get("Authorization")).toBe("Bearer new-token");
    // New token persisted.
    expect(getToken("customer")).toBe("new-token");
  });

  it("401 with failing refresh: clears tokens and rethrows the original error", async () => {
    setToken("old-token", "customer");
    localStorage.setItem("kindee:customer:refreshToken", "refresh-abc");

    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" })) // original
      .mockResolvedValueOnce(fakeResponse(400, { message: "refresh rejected" })); // refresh fails

    await expect(request("/protected")).rejects.toMatchObject({
      message: "unauthorized",
      status: 401,
    });

    // No third attempt; tokens cleared.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(getToken("customer")).toBeNull();
    expect(localStorage.getItem("kindee:customer:refreshToken")).toBeNull();
  });

  it("401 with NO token: does not attempt refresh, throws immediately", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" }));

    await expect(request("/protected")).rejects.toMatchObject({ status: 401 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("401 is only refreshed once even if the retry also returns 401", async () => {
    setToken("old-token", "customer");
    localStorage.setItem("kindee:customer:refreshToken", "refresh-abc");

    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" })) // original
      .mockResolvedValueOnce(fakeResponse(200, { data: { accessToken: "new-token" } })) // refresh
      .mockResolvedValueOnce(fakeResponse(401, { message: "still unauthorized" })); // retry 401

    await expect(request("/protected")).rejects.toMatchObject({ status: 401 });
    // original + refresh + one retry = 3 calls, never a second refresh.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("request() header / FormData behaviour", () => {
  it("JSON requests set Content-Type: application/json", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));

    await request("/things", { method: "POST", body: JSON.stringify({ a: 1 }) });

    const h = headersOfCall(globalThis.fetch, 0);
    expect(h.get("Content-Type")).toBe("application/json");
  });

  it("FormData requests do NOT set Content-Type (browser sets boundary)", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));
    const fd = new FormData();
    fd.append("file", "x");

    await request("/upload", { method: "POST", body: fd });

    const h = headersOfCall(globalThis.fetch, 0);
    expect(h.get("Content-Type")).toBeNull();
  });

  it("extra headers passed via options are forwarded", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));

    await request("/things", { headers: { "X-Custom": "abc" } });

    expect(headersOfCall(globalThis.fetch, 0).get("X-Custom")).toBe("abc");
  });
});