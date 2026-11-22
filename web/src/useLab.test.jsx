import { describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLab } from "./useLab.js";
import { createTestApi } from "./testLab.js";

async function boot(opts) {
  const t = createTestApi(opts);
  const h = renderHook(() => useLab({ api: t.api }));
  await waitFor(() => expect(h.result.current.boot).toBe("ready"));
  return { ...t, h, lab: () => h.result.current };
}

describe("useLab", () => {
  test("loads /api/info and the session, and picks the first door", async () => {
    const { lab, calls } = await boot();
    expect(lab().info.source).toBe("mock");
    expect(lab().door).toBe("demo-all-tools");
    expect(lab().info.doors.map((d) => d.id)).toEqual(["demo-all-tools", "demo-some-tools", "demo-blocked"]);
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(["/api/info", "/api/session", "/api/auth/config"]));
  });

  test("a failing /api/info is a named boot error, and reload recovers", async () => {
    let fail = true;
    const t = createTestApi({ hooks: { "/api/info": () => { if (fail) throw Object.assign(new Error("lab server could not be reached"), { code: "unreachable" }); } } });
    const r = renderHook(() => useLab({ api: t.api }));
    await waitFor(() => expect(r.result.current.boot).toBe("error"));
    expect(r.result.current.bootError.message).toMatch(/could not be reached/);
    fail = false;
    await act(async () => { await r.result.current.reload(); });
    expect(r.result.current.boot).toBe("ready");
  });

  test("discover on demo-some-tools lists only the 7 granted tools; a refused call by name does not drop the list", async () => {
    const { lab } = await boot();
    act(() => lab().chooseDoor("demo-some-tools"));
    await act(async () => { await lab().discover(); });
    expect(lab().hasTools).toBe(true);
    expect(lab().discovery.tools).toHaveLength(7);
    await act(async () => { await lab().callTool("sensitive_tax_record"); });
    expect(lab().lastRun.verdict.id).toBe("blocked");
    expect(lab().hasTools).toBe(true);
    expect(lab().discovery.verdict.id).toBe("allowed");
  });

  test("demo-blocked: discovery is Blocked by policy and there is no tool list", async () => {
    const { lab } = await boot();
    act(() => lab().chooseDoor("demo-blocked"));
    await act(async () => { await lab().discover(); });
    expect(lab().lastRun.verdict.word).toBe("Blocked by policy");
    expect(lab().hasTools).toBe(false);
  });

  test("changing door clears the runs and the selection", async () => {
    const { lab } = await boot();
    await act(async () => { await lab().discover(); });
    act(() => lab().setSelectedTool("who_has_role"));
    expect(lab().lastRun).not.toBeNull();
    act(() => lab().chooseDoor("demo-blocked"));
    expect(lab().lastRun).toBeNull();
    expect(lab().discovery).toBeNull();
    expect(lab().selectedTool).toBeNull();
  });

  test("an answer that arrives after a door switch is dropped (a slow call never paints over the new door)", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { lab } = await boot({ hooks: { "/api/discover": async () => { await gate; } } });
    let pending;
    act(() => { pending = lab().discover(); });
    await waitFor(() => expect(lab().busy).not.toBeNull());
    act(() => lab().chooseDoor("demo-blocked"));
    expect(lab().busy).toBeNull();
    release();
    await act(async () => { await pending; });
    expect(lab().lastRun).toBeNull();
    expect(lab().door).toBe("demo-blocked");
  });

  test("a second action while one is running is ignored", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { lab, calls } = await boot({ hooks: { "/api/discover": async () => { await gate; } } });
    let first;
    act(() => { first = lab().discover(); });
    await waitFor(() => expect(lab().busy).not.toBeNull());
    let second;
    await act(async () => { second = await lab().discover(); });
    expect(second).toBeNull();
    release();
    await act(async () => { await first; });
    expect(calls.filter((c) => c.path === "/api/discover")).toHaveLength(1);
  });

  test("arguments that are not a JSON object never leave the page; valid ones are sent as typed", async () => {
    const { lab, calls } = await boot();
    act(() => lab().setArgs("who_has_role", "{broken"));
    await act(async () => { await lab().callTool("who_has_role"); });
    expect(calls.some((c) => c.path === "/api/call")).toBe(false);
    act(() => lab().setArgs("who_has_role", '{"role": "Treasury Approver"}'));
    await act(async () => { await lab().callTool("who_has_role"); });
    expect(calls.find((c) => c.path === "/api/call").body).toEqual({ door: "demo-all-tools", tool: "who_has_role", arguments: { role: "Treasury Approver" } });
    expect(lab().lastRun.verdict.id).toBe("allowed");
  });

  test("a missing required argument is a Bad request, not an Upstream error", async () => {
    const { lab } = await boot();
    await act(async () => { await lab().callTool("who_has_role", {}); });
    expect(lab().lastRun.verdict.word).toBe("Bad request");
  });

  test("scenarios go to the server; repeat can override the scenario before React re-renders", async () => {
    const { lab, calls } = await boot();
    act(() => lab().setScenario("no-key"));
    await act(async () => { await lab().discover(); });
    expect(lab().lastRun.verdict.id).toBe("needs-sign-in");
    expect(calls.at(-1).body.scenario).toBe("no-key");
    await act(async () => { await lab().repeat("none"); });
    expect(calls.at(-1).body.scenario).toBeUndefined();
    expect(lab().lastRun.verdict.id).toBe("allowed");
  });

  test("mode: Real not configured answers 409, the page stays in Mock and keeps its runs; Mock to Mock-free switch reloads", async () => {
    const { lab } = await boot();
    await act(async () => { await lab().discover(); });
    let ok;
    await act(async () => { ok = await lab().setMode("real"); });
    expect(ok).toBe(false);
    expect(lab().modeError.status).toBe(409);
    expect(lab().info.source).toBe("mock");
    expect(lab().lastRun).not.toBeNull();
  });

  test("mode: both directions reload the data when Real is configured", async () => {
    const stub = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "demo-all-tools", PGC_GW_KEY_DEMO_ALL_TOOLS: "test-only-key" };
    const { lab, calls } = await boot({ env: stub });
    await act(async () => { await lab().discover(); });
    await act(async () => { await lab().setMode("real"); });
    expect(lab().info.source).toBe("real");
    expect(lab().lastRun).toBeNull();
    expect(lab().info.doors.map((d) => d.id)).toEqual(["demo-all-tools"]);
    expect(lab().scenario).toBe("none");
    await act(async () => { await lab().setMode("mock"); });
    expect(lab().info.source).toBe("mock");
    expect(lab().info.doors).toHaveLength(3);
    expect(calls.filter((c) => c.path === "/api/info").length).toBeGreaterThanOrEqual(3);
  });

  test("reset clears the runs and the typed arguments but keeps the mode", async () => {
    const { lab, calls } = await boot();
    act(() => lab().setArgs("who_has_role", '{"role":"x"}'));
    await act(async () => { await lab().discover(); });
    await act(async () => { await lab().reset(); });
    expect(calls.some((c) => c.path === "/api/reset" && c.method === "POST")).toBe(true);
    expect(lab().lastRun).toBeNull();
    expect(lab().argsFor("who_has_role")).toContain("prod-db-admin");
    expect(lab().info.source).toBe("mock");
  });

  test("a request this lab cannot complete is a failure, not a verdict, and Try again repeats it", async () => {
    let fail = true;
    const { lab } = await boot({ hooks: { "/api/discover": () => { if (fail) throw Object.assign(new Error("lab server could not be reached"), { status: 0, code: "unreachable" }); } } });
    await act(async () => { await lab().discover(); });
    expect(lab().failure.code).toBe("unreachable");
    expect(lab().lastRun).toBeNull();
    fail = false;
    await act(async () => { await lab().repeat(); });
    expect(lab().failure).toBeNull();
    expect(lab().lastRun.verdict.id).toBe("allowed");
  });

  test("Mock sign-in and sign-out go through the server and reload the session", async () => {
    const { lab } = await boot();
    expect(lab().me).toBeNull();
    await act(async () => { await lab().signInMock("demouser"); });
    expect(lab().me.name).toBe("demouser");
    expect(lab().me.expiresAt).toBeTruthy();
    await act(async () => { await lab().signOut(); });
    expect(lab().me).toBeNull();
  });
});
