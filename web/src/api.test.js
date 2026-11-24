import { afterEach, describe, expect, test, vi } from "vitest";
import { api, apiPrefix, redirectSignInUrl } from "./api.js";

afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, "", "/"); });

describe("API paths behind the lab-proxy", () => {
  test("the lab's own path prefix is kept, and nothing else is ever added", () => {
    expect(apiPrefix("/")).toBe("");
    expect(apiPrefix("/index.html")).toBe("");
    expect(apiPrefix("/privilege-gateway-client")).toBe("/privilege-gateway-client");
    expect(apiPrefix("/privilege-gateway-client/")).toBe("/privilege-gateway-client");
    expect(apiPrefix("/privilege-gateway-client/anything")).toBe("/privilege-gateway-client");
    expect(apiPrefix("/other-lab/")).toBe("");
    expect(apiPrefix("/privilege-gateway-client-evil/")).toBe("");
  });

  test("a page served at the proxy path calls /privilege-gateway-client/api/..., so a changed lab cookie cannot send it to another lab", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/privilege-gateway-client/");
    await api("/api/auth/live/start", { method: "POST", body: {} });
    expect(fetchMock.mock.calls[0][0]).toBe("/privilege-gateway-client/api/auth/live/start");
  });

  test("a page served at the root (http://127.0.0.1:7833) still calls /api/...", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/");
    await api("/api/info");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/info");
  });
});

describe("redirectSignInUrl (hosted redirect sign-in)", () => {
  test("goes through the lab's proxy prefix and returns to the page it started from", () => {
    expect(redirectSignInUrl("/privilege-gateway-client/")).toBe("/privilege-gateway-client/api/auth/redirect/start?return=%2Fprivilege-gateway-client%2F");
    expect(redirectSignInUrl("/")).toBe("/api/auth/redirect/start?return=%2F");
  });
});

