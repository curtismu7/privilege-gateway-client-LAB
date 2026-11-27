import React from "react";
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { FRESH_MS } from "./ToolsTab.jsx";
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

  test("reduced motion scrolls instantly, not smoothly", async () => {
    vi.stubGlobal("matchMedia", (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    await mount();
    await discover();
    await waitFor(() => expect(scrolled.some((s) => s.el === tid("tool-grid"))).toBe(true));
    expect(scrolled.find((s) => s.el === tid("tool-grid")).opts.behavior).toBe("auto");
  });
});

describe("the tint's colour rules (app.css)", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src", "app.css"), "utf8");
  const rule = (sel) => (css.split("\n").find((l) => l.startsWith(sel)) ?? "");

  test("it is the informational blue, never red or amber, and a selected box overrides it", () => {
    const r = rule(".pgc-tool--fresh");
    expect(r).toMatch(/--status-info/);
    expect(r).not.toMatch(/--accent|--danger|--status-warn|red|amber/);
    expect(css.indexOf(".pgc-tool--fresh {")).toBeLessThan(css.indexOf('.pgc-tool[aria-pressed="true"]'));
  });

  test("the fade is switched off for reduced motion, and the grid leaves room for the header when scrolled to", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.pgc-tool \{ transition: none; \} \}/);
    expect(rule(".pgc-tool-grid { scroll-margin-top")).toMatch(/scroll-margin-top: 7rem/);
  });
});
