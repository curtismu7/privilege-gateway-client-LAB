import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";
import fs from "node:fs";
import path from "node:path";
import { createTestApi, fetchFrom } from "./testLab.js";

// B2/B3 (fix pass): the page's own tabs carry the calm look (ink and amber, never red) through ONE wrapper class, because the shared Gateway trace
// and JsonPane sit outside the dialogs. The computed colours are proven in a real browser (e2e/colors.py); this pins the wrapper and its states.
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });
const tid = (x) => screen.getByTestId(x);
const mount = async () => { const t = createTestApi(); vi.stubGlobal("fetch", fetchFrom(t.api)); render(<App />); await screen.findByTestId("verdict-card"); };
const tabs = () => document.querySelector(".pgc-tabs");

describe("the tabs' calm look", () => {
  test("the tab section is always .pgc-calm, and a refusal adds .pgc-calm--refusal (the lock), never the red variant in Mock", async () => {
    await mount();
    expect(tabs().classList.contains("pgc-calm")).toBe(true);
    expect(tabs().classList.contains("pgc-calm--refusal")).toBe(false);
    fireEvent.click(tid("door-lab-banking-blocked"));
    fireEvent.click(tid("action-discover"));
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Blocked by policy"));
    expect(tabs().classList.contains("pgc-calm--refusal")).toBe(true);
    expect(tabs().classList.contains("pgc-calm--red")).toBe(false);
  });

  test("the CSS remaps the danger colour to amber for .pgc-calm, and only the red variant keeps it", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "app.css"), "utf8");
    expect(css).toMatch(/\.pgc-calm:not\(\.pgc-calm--red\)\s*\{\s*--danger-text:\s*var\(--status-warn\)/);
    expect(css).toMatch(/\.pgc-calm[^{]*\{[^}]*--accent:\s*var\(--text\)/s);
  });
});
