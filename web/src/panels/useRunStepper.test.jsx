// The one walkthrough over the real hops of real runs (the lab core behind testLab.js): which hop each situation stops at, that Next from a
// fresh page starts paused at message 1, that a new run starts over, and that the timer walks and stops.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createTestApi } from "../testLab.js";
import { planRun, counterText, useRunStepper } from "./useRunStepper.js";

const { api, lab } = createTestApi();
const args = (name) => lab.info().catalog.find((t) => t.name === name).args;
const call = (tool, extra = {}, door = "demo-all-tools") => api("/api/call", { method: "POST", body: { door, tool, arguments: args(tool), ...extra } });

describe("planRun: where Simulate stops", () => {
  test("an allowed run plays through to the reply", async () => {
    const r = await call("list_entitlements");
    const p = planRun(r.hops, r.verdict.id);
    expect(r.verdict.id).toBe("allowed");
    expect(p.stop).toBe(p.ns.length - 1);
    expect(p.stopsEarly).toBe(false);
    expect(p.ns).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  test("a refused run stops at the Privilege decision, not at the reply", async () => {
    const r = await call("open_ticket", {}, "demo-some-tools");
    const p = planRun(r.hops, r.verdict.id);
    expect(r.verdict.id).toBe("blocked");
    expect(p.stopHop).toMatchObject({ kind: "authorize-decision", verdict: "deny" });
    expect(p.stopsEarly).toBe(true);
  });
  test("a blocked door stops at its Privilege decision", async () => {
    const r = await api("/api/discover", { method: "POST", body: { door: "demo-blocked" } });
    expect(planRun(r.hops, r.verdict.id).stopHop).toMatchObject({ kind: "authorize-decision" });
  });
  test("an upstream error stops at the tool hop", async () => {
    const r = await call("list_entitlements", { scenario: "upstream-error" });
    expect(planRun(r.hops, r.verdict.id).stopHop).toMatchObject({ kind: "tool-dispatched", verdict: "deny" });
  });
  test("a held call stops waiting on the human", async () => {
    const r = await call("open_ticket");
    expect(r.verdict.id).toBe("held");
    expect(planRun(r.hops, r.verdict.id).stopHop).toMatchObject({ kind: "tool-held", verdict: "held" });
  });
  test("hops that did not run are not walked", async () => {
    const r = await call("list_entitlements", { scenario: "no-key" });
    const p = planRun(r.hops, r.verdict.id);
    expect(r.hops.some((h) => h.verdict === "skip")).toBe(true);
    expect(p.ns.length).toBe(r.hops.filter((h) => h.verdict !== "skip").length);
  });
  test("no hops: nothing to walk", () => {
    expect(planRun(undefined, null)).toMatchObject({ ns: [], stop: 0, stopsEarly: false, stopHop: null });
  });
});

describe("counterText", () => {
  test("Message N of M, a plain sentence before the walk, and the empty case", () => {
    expect(counterText({ total: 8, step: 2 })).toBe("Message 3 of 8");
    expect(counterText({ total: 8, step: -1 })).toBe("Not started, 8 messages");
    expect(counterText({ total: 0, step: -1 })).toBe("No run yet");
    expect(counterText({ total: 8, step: -1, extra: 9 })).toBe("Message 9, not in this run");
  });
});

// Each timer step needs its own act(): the next timeout is scheduled by an effect after the re-render.
const tickFor = (ms, step = 100) => { for (let t = 0; t < ms; t += step) act(() => vi.advanceTimersByTime(step)); };

describe("useRunStepper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("Next from a fresh page starts PAUSED at message 1; Prev from a fresh page does the same", async () => {
    const r = await call("list_entitlements");
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    expect(result.current.started).toBe(false);
    expect(result.current.selected).toBe(null);
    act(() => result.current.next());
    expect(result.current).toMatchObject({ step: 0, paused: true, playing: false, selected: 1, counter: "Message 1 of 8" });
    tickFor(10000);
    expect(result.current.step).toBe(0); // paused: the timer does not walk
    act(() => result.current.reset());
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ step: 0, paused: true });
  });

  test("Simulate plays on the timer and stops at the refusal; Next goes on; Simulate again restarts", async () => {
    const r = await call("open_ticket", {}, "demo-some-tools");
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    const stopAt = planRun(r.hops, r.verdict.id).stop;
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ step: 0, playing: true });
    tickFor(60000);
    expect(result.current.step).toBe(stopAt);
    expect(result.current.playing).toBe(false);
    expect(result.current.selected).toBe(r.hops.filter((h) => h.verdict !== "skip")[stopAt].n);
    act(() => result.current.next());
    expect(result.current.step).toBe(stopAt + 1);
    act(() => result.current.toggle()); // at or past the stop: restart
    act(() => result.current.toggle());
    expect(result.current.step).toBe(0);
  });

  test("a manual step pauses a running walk", async () => {
    const r = await call("list_entitlements");
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    act(() => result.current.toggle());
    tickFor(1300);
    expect(result.current.playing).toBe(true);
    act(() => result.current.next());
    expect(result.current.playing).toBe(false);
  });

  test("Prev also pauses a running walk", async () => {
    const r = await call("list_entitlements");
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    act(() => result.current.toggle());
    tickFor(1300);
    expect(result.current.playing).toBe(true);
    act(() => result.current.prev());
    expect(result.current.playing).toBe(false);
  });

  test("selecting a hop pauses on it; a hop that did not run is shown without moving the walk", async () => {
    const r = await call("list_entitlements", { scenario: "no-key" });
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    act(() => result.current.select(3));
    expect(result.current).toMatchObject({ selected: 3, paused: true, step: 2 });
    const skipped = r.hops.find((h) => h.verdict === "skip").n;
    act(() => result.current.select(skipped));
    expect(result.current.selected).toBe(skipped);
    expect(result.current.counter).toBe(`Message ${skipped}, not in this run`);
    act(() => result.current.select(2));
    expect(result.current.selected).toBe(2);
  });

  test("a new run starts the walk over, even with the same number of hops", async () => {
    const a = await call("list_entitlements");
    const b = await call("get_portfolio_summary");
    const { result, rerender } = renderHook(({ run }) => useRunStepper(run.hops, run.verdict.id), { initialProps: { run: a } });
    act(() => result.current.select(5));
    expect(result.current.step).toBe(4);
    rerender({ run: b });
    expect(result.current).toMatchObject({ step: -1, selected: null, started: false });
  });

  test("speed changes the timer", async () => {
    const r = await call("list_entitlements");
    const { result } = renderHook(() => useRunStepper(r.hops, r.verdict.id));
    act(() => result.current.setSpeed("fast"));
    act(() => result.current.toggle());
    tickFor(520);
    expect(result.current.step).toBe(1);
  });

  test("nothing to walk: the controls do nothing", () => {
    const { result } = renderHook(() => useRunStepper(undefined, null));
    act(() => result.current.toggle()); act(() => result.current.next());
    expect(result.current).toMatchObject({ total: 0, started: false, counter: "No run yet" });
  });
});
