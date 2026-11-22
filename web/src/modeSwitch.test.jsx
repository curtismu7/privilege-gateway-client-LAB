import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";

// N5 (fix pass): the card above the panels changes height when the mode changes, so a panel that was placed for the old card could sit over the new
// card and its buttons. A Mock/Real switch closes every panel (the dock is remounted); reopening places it afresh under the new card.
const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "demo-all-tools", PGC_GW_KEY_DEMO_ALL_TOOLS: "test-only-key" };
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });
const tid = (x) => screen.getByTestId(x);

describe("a Mock/Real switch and the open panels", () => {
  test("open panels are closed by the switch, in both directions, and the dock buttons are not pressed", async () => {
    const t = createTestApi({ env: REAL_ENV });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("action-discover"));
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Allowed"));
    fireEvent.click(tid("dock-reel")); fireEvent.click(tid("dock-trace"));
    await waitFor(() => expect(tid("panel-reel")).toBeInTheDocument());
    expect(tid("dock-reel")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(screen.queryByTestId("panel-reel")).toBeNull();
    expect(screen.queryByTestId("panel-trace")).toBeNull();
    expect(tid("dock-reel")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tid("dock-reel"));
    await waitFor(() => expect(tid("panel-reel")).toBeInTheDocument());
    fireEvent.change(tid("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(tid("sim-banner")).not.toHaveAttribute("data-state"));
    expect(screen.queryByTestId("panel-reel")).toBeNull();
  });

  test("a switch that fails (Real not configured, 409) leaves the panels as they were", async () => {
    const t = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("dock-reel"));
    await waitFor(() => expect(tid("panel-reel")).toBeInTheDocument());
    fireEvent.change(tid("mode-select"), { target: { value: "real" } }); // the option is disabled in the page, but the handler must still be safe
    await new Promise((r) => setTimeout(r, 30));
    expect(tid("panel-reel")).toBeInTheDocument();
  });

  // N6: the rail heading says what the data under it says.
  test("the rail heading follows the mode: Mock 'Who the gateway evaluates', Real 'Identity this lab declares', and no '?' avatar in Real", async () => {
    const t = createTestApi({ env: REAL_ENV });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    expect(screen.getByRole("heading", { name: "Who the gateway evaluates" })).toBeInTheDocument();
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(screen.getByRole("heading", { name: "Identity this lab declares" })).toBeInTheDocument();
    expect(screen.queryByText("Who the gateway evaluates")).toBeNull();
    expect(tid("gateway-identity")).toHaveTextContent("Identity declared by this lab's settings");
    expect(tid("gateway-identity").querySelector(".pgc-avatar").textContent).not.toBe("?");
  });

  // N8: the Mock upstream card does not claim a real observation under its SIMULATED line.
  test("the Mock upstream-error card says it was simulated by this lab, not 'Observed: read directly from the gateway'", async () => {
    const t = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("advanced").querySelector("summary"));
    fireEvent.change(tid("scenario-select"), { target: { value: "upstream-error" } });
    fireEvent.click(tid("action-discover"));
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Upstream error"));
    expect(tid("verdict-sim")).toHaveTextContent(/SIMULATED/);
    expect(tid("verdict-facts")).toHaveTextContent(/Simulated by this lab/);
    expect(tid("verdict-facts").textContent).not.toMatch(/Observed: read directly/);
    fireEvent.click(tid("tab-evidence"));
    expect(tid("decision-json").textContent).not.toMatch(/\bobserved\b/);
  });

  // N9: a keyboard user can skip the header controls.
  test("the first tab stop is a 'Skip to main content' link that moves focus to main; the banner is still main's first child", async () => {
    const t = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    const tabbable = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')];
    expect(tabbable[0]).toBe(tid("skip-link"));
    expect(tid("skip-link")).toHaveTextContent("Skip to main content");
    expect(tid("skip-link").getAttribute("href")).toBe("#pgc-main");
    const main = document.querySelector("main");
    expect(main.id).toBe("pgc-main");
    expect(main.firstElementChild).toBe(tid("sim-banner"));
    fireEvent.click(tid("skip-link"));
    expect(document.activeElement).toBe(main);
  });
});
