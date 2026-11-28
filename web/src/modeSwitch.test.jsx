import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";

// N5 (fix pass): the views now live in the inline evidence tab row (EvidenceTabs) under the verdict card; a Mock/Real switch remounts it, so the
// walk and any open step detail start over and the new mode's data is shown. The 409-safety of the switch itself is unchanged.
const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "lab-banking-full", PGC_GW_KEY_LAB_BANKING_FULL: "test-only-key" };
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });
const tid = (x) => screen.getByTestId(x);

describe("a Mock/Real switch and the evidence views", () => {
  test("the switch remounts the evidence row: the walk starts over and the new mode's empty state is shown", async () => {
    const t = createTestApi({ env: REAL_ENV });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("action-discover"));
    await waitFor(() => expect(tid("verdict-word").textContent).toBe("Allowed"));
    fireEvent.click(tid("etab-reel"));
    expect(tid("epanel-reel")).toBeInTheDocument();
    fireEvent.click(within(tid("epanel-reel")).getByTestId("step-next"));
    await waitFor(() => expect(tid("evidence-counter")).toHaveTextContent("Message 1 of"));
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("mode-status")).toHaveAttribute("data-source", "real"));
    expect(tid("evidence-counter")).toHaveTextContent("No run yet");
    expect(within(tid("epanel-reel")).getByTestId("reel-none")).toBeInTheDocument();
    fireEvent.change(tid("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(tid("mode-status")).toHaveAttribute("data-source", "mock"));
    expect(tid("evidence-counter")).toHaveTextContent("No run yet");
  });

  test("a switch that fails (Real not configured, 409) leaves the evidence views as they were", async () => {
    const t = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("etab-reel"));
    await waitFor(() => expect(tid("epanel-reel")).toBeInTheDocument());
    fireEvent.change(tid("mode-select"), { target: { value: "real" } }); // the option is disabled in the page, but the handler must still be safe
    await new Promise((r) => setTimeout(r, 30));
    expect(tid("epanel-reel")).toBeInTheDocument();
  });

  // N6: the rail heading says what the data under it says.
  test("the rail heading follows the mode: Mock 'Who the gateway evaluates', Real 'Identity this lab declares', and no '?' avatar in Real", async () => {
    const t = createTestApi({ env: REAL_ENV });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    expect(screen.getByRole("heading", { name: "Who the gateway evaluates" })).toBeInTheDocument();
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("mode-status")).toHaveAttribute("data-source", "real"));
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
  test("the first tab stop is a 'Skip to main content' link that moves focus to main; the mode status is main's first child", async () => {
    const t = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    await screen.findByTestId("verdict-card");
    fireEvent.click(tid("mode-modal-ok")); // the open modal autofocuses Got it and takes the first Tab: close it first
    const tabbable = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')];
    expect(tabbable[0]).toBe(tid("skip-link"));
    expect(tid("skip-link")).toHaveTextContent("Skip to main content");
    expect(tid("skip-link").getAttribute("href")).toBe("#pgc-main");
    const main = document.querySelector("main");
    expect(main.id).toBe("pgc-main");
    expect(main.firstElementChild).toBe(tid("mode-status"));
    fireEvent.click(tid("skip-link"));
    expect(document.activeElement).toBe(main);
  });
});
