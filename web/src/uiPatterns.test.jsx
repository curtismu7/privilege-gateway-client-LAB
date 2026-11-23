import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";

// B4 (fix pass): what the shared UI-pattern checker (AI-DEMO-Standalone scripts/check-ui-patterns.mjs, run by e2e/ui-patterns.sh) reads. P2: no
// heading element may come before the banner in source order, so the Tools empty state's title is role="heading" (same level, same words, same
// screen-reader behaviour) and not an <h3>. P9: the lab's primary actions are named *-primary (the checker finds a primary by class name), and the
// documented `ui-pattern: allow P9` escape says why three of them exist in the source.
const src = (f) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("UI pattern checker (P2, P9)", () => {
  test("the Tools empty state title is a level-3 heading by role, not an <h3> element", async () => {
    expect(src("ToolsTab.jsx")).not.toMatch(/<h3[ >]/);
    const t = createTestApi(); vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    fireEvent.click(await screen.findByTestId("tab-tools")); // Agent chat is the opening tab since 2026-11-23
    const empty = await screen.findByTestId("tools-empty");
    const title = empty.querySelector('[role="heading"]');
    expect(title).not.toBeNull();
    expect(title.getAttribute("aria-level")).toBe("3");
    expect(title.textContent).toBe("No tools discovered yet");
    expect(screen.getByRole("heading", { level: 3, name: "No tools discovered yet" })).toBe(title);
  });

  test("the card action, Get MCP tools and Run carry a *-primary class and a P9 escape with a reason", () => {
    for (const f of ["VerdictCard.jsx", "ToolsTab.jsx", "ArgsTab.jsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/pgc-go pgc-go-primary/);
      expect(s, f).toMatch(/ui-pattern: allow P9 [^*]{8,}/);
    }
  });

  test("the primary buttons still look the same: pgc-go-primary adds no style of its own, and the shared red .primary is not used", () => {
    expect(src("app.css")).not.toMatch(/pgc-go-primary/);
    for (const f of ["VerdictCard.jsx", "ToolsTab.jsx", "ArgsTab.jsx"]) expect(src(f), f).not.toMatch(/className="(?:[^"]*\s)?primary[\s"]/);
  });

  test("the skip link's target has a focus style (UI pattern A2: no outline:none without a replacement)", () => {
    expect(src("app.css")).not.toMatch(/\.pgc-main:focus\s*\{[^}]*outline:\s*none/);
    expect(src("app.css")).toMatch(/\.pgc-main:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  });
});
