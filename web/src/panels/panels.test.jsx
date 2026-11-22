// The evidence panels on the real lab core: the dock, the one walkthrough shared by the movie reel, the token sequence and the sequence view,
// what each panel shows for each kind of run, and the rules that bite (a refusal is never red, hostile text is inert, props only). jsdom has no
// layout and no second window: dragging, resizing, the pop-out window and the 375px sheet are proven in a real browser (e2e/panels.py).
import React from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App.jsx";
import PanelDock, { PANELS, placeFor, scrollForRoom } from "./PanelDock.jsx";
import StepperBar from "./StepperBar.jsx";
import TokensPanel from "./TokensPanel.jsx";
import RunNote from "./RunNote.jsx";
import { useRunStepper } from "./useRunStepper.js";
import { createTestApi, fetchFrom } from "../testLab.js";

let t;
const mount = async (opts) => {
  t = createTestApi(opts);
  vi.stubGlobal("fetch", fetchFrom(t.api));
  render(<App />);
  await screen.findByTestId("verdict-card");
};
const tid = (x) => screen.getByTestId(x);
const click = (x) => fireEvent.click(typeof x === "string" ? tid(x) : x);
const word = () => tid("verdict-word").textContent;
const waitWord = (w) => waitFor(() => expect(word()).toBe(w));
// Run one tool through the page (the way a person does), on the given door.
async function runTool(door, tool, { text } = {}) {
  click(`door-${door}`);
  click("action-discover");
  await waitFor(() => expect(screen.queryByTestId("tool-grid")).not.toBeNull());
  if (!screen.queryByTestId(`tool-${tool}`)) {
    // The gateway lists only what the grant allows, so a refused tool has no tile: run it by name.
    fireEvent.change(tid("by-name-input"), { target: { value: tool } });
    click("by-name-run");
  } else {
    click(`tool-${tool}`);
    if (text) fireEvent.change(document.getElementById("pgc-args"), { target: { value: text } });
    click("run");
  }
  await waitFor(() => expect(tid("verdict-card").dataset.verdict).not.toBe("working"));
}
const open = (id) => click(`dock-${id}`);
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.css"), "utf8");

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the dock", () => {
  test("one button per panel with an icon and a label, pressed when open, plus the Talk track button (step 2c)", async () => {
    await mount();
    const dock = tid("panel-dock");
    expect(within(dock).getAllByRole("button").map((b) => b.textContent)).toEqual(["Movie reel", "Token sequence", "Sequence", "Diagram", "Gateway trace", "Talk track"]);
    for (const b of within(dock).getAllByRole("button")) expect(b.querySelector("svg")).not.toBeNull();
    expect(tid("dock-talk")).not.toBeDisabled();
    expect(tid("dock-talk")).toHaveAttribute("aria-pressed", "false");
    expect(tid("dock-reel")).toHaveAttribute("aria-pressed", "false");
    open("reel");
    expect(tid("dock-reel")).toHaveAttribute("aria-pressed", "true");
    const dlg = tid("panel-reel");
    expect(dlg).toHaveAttribute("role", "dialog");
    expect(dlg).not.toHaveAttribute("aria-modal"); // non-modal: the page stays usable
    expect(document.querySelector(".fd-backdrop")).toBeNull();
    expect(dlg.className).toContain("pgc-fd");
  });

  test("each panel is its own FloatingDialog: drag by title, resize handles, pop-out button, and a close button named for what it does", async () => {
    await mount();
    for (const p of PANELS) {
      open(p.id);
      const dlg = tid(`panel-${p.id}`);
      expect(within(dlg).getByTestId("fd-titlebar")).toHaveAttribute("aria-label", `Move ${p.label} panel`);
      expect(dlg.querySelectorAll(".fd-handle")).toHaveLength(8);
      // The Diagram panel has no pop-out: React Flow cannot measure boxes in another window (docs/upstream/README.md), so it must not offer one.
      if (p.popOut === false) expect(within(dlg).queryByRole("button", { name: "Pop out to a new window" })).toBeNull();
      else expect(within(dlg).getByRole("button", { name: "Pop out to a new window" })).toBeInTheDocument();
      const close = within(dlg).getByRole("button", { name: new RegExp(`^Close ${p.label}`) });
      expect(close).toHaveAccessibleName(/hides; its place and size are kept/);
    }
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(PANELS.length);
  });

  test("Close hides the panel and keeps it mounted, so it comes back where it was; the dock button toggles too", async () => {
    await mount();
    open("reel");
    const before = tid("panel-reel").style.cssText;
    fireEvent.keyDown(within(tid("panel-reel")).getByTestId("fd-titlebar"), { key: "ArrowLeft", shiftKey: true }); // keyboard move
    const moved = tid("panel-reel").style.cssText;
    expect(moved).not.toBe(before);
    click(within(tid("panel-reel")).getByRole("button", { name: /^Close Movie reel/ }));
    expect(screen.queryByTestId("panel-reel")).toBeNull();
    expect(tid("dock-reel")).toHaveAttribute("aria-pressed", "false");
    open("reel");
    expect(tid("panel-reel").style.cssText).toBe(moved);
    open("reel"); // pressed: hides
    expect(screen.queryByTestId("panel-reel")).toBeNull();
  });

  test("close keeps the panel's place even when the browser cannot store it (private window)", async () => {
    await mount();
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem() {}, clear() {} } });
    try {
      open("reel");
      fireEvent.keyDown(within(tid("panel-reel")).getByTestId("fd-titlebar"), { key: "ArrowLeft", shiftKey: true });
      const moved = tid("panel-reel").style.cssText;
      open("reel"); // hide
      expect(screen.queryByTestId("panel-reel")).toBeNull();
      open("reel");
      expect(tid("panel-reel").style.cssText).toBe(moved);
    } finally { if (real) Object.defineProperty(window, "localStorage", real); }
  });

  test("opening a panel makes room under the verdict (the page scrolls up) unless the person already placed it", async () => {
    await mount();
    const by = vi.fn(); const was = window.scrollBy; window.scrollBy = by;
    try {
      const card = tid("verdict-card");
      card.getBoundingClientRect = () => ({ top: 200, bottom: 583, height: 383, left: 0, right: 100, width: 100, x: 0, y: 200 });
      window.innerHeight = 900;
      open("reel");
      expect(by).toHaveBeenCalled();
      by.mockClear();
      fireEvent.keyDown(within(tid("panel-reel")).getByTestId("fd-titlebar"), { key: "ArrowDown" }); // moved: saved
      open("reel"); open("reel");
      expect(by).not.toHaveBeenCalled();
    } finally { window.scrollBy = was; }
  });

  test("an unmoved panel is placed afresh each time it opens (the verdict card changes height); one the person moved keeps its place", async () => {
    await mount();
    const card = tid("verdict-card");
    const setBottom = (b) => { card.getBoundingClientRect = () => ({ top: 10, bottom: b, height: b - 10, left: 0, right: 100, width: 100, x: 0, y: 10 }); };
    const y = () => Number.parseFloat(tid("panel-reel").style.getPropertyValue("--fd-y"));
    setBottom(200); open("reel");
    const y1 = y();
    open("reel"); // hide
    setBottom(380); open("reel");
    expect(y()).toBeGreaterThan(y1); // moved down with the taller card
    fireEvent.keyDown(within(tid("panel-reel")).getByTestId("fd-titlebar"), { key: "ArrowDown" }); // the person moves it: saved
    const y2 = y();
    open("reel");
    setBottom(120); open("reel");
    expect(y()).toBe(y2); // kept
  });

  test("the panel last opened or touched is on top (stacking follows use, not DOM order)", async () => {
    await mount();
    open("reel"); open("trace");
    expect(tid("panel-trace").style.zIndex).toBe("1010");
    expect(tid("panel-reel").style.zIndex).toBe("1000");
    fireEvent.pointerDown(within(tid("panel-reel")).getByTestId("fd-titlebar"));
    expect(tid("panel-reel").style.zIndex).toBe("1010");
    expect(tid("panel-trace").style.zIndex).toBe("1000");
  });

  test("an open panel that is behind another is brought forward by its dock button; pressed again (now in front) it hides", async () => {
    await mount();
    open("reel"); open("trace");
    expect(tid("panel-reel").style.zIndex).toBe("1000");
    open("reel");
    expect(tid("panel-reel")).toBeInTheDocument();
    expect(tid("panel-reel").style.zIndex).toBe("1010");
    expect(tid("dock-reel").title).toMatch(/Press to hide it/);
    open("reel");
    expect(screen.queryByTestId("panel-reel")).toBeNull();
  });

  test("Escape closes the panel the focus is in, and only that one", async () => {
    await mount();
    open("reel"); open("trace");
    const trace = tid("panel-trace");
    fireEvent.keyDown(trace, { key: "Escape" });
    expect(screen.queryByTestId("panel-trace")).toBeNull();
    expect(screen.getByTestId("panel-reel")).toBeInTheDocument();
  });

  test("a saved size and place are used when the panel opens again after a reload", async () => {
    localStorage.setItem("pgc.panel.reel", JSON.stringify({ pos: { x: 111, y: 222 }, size: { w: 650, h: 333 } }));
    await mount();
    open("reel");
    const st = tid("panel-reel").style;
    expect([st.getPropertyValue("--fd-x"), st.getPropertyValue("--fd-y"), st.getPropertyValue("--fd-w"), st.getPropertyValue("--fd-h")]).toEqual(["111px", "222px", "650px", "333px"]);
  });
});

describe("placement: beside the verdict, never over it", () => {
  const vp = { w: 1440, h: 900 };
  test("a panel opens below the verdict card, at the right, above the dock", () => {
    const p = placeFor({ w: 780, h: 480 }, 0, vp, 56, 391);
    expect(p.y).toBeGreaterThanOrEqual(391 + 12);
    expect(p.h).toBeGreaterThanOrEqual(400);
    expect(p.x + p.w).toBe(1440 - 16);
    expect(p.y + p.h).toBeLessThanOrEqual(900 - 56 - 12);
    expect(p.h).toBeGreaterThanOrEqual(240);
  });
  test("with no card yet it opens under the header; later panels step down so each title bar stays reachable; it never leaves the screen", () => {
    expect(placeFor({ w: 780, h: 480 }, 0, vp, 56, null).y).toBe(96);
    const a = placeFor({ w: 780, h: 480 }, 0, vp, 56, 300), b = placeFor({ w: 780, h: 480 }, 1, vp, 56, 300), c = placeFor({ w: 780, h: 480 }, 3, vp, 56, 300);
    expect(b.y - a.y).toBe(30);
    expect(c.y - a.y).toBe(90);
    for (const q of [a, b, c]) expect(q.y + q.h).toBeLessThanOrEqual(900 - 56 - 12);
    expect(placeFor({ w: 780, h: 480 }, 0, { w: 500, h: 900 }, 56, 300).w).toBe(468); // narrower than the screen
  });
  test("a card too low for the minimum height still leaves the panel on screen (it covers the card only as a last resort)", () => {
    const p = placeFor({ w: 780, h: 480 }, 0, vp, 56, 850);
    expect(p.y + p.h).toBeLessThanOrEqual(900);
    expect(p.h).toBeGreaterThanOrEqual(240);
  });
  // N11: at 200% zoom a 1440x900 window is 720x450; the panel must not be squeezed to its 240px floor with the dock on top of it.
  test("a short viewport (200% zoom, 720x450): the panel starts at the top and takes the room above the dock, so it is not squeezed", () => {
    const short = { w: 720, h: 450 };
    const p = placeFor({ w: 960, h: 500 }, 0, short, 80, 300);
    expect(p.y).toBe(8);
    expect(p.y + p.h).toBeLessThanOrEqual(450 - 80 - 12);
    expect(p.h).toBeGreaterThanOrEqual(340);
    expect(placeFor({ w: 960, h: 500 }, 0, { w: 1440, h: 900 }, 56, 300).y).toBeGreaterThanOrEqual(96); // a tall window is as before
  });
  test("scrollForRoom scrolls the page up only as far as the verdict card's own top, and only when the panel would be short of room", () => {
    const by = vi.fn();
    const was = window.scrollBy;
    window.scrollBy = by;
    const card = document.createElement("section"); card.setAttribute("data-testid", "verdict-card");
    const dock = document.createElement("nav"); dock.className = "pgc-dock";
    document.body.append(card, dock);
    try {
      const at = (top, bottom, h = 56) => { card.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }); dock.getBoundingClientRect = () => ({ height: h }); };
      at(202, 583); scrollForRoom({ w: 1440, h: 900 });
      expect(by).toHaveBeenCalledWith(expect.objectContaining({ top: 163 })); // room is 900-56-12-595=237, 400 wanted: 163 short, 194 available
      by.mockClear(); at(30, 200); scrollForRoom({ w: 1440, h: 900 });
      expect(by).not.toHaveBeenCalled(); // plenty of room already
      by.mockClear(); at(10, 800); scrollForRoom({ w: 1440, h: 900 });
      expect(by).toHaveBeenCalledWith(expect.objectContaining({ top: 2 })); // never past the card's top (minus 8)
      by.mockClear(); at(-50, 500); scrollForRoom({ w: 1440, h: 900 });
      expect(by).not.toHaveBeenCalled(); // the card is already scrolled past the top: no scrolling down
    } finally { card.remove(); dock.remove(); window.scrollBy = was; }
  });
});

describe("one walkthrough, three views", () => {
  test("Next from a fresh page starts paused at message 1 and the reel, the token sequence and the sequence view all show that same hop", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("reel"); open("tokens"); open("sequence");
    expect(tid("dock-counter")).toHaveTextContent("Not started, 8 messages");
    expect(within(tid("panel-reel")).queryByTestId("step-detail")).toBeNull();
    click(within(tid("panel-reel")).getByTestId("step-next"));
    for (const id of ["panel-reel", "panel-tokens", "panel-sequence"]) expect(within(tid(id)).getByTestId("step-counter")).toHaveTextContent("Message 1 of 8");
    expect(within(tid("panel-reel")).getByTestId("step-toggle")).toHaveTextContent("Resume"); // paused, not playing
    expect(tid("frame-1")).toHaveAttribute("aria-current", "step");
    expect(tid("row-1")).toHaveAttribute("aria-current", "step");
    expect(tid("tokhop-1")).toHaveAttribute("data-on", "true");
    expect(within(tid("panel-reel")).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 1 detail");
    // a click on a sequence row moves the same walkthrough: the other two follow
    click(tid("row-4"));
    expect(tid("frame-4")).toHaveAttribute("aria-current", "step");
    expect(tid("tokhop-4")).toHaveAttribute("data-on", "true");
    expect(within(tid("panel-tokens")).getByTestId("step-counter")).toHaveTextContent("Message 4 of 8");
  });

  test("only one counter announces (aria-live polite): the first open stepped panel, else the dock", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    expect(tid("dock-counter")).toHaveAttribute("aria-live", "polite");
    open("tokens"); open("reel");
    expect(tid("dock-counter")).toHaveAttribute("aria-live", "off");
    expect(within(tid("panel-reel")).getByTestId("step-counter")).toHaveAttribute("aria-live", "polite");
    expect(within(tid("panel-tokens")).getByTestId("step-counter")).toHaveAttribute("aria-live", "off");
  });

  test("a new run starts the walk over in every panel", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("reel");
    click(within(tid("panel-reel")).getByTestId("step-next"));
    click(within(tid("panel-reel")).getByTestId("step-next"));
    expect(tid("dock-counter")).toHaveTextContent("Message 2 of 8");
    click("tab-tools"); click("tool-get_portfolio_summary"); click("run");
    await waitFor(() => expect(tid("dock-counter")).toHaveTextContent("Not started, 8 messages"));
  });

  test("no run yet: each panel says so, and the walkthrough buttons are disabled only because there is nothing to walk", async () => {
    await mount();
    open("reel"); open("tokens"); open("sequence"); open("trace");
    expect(tid("reel-none")).toBeInTheDocument();
    expect(tid("tokens-none")).toBeInTheDocument();
    expect(tid("sequence-none")).toBeInTheDocument();
    expect(tid("gateway-trace-empty")).toBeInTheDocument();
    expect(within(tid("panel-reel")).getByTestId("step-next")).toBeDisabled();
    expect(tid("dock-counter")).toHaveTextContent("No run yet");
  });
});

describe("what each panel shows for each kind of run", () => {
  test("blocked by policy: the reel stops at the Privilege decision and says denied; the run note says where Simulate stopped; the panel is not the red kind", async () => {
    await mount();
    await runTool("demo-some-tools", "sensitive_tax_record");
    await waitWord("Blocked by policy");
    open("reel");
    click(within(tid("panel-reel")).getByTestId("step-toggle")); // Simulate
    await waitFor(() => expect(within(tid("panel-reel")).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    expect(tid("run-note")).toHaveAttribute("data-verdict", "blocked");
    expect(tid("run-note-word")).toHaveTextContent("Blocked by policy");
    expect(tid("run-note-stop")).toHaveTextContent(/Simulate stops at message \d+, Policy decision/);
    const on = document.querySelector('[data-testid="panel-reel"] .rl-f[aria-current="step"]');
    expect(on).toHaveAttribute("data-verdict", "deny");
    expect(on.textContent).toMatch(/denied/);
    expect(within(tid("panel-reel")).getByTestId("sdp-status")).toHaveTextContent("denied");
    expect(tid("panel-reel").className).not.toContain("pgc-fd--red"); // amber, never red
    expect(tid("panel-reel").className).toContain("pgc-fd--refusal"); // with a lock beside the word
  }, 20000);

  test("held: stops waiting on the human, and says it is simulated", async () => {
    await mount();
    await runTool("demo-all-tools", "open_ticket");
    await waitWord("Held");
    open("sequence");
    click(within(tid("panel-sequence")).getByTestId("step-toggle"));
    await waitFor(() => expect(within(tid("panel-sequence")).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    expect(within(tid("panel-sequence")).getByTestId("step-counter")).toHaveTextContent("Message 7 of 8");
    expect(tid("row-7")).toHaveAttribute("aria-current", "step");
    expect(tid("row-7").getAttribute("aria-label")).toMatch(/Human approval/);
  }, 20000);

  test("an upstream error in Mock is not the red kind of panel (red is for a real error; where it stops is covered by planRun)", async () => {
    await mount();
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "upstream-error" } });
    click("action-discover");
    await waitWord("Upstream error");
    open("reel");
    expect(tid("panel-reel").className).not.toContain("pgc-fd--red");
    expect(tid("panel-reel").className).not.toContain("pgc-fd--refusal"); // an upstream failure is not a refusal: no lock
  });

  test("an upstream failure reads 'failed', not 'denied': the failed frame is verdict error, Simulate stops on it, no frame says denied", async () => {
    await mount();
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "upstream-error" } });
    click("action-discover");
    await waitWord("Upstream error");
    open("reel");
    click(within(tid("panel-reel")).getByTestId("step-toggle")); // Simulate
    await waitFor(() => expect(within(tid("panel-reel")).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    const on = document.querySelector('[data-testid="panel-reel"] .rl-f[aria-current="step"]');
    expect(on).toHaveAttribute("data-verdict", "error");
    expect(on.textContent).toMatch(/failed/);
    expect(on.textContent).not.toMatch(/denied/);
    expect(within(tid("panel-reel")).getByTestId("sdp-status")).toHaveTextContent("failed");
    expect(document.querySelector('[data-testid="panel-reel"] .rl-f[data-verdict="deny"]')).toBeNull();
    expect(tid("panel-reel").className).not.toContain("pgc-fd--red"); // amber with the word in Mock, never red
  }, 20000);

  test("a blocked door: the reel ends at its decision, hops that did not run sit behind the 'not in this run' chip", async () => {
    await mount();
    click("door-demo-blocked");
    click("action-discover");
    await waitWord("Blocked by policy");
    open("reel");
    expect(within(tid("panel-reel")).getByRole("button", { name: /hops not in this run/ })).toBeInTheDocument();
    expect(within(tid("panel-reel")).getByTestId("step-counter")).toHaveTextContent("Not started, 4 messages");
  });

  test("the simulated identity mismatch shows both identities in the panel", async () => {
    await mount({ session: { source: "mock-persona", id: "demouser", name: "demouser", email: "demouser@example.com", expiresAt: new Date(Date.now() + 3600e3).toISOString() } });
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "identity-mismatch" } });
    await runTool("demo-all-tools", "list_entitlements");
    open("reel");
    const ids = tid("run-note-identities");
    expect(ids).toHaveTextContent(/Page login \(SIMULATED scenario\)/);
    expect(ids).toHaveTextContent("demouser");
    expect(ids).toHaveTextContent(/Identity the gateway evaluated/);
    expect(ids).toHaveTextContent("aidemo");
  });

  test("Gateway trace is the shared GatewayTrace with Mock decisions 'checked'", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("trace");
    const tr = within(tid("panel-trace")).getByTestId("gateway-trace");
    expect(tr).toHaveTextContent("What Privilege did");
    expect(tr.textContent).toMatch(/Simulated: the lab's in-process gateway/);
  });
});

describe("switching mode or resetting with panels open", () => {
  const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "demo-all-tools", PGC_GW_KEY_DEMO_ALL_TOOLS: "test-only-key" };
  test("a Mock/Real switch closes the panels (N5) and starts the walk over; reopened, they are empty and show the new mode's data", async () => {
    await mount({ env: REAL_ENV });
    await runTool("demo-all-tools", "list_entitlements");
    open("reel"); open("tokens");
    click(within(tid("panel-reel")).getByTestId("step-next"));
    expect(tid("dock-counter")).toHaveTextContent("Message 1 of 8");
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(screen.queryByTestId("panel-reel")).toBeNull(); // closed: the card above them changed height, so they are placed afresh on the next open
    expect(screen.queryByTestId("panel-tokens")).toBeNull();
    expect(tid("dock-counter")).toHaveTextContent("No run yet");
    open("reel"); open("tokens");
    expect(tid("reel-none")).toBeInTheDocument();
    expect(tid("tokens-none")).toBeInTheDocument();
  });
  test("Reset in the header clears the run, the walk and the panels' places: every panel is closed and opens empty", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("sequence");
    click(within(tid("panel-sequence")).getByTestId("step-next"));
    click("reset");
    await waitFor(() => expect(screen.queryByTestId("panel-sequence")).toBeNull());
    expect(tid("dock-counter")).toHaveTextContent("No run yet");
    expect(tid("dock-sequence")).toHaveAttribute("aria-pressed", "false");
    open("sequence");
    expect(tid("sequence-none")).toBeInTheDocument();
  });
});

describe("token sequence", () => {
  test("Mock: labelled MOCK, decoded by the vendored pane (Header, Payload, Signature), 'first / same / changed' as words and an icon, spec chips, illustrative hops tagged", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("tokens");
    const panel = tid("panel-tokens");
    expect(within(panel).getByTestId("tokens-intro")).toHaveTextContent(/MOCK/);
    expect(within(panel).getByTestId("tokens-intro")).toHaveTextContent(/Decoding is not verifying/);
    click(within(panel).getByTestId("tokhop-3").querySelector("button"));
    const card = within(panel).getByTestId("token-card");
    expect(card).toHaveTextContent("MOCK");
    expect(card).toHaveTextContent("First");
    expect(within(card).getAllByText(/^(Header|Payload|Signature)$/).map((e) => e.textContent)).toEqual(["Header", "Payload", "Signature"]);
    expect(within(tid("tokhop-3")).getByText("illustrative")).toBeInTheDocument();
    // hop 4 sees the same token, and the introspection answer adds `active`
    click(within(panel).getByTestId("tokhop-4").querySelector("button"));
    const cards = within(tid("tokhop-4")).getAllByTestId("token-card");
    expect(cards.map((c) => c.dataset.change)).toEqual(["same", "changed"]);
    const intro = cards[1];
    expect(intro).toHaveTextContent("claims only");
    const row = within(intro).getByTestId("token-change").querySelector('li[data-status="added"]');
    expect(row).toHaveTextContent("Added");
    expect(row).toHaveTextContent("active");
    expect(row.querySelector("svg")).not.toBeNull(); // an icon next to the word
    expect(within(intro).getByTestId("token-change")).toHaveTextContent(/Same/);
    // a spec chip from the hop data is a plain label (this lab never links out)
    expect(within(tid("tokhop-4")).getByText(/RFC 7662/)).toBeInTheDocument();
    expect(within(tid("tokhop-4")).queryByRole("link")).toBeNull();
    // a hop with no token says so
    click(within(panel).getByTestId("tokhop-7").querySelector("button"));
    expect(within(panel).getByTestId("tokhop-none")).toHaveTextContent(/No token travels on this hop/);
  });

  test("nothing in the token view says a token is verified", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("tokens");
    click(within(tid("panel-tokens")).getByTestId("tokhop-3").querySelector("button"));
    expect(tid("panel-tokens").textContent).not.toMatch(/signature (is )?(valid|verified)|✓ verified/i);
  });

  test("Real: no token is invented; the panel says only an agent key is held and it is never shown", () => {
    const run = { id: "r", source: "real", simulated: false, verdict: { id: "allowed", word: "Allowed", sentence: "ok" }, hops: [{ n: 1, kind: "door-picked", from: "browser", to: "lab", verdict: "ok", title: "Door picked", request: { headers: { Authorization: "Bearer <agent key, 42 characters, kept on the server>" } }, response: {} }] };
    const Wrap = () => { const s = useRunStepper(run.hops, "allowed"); return <TokensPanel run={run} stepper={s} live />; };
    render(<Wrap />);
    expect(screen.getByTestId("tokens-intro")).toHaveTextContent(/Real: this lab only holds an agent key/);
    expect(screen.getByTestId("tokens-intro")).toHaveTextContent(/No token came back/);
    expect(screen.queryByText("MOCK")).toBeNull();
  });
});

describe("hostile input stays inert, and panels are props only", () => {
  test("a hostile string in the arguments reaches the step detail as text: no element, no handler", async () => {
    const hostile = '<img src=x onerror=alert(1)> and <script>window.__pwn=1</script>';
    await mount();
    await runTool("demo-all-tools", "list_entitlements", { text: JSON.stringify({ user: hostile }) });
    open("reel"); open("tokens"); open("sequence"); open("trace");
    click(within(tid("panel-reel")).getByTestId("step-next"));
    click(tid("frame-5"));
    for (const id of ["panel-reel", "panel-tokens", "panel-sequence", "panel-trace"]) {
      const dlg = tid(id);
      expect(dlg.querySelector("img[src='x']")).toBeNull();
      expect(dlg.querySelector("script")).toBeNull();
    }
    expect(tid("panel-reel").textContent).toContain("<img src=x onerror=alert(1)>");
    expect(window.__pwn).toBeUndefined();
  });

  test("a panel body needs only its props: it renders in a bare tree with no provider (a popped-out panel is a separate React root)", async () => {
    const { api, lab } = createTestApi();
    const a = lab.info().catalog.find((x) => x.name === "list_entitlements").args;
    const run = await api("/api/call", { method: "POST", body: { door: "demo-all-tools", tool: "list_entitlements", arguments: a } });
    for (const { Body, id } of PANELS) {
      const Wrap = () => { const s = useRunStepper(run.hops, run.verdict.id); return <Body run={run} stepper={s} live detailOn={false} onDetail={() => {}} />; };
      const { container, unmount } = render(<Wrap />);
      expect(container.querySelector(`[data-testid="panel-${id}-body"]`), id).not.toBeNull();
      unmount();
    }
  });

  test("RunNote and StepperBar render nothing risky for a missing run and a stopped walk", () => {
    const { container } = render(<RunNote run={null} stepper={{}} />);
    expect(container).toBeEmptyDOMElement();
    const stepper = { total: 0, started: false, playing: false, atStop: false, speed: "normal", counter: "No run yet", toggle() {}, next() {}, prev() {}, reset() {}, setSpeed() {} };
    render(<StepperBar stepper={stepper} live />);
    expect(screen.getByTestId("step-toggle")).toBeDisabled();
    expect(screen.getByTestId("step-reset")).toBeDisabled();
  });
});

describe("the step detail dialog that follows the sequence (section 8f)", () => {
  test("it is a non-modal FloatingDialog, off until switched on from the Sequence panel, it follows the walked message, and closing hides it", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    open("sequence");
    expect(screen.queryByTestId("panel-detail")).toBeNull();
    click(within(tid("panel-sequence")).getByTestId("detail-toggle"));
    const dlg = tid("panel-detail");
    expect(dlg).not.toHaveAttribute("aria-modal");
    expect(within(dlg).getByTestId("detail-pick")).toBeInTheDocument();
    click(within(tid("panel-sequence")).getByTestId("step-next"));
    expect(within(tid("panel-detail")).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 1 detail");
    click(within(tid("panel-sequence")).getByTestId("step-next"));
    expect(within(tid("panel-detail")).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 2 detail");
    // the stepper controls are never covered by a backdrop
    expect(document.querySelector(".fd-backdrop")).toBeNull();
    click(within(tid("panel-detail")).getByRole("button", { name: /^Close Step detail/ }));
    expect(screen.queryByTestId("panel-detail")).toBeNull();
    expect(within(tid("panel-sequence")).getByTestId("detail-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("colour rules for the panels (static)", () => {
  const block = css.slice(css.indexOf("/* ---- evidence panels"));
  test("inside a panel the shared accent tokens are ink, so nothing is red unless it is a Real upstream error", () => {
    expect(block).toMatch(/\.pgc-fd[^{]*\{[^}]*--accent: var\(--text\)/);
    expect(block).toMatch(/\.pgc-fd:not\(\.pgc-fd--red\)[^{]*\{\s*--danger-text: var\(--status-warn\)/);
  });
  test("the new rules use theme tokens only: no colour literal, no purple", () => {
    const noUrl = block.replace(/url\("data:[^"]*"\)/g, "");
    expect(noUrl).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(noUrl).not.toMatch(/purple|violet|indigo|lavender|magenta/i);
  });
  test("a refusal frame gets a lock and keeps its word (only on a refusal, never on an upstream failure)", () => {
    expect(block).toMatch(/\.pgc-fd--refusal \.rl-f\[data-verdict="deny"\]/);
    expect(block).toMatch(/\.rl-f\[data-verdict="deny"\] \.rl-f__st::before/);
    expect(block).toMatch(/\.ev-tag\[data-state="bad"\]::before/);
  });
});

describe("colour rules for a failed hop (static)", () => {
  test("an error hop's word and sequence label use --danger-text (amber unless the run is a Real upstream failure) and carry no lock", () => {
    expect(css).toMatch(/\.pgc-fd \.rl-f\[data-verdict="error"\] \.rl-f__st \{ color: var\(--danger-text\)/);
    expect(css).toMatch(/\.pgc-fd \.sq-row\[data-verdict="error"\] \.sq-al \{ fill: var\(--danger-text\)/);
    expect(css).not.toMatch(/data-verdict="error"\][^{]*::before/);
  });
});

describe("PanelDock on its own", () => {
  test("the talk track slot is enabled only when a handler is given (step 2c)", () => {
    const stepper = { counter: "No run yet" };
    const { rerender } = render(<PanelDock run={null} stepper={stepper} />);
    expect(screen.getByTestId("dock-talk")).toBeDisabled();
    const fn = vi.fn();
    rerender(<PanelDock run={null} stepper={stepper} onTalkTrack={fn} />);
    fireEvent.click(screen.getByTestId("dock-talk"));
    expect(fn).toHaveBeenCalled();
  });

  test("on a phone only one panel is open at a time", async () => {
    const mm = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width: 600px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      await mount();
      open("reel"); open("trace");
      expect(screen.queryByTestId("panel-reel")).toBeNull();
      expect(screen.getByTestId("panel-trace")).toBeInTheDocument();
      expect(screen.getByTestId("panel-trace")).toHaveAttribute("data-narrow", "true"); // the bottom sheet
    } finally { window.matchMedia = mm; }
  });
});
