import { describe, it, expect, beforeEach, vi } from "vitest";
import { request } from "./auth.js";

function fakeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function headersOfCall(fetchMock, n) {
  const init = fetchMock.mock.calls[n]?.[1];
  return new Headers(init?.headers);
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn();
});

describe("auth.request() HTTP status handling", () => {
  it("200 OK: returns parsed body without retrying", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: { ok: true } }));

    const res = await request("/widgets");

    expect(res).toEqual({ data: { ok: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toBe("/api/widgets");
  });

  it("200 OK: does NOT send Cache-Control or Pragma on the first request", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));

    await request("/widgets");

    const h = headersOfCall(globalThis.fetch, 0);
    expect(h.get("Cache-Control")).toBeNull();
    expect(h.get("Pragma")).toBeNull();
  });

  it("401 Unauthorized: throws with status 401 and does not retry (no refresh in auth.js)", async () => {
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" }));

    await expect(request("/protected")).rejects.toMatchObject({
      message: "unauthorized",
      status: 401,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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

  it("Network failure (TypeError): maps to 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'", async () => {
    globalThis.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(request("/widgets")).rejects.toThrow("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
  });
});

describe("auth.request() 304 Not Modified handling", () => {
  it("304 then 200: retries exactly once with Cache-Control: no-store and returns data", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(200, { data: { fresh: true } }));

    const res = await request("/widgets");

    expect(res).toEqual({ data: { fresh: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const first = headersOfCall(globalThis.fetch, 0);
    expect(first.get("Cache-Control")).toBeNull();
    expect(first.get("Pragma")).toBeNull();

    const retry = headersOfCall(globalThis.fetch, 1);
    expect(retry.get("Cache-Control")).toBe("no-store");
    expect(retry.get("Pragma")).toBe("no-cache");
  });

  it("304 then 200: retry preserves the Authorization header", async () => {
    localStorage.setItem("kindee:admin:token", "tok-abc");
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(200, { data: "ok" }));

    await request("/me", {}, "admin");

    const retryAuth = headersOfCall(globalThis.fetch, 1).get("Authorization");
    expect(retryAuth).toBe("Bearer tok-abc");
  });

  it("persistent 304: never loops forever (exactly 2 fetches) and throws status 304", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(304, {}));

    await expect(request("/stuck")).rejects.toMatchObject({ status: 304 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(headersOfCall(globalThis.fetch, 1).get("Cache-Control")).toBe("no-store");
  });

  it("304 then 401: throws status 401 (no token refresh in auth.js)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(fakeResponse(304, {}))
      .mockResolvedValueOnce(fakeResponse(401, { message: "unauthorized" }));

    await expect(request("/protected")).rejects.toMatchObject({
      message: "unauthorized",
      status: 401,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("auth.request() header / FormData behaviour", () => {
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

  it("request() is exported as apiRequest alias", async () => {
    const { apiRequest } = await import("./auth.js");
    globalThis.fetch.mockResolvedValueOnce(fakeResponse(200, { data: 1 }));
    const res = await apiRequest("/alias");
    expect(res).toEqual({ data: 1 });
  });
});
