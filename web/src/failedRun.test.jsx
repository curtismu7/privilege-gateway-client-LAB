import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";
import { useLab } from "./useLab.js";
import { createTestApi, fetchFrom } from "./testLab.js";

// B1 (fix pass): after a good run, a run this lab cannot complete (its server killed, HTTP 502) must leave NO trace of the old run anywhere. The
// real lab core answers the first call; a failing transport answers the second.
const down = (status = 0, code = "unreachable") => () => { throw Object.assign(new Error("This lab's server could not be reached. Check that it is still running, then try again."), { status, code }); };

describe("a failed run clears the previous one (hook)", () => {
  test("lastRun and discovery are gone after a failed call, and the failure is shown instead", async () => {
    let fail = false;
    const t = createTestApi({ hooks: { "/api/call": () => { if (fail) down()(); } } });
    const h = renderHook(() => useLab({ api: t.api }));
    await waitFor(() => expect(h.result.current.boot).toBe("ready"));
    await act(async () => { await h.result.current.discover(); });
    await act(async () => { await h.result.current.callTool("who_has_role", { role: "Treasury Approver" }); });
    expect(h.result.current.lastRun.verdict.id).toBe("allowed");
    fail = true;
    await act(async () => { await h.result.current.callTool("who_has_role", { role: "Treasury Approver" }); });
    expect(h.result.current.failure.code).toBe("unreachable");
    expect(h.result.current.lastRun).toBeNull();
    expect(h.result.current.discovery).toBeNull();
    expect(h.result.current.hasTools).toBe(false);
  });

  test("a failed discover also clears the earlier discovery", async () => {
    let fail = false;
    const t = createTestApi({ hooks: { "/api/discover": () => { if (fail) down(502, "http_502")(); } } });
    const h = renderHook(() => useLab({ api: t.api }));
    await waitFor(() => expect(h.result.current.boot).toBe("ready"));
    await act(async () => { await h.result.current.discover(); });
    expect(h.result.current.hasTools).toBe(true);
    fail = true;
    await act(async () => { await h.result.current.discover(); });
    expect(h.result.current.failure.status).toBe(502);
    expect(h.result.current.lastRun).toBeNull();
    expect(h.result.current.discovery).toBeNull();
  });

  test("a stale answer for an old epoch does not clear the run of the new door", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const t = createTestApi({ hooks: { "/api/discover": async (b) => { if (b.door === "lab-banking-full") { await gate; down()(); } } } });
    const h = renderHook(() => useLab({ api: t.api }));
    await waitFor(() => expect(h.result.current.boot).toBe("ready"));
    let pending;
    act(() => { pending = h.result.current.discover(); });
    await waitFor(() => expect(h.result.current.busy).not.toBeNull());
    act(() => h.result.current.chooseDoor("lab-banking-limited"));
    await act(async () => { await h.result.current.discover(); });
    expect(h.result.current.lastRun.door).toBe("lab-banking-limited");
    release();
    await act(async () => { await pending; });
    expect(h.result.current.failure).toBeNull();
    expect(h.result.current.lastRun.door).toBe("lab-banking-limited");
  });
});

describe("a failed run clears the previous one (every surface of the page)", () => {
  let fail;
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } fail = false; });
  afterEach(() => { vi.unstubAllGlobals(); });
  const tid = (x) => screen.getByTestId(x);
  const click = (x) => fireEvent.click(typeof x === "string" ? tid(x) : x);

  test("Arguments response, Evidence, the evidence counter and every view stop showing the old run", async () => {
    const t = createTestApi({ hooks: { "/api/call": () => { if (fail) down()(); } } });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    click("action-discover");
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Allowed"));
    click("tool-who_has_role");
    click("run");
    await waitFor(() => expect(screen.getByTestId("response-json")).toBeTruthy());
    expect(tid("evidence-counter").textContent).toMatch(/Not started|Message/);
    for (const id of ["reel", "tokens", "sequence", "diagram", "trace"]) click(`etab-${id}`);

    fail = true;
    click("run");
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Could not complete this request"));
    // Arguments and response: no old response, no old tokens
    expect(screen.queryByTestId("response-json")).toBeNull();
    expect(screen.queryByTestId("run-tokens")).toBeNull();
    // Evidence: nothing attempted
    click("tab-evidence");
    expect(tid("evidence-empty")).toBeTruthy();
    expect(screen.queryByTestId("evidence-panel")).toBeNull();
    // the evidence counter and the views
    click("etab-reel");
    expect(tid("evidence-counter").textContent).toBe("No run yet");
    for (const id of ["reel", "tokens", "sequence", "diagram", "trace"]) {
      click(`etab-${id}`);
      const text = tid(`epanel-${id}`).textContent;
      expect(text, id).not.toMatch(/Message \d+ of \d+/);
      expect(text, id).not.toMatch(/who_has_role/); // the diagram legend names every outcome as a static box, so the run's own tool name is the marker
    }
  });
});
