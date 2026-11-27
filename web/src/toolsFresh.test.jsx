import React from "react";
import fs from "node:fs";
import path from "node:path";
import { act, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App.jsx";
import ToolsTab, { FRESH_MS } from "./ToolsTab.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";

// Owner, 2026-11-27: when the gateway's tool list fills in, the boxes get a "just arrived" tint for a few seconds and the page scrolls to them.
// The colours are checked in a real browser; this pins the behaviour: tint on arrival, gone after FRESH_MS, one scroll per arrival,
// nothing on a filter keystroke, a new tint on a new discovery, instant (not smooth) scroll with reduced motion, and the CSS colour rules.
let scrolled;
const mount = async () => {
  const t = createTestApi();
  vi.stubGlobal("fetch", fetchFrom(t.api));
  render(<App />);
  await screen.findByTestId("verdict-card");
};
const tid = (x) => screen.getByTestId(x);
const boxes = () => [...document.querySelectorAll(".pgc-tool")];
const fresh = () => boxes().filter((b) => b.classList.contains("pgc-tool--fresh"));
const discover = async () => { fireEvent.click(tid("action-discover")); await waitFor(() => expect(tid("verdict-word").textContent).toBe("Allowed")); };

beforeEach(() => {
  configure({ asyncUtilTimeout: 5000 }); // a cold start (CI) can take longer than the 1 s default
  try { localStorage.clear(); } catch { /* none */ }
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(opts) { scrolled.push({ el: this, opts }); };
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete Element.prototype.scrollIntoView; });

describe("the tools just arrived", () => {
  test("before any discovery there are no boxes and nothing scrolls", async () => {
    await mount();
    expect(boxes()).toHaveLength(0);
    expect(scrolled).toHaveLength(0);
  });

  test("every box is tinted when the list fills in, and the page scrolls to the grid once", async () => {
    await mount();
    await discover();
    await waitFor(() => expect(boxes().length).toBeGreaterThan(0));
    expect(fresh()).toHaveLength(boxes().length);
    expect(tid("tool-grid")).toHaveAttribute("data-fresh", "true");
    const toGrid = scrolled.filter((s) => s.el === tid("tool-grid"));
    expect(toGrid).toHaveLength(1);
    expect(toGrid[0].opts).toMatchObject({ block: "start", behavior: "smooth" });
  });

  test("the tint goes away after FRESH_MS and the boxes stay", async () => {
    await mount();
    await discover();
    await waitFor(() => expect(fresh().length).toBeGreaterThan(0));
    const n = boxes().length;
    act(() => { vi.advanceTimersByTime(FRESH_MS - 500); });
    expect(fresh()).toHaveLength(n);
    act(() => { vi.advanceTimersByTime(600); });
    expect(fresh()).toHaveLength(0);
    expect(boxes()).toHaveLength(n);
    expect(tid("tool-grid")).not.toHaveAttribute("data-fresh");
  });

  test("typing in the filter neither tints nor scrolls again", async () => {
    await mount();
    await discover();
    await waitFor(() => expect(fresh().length).toBeGreaterThan(0));
    act(() => { vi.advanceTimersByTime(FRESH_MS + 100); });
    const before = scrolled.length;
    fireEvent.change(tid("tool-filter"), { target: { value: "list" } });
    expect(fresh()).toHaveLength(0);
    expect(scrolled).toHaveLength(before);
  });

  test("a new discovery (another door) tints and scrolls again", async () => {
    await mount();
    await discover();
    await waitFor(() => expect(fresh().length).toBeGreaterThan(0));
    act(() => { vi.advanceTimersByTime(FRESH_MS + 100); });
    expect(fresh()).toHaveLength(0);
    const before = scrolled.length;
    fireEvent.click(tid("door-lab-banking-limited"));
    await discover();
    await waitFor(() => expect(fresh().length).toBeGreaterThan(0));
    expect(boxes()).toHaveLength(7); // the limited door lists 7 tools: these are the new boxes, not the old 18
    expect(scrolled.length).toBe(before + 1);
  });

  test("it is also said in words (a live region), and the words go with the tint", async () => {
    await mount();
    expect(tid("tools-arrived")).toHaveAttribute("role", "status");
    expect(tid("tools-arrived")).toHaveTextContent("");
    await discover();
    await waitFor(() => expect(tid("tools-arrived")).toHaveTextContent(/^\d+ tools just arrived$/));
    act(() => { vi.advanceTimersByTime(FRESH_MS + 100); });
    expect(tid("tools-arrived")).toHaveTextContent("");
  });

  test("reduced motion scrolls instantly, not smoothly", async () => {
    vi.stubGlobal("matchMedia", (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    await mount();
    await discover();
    await waitFor(() => expect(scrolled.some((s) => s.el === tid("tool-grid"))).toBe(true));
    expect(scrolled.find((s) => s.el === tid("tool-grid")).opts.behavior).toBe("auto");
  });
});

// The component on its own, so a list can come back that was here at mount (review of #26: the tint must never be left on by an earlier timer).
const stubLab = (discovery) => ({ discovery, hasTools: Boolean(discovery?.tools), info: { source: "mock" }, identity: { name: "demo" }, busy: null, door: "lab-banking-full", selectedTool: null });
const list = (names) => ({ verdict: { id: "allowed" }, tools: names.map((name) => ({ name, args: {} })) });
const view = (lab) => <ToolsTab lab={lab} onPick={() => {}} filterRef={{ current: null }} onDiscover={() => {}} onRunByName={() => {}} />;

describe("the tint never sticks", () => {
  test("a list that was here at mount is not new, a later list is, and the first coming back inside the window is not tinted", () => {
    const first = list(["a", "b"]);
    const second = list(["c", "d", "e"]);
    const { rerender } = render(view(stubLab(first)));
    expect(fresh()).toHaveLength(0);
    rerender(view(stubLab(second)));
    expect(fresh()).toHaveLength(3);
    rerender(view(stubLab(first)));
    expect(boxes()).toHaveLength(2);
    expect(fresh()).toHaveLength(0);
    expect(scrolled.filter((s) => s.el === tid("tool-grid"))).toHaveLength(1);
  });

  test("a list that goes away and comes back as a new one is tinted once more", () => {
    const { rerender } = render(view(stubLab(null)));
    rerender(view(stubLab(list(["a"]))));
    expect(fresh()).toHaveLength(1);
    rerender(view(stubLab(null)));
    expect(boxes()).toHaveLength(0);
    rerender(view(stubLab(list(["b", "c"]))));
    expect(fresh()).toHaveLength(2);
  });
});

describe("the tint's colour rules (app.css)", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src", "app.css"), "utf8");
  const rule = (sel) => { const m = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`)); return m ? m[0] : ""; };

  test("it is the informational blue, never red or amber, and a selected box overrides it", () => {
    const r = rule(".pgc-tool--fresh");
    expect(r).not.toBe("");
    expect(r).toMatch(/--status-info/);
    expect(r).not.toMatch(/--accent|--danger|--status-warn|red|amber/);
    expect(css.indexOf(".pgc-tool--fresh {")).toBeLessThan(css.indexOf('.pgc-tool[aria-pressed="true"]'));
  });

  test("the fade is switched off for reduced motion, and the grid leaves room for the header when scrolled to", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.pgc-tool \{ transition: none; \} \}/);
    expect(css).toMatch(/\.pgc-tool-grid \{ scroll-margin-top: 7rem; \}/);
    expect(rule(".pgc-sr")).toMatch(/clip: rect\(0 0 0 0\)/);
  });
});
