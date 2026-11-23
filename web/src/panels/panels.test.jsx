// The evidence views inline under the verdict (the dock was replaced by an inline tab row, shaped like the Appfire Agent Governance lab): the one
// walkthrough shared by the movie reel, the token sequence, the sequence view and the diagram, what each view shows for each kind of run, and the
// rules that bite (a refusal is never red, hostile text is inert, props only). jsdom has no layout: the pop-out window and the 375px sheet are proven
// in a real browser (e2e/panels.py).
import React from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App.jsx";
import EvidenceTabs, { PANELS } from "./EvidenceTabs.jsx";
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
const view = (id) => { click(`etab-${id}`); return tid(`epanel-${id}`); };
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.css"), "utf8");

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the evidence tab row", () => {
  test("one tab per view with an icon and a label; the selected view is drawn in place (no dialogs)", async () => {
    await mount();
    const row = tid("evidence-tabs");
    expect(within(row).getAllByRole("tab").map((b) => b.textContent)).toEqual(PANELS.map((p) => p.label));
    for (const b of within(row).getAllByRole("tab")) expect(b.querySelector("svg")).not.toBeNull();
    expect(tid("etab-reel")).toHaveAttribute("aria-selected", "true");
    for (const p of PANELS) {
      view(p.id);
      expect(tid(`epanel-${p.id}`)).toBeInTheDocument();
      expect(tid(`epanel-${p.id}`).getAttribute("role")).toBe("tabpanel");
      expect(tid(`epanel-${p.id}`).getAttribute("aria-labelledby")).toBe(`etab-${p.id}`);
    }
    expect(document.querySelector('[role="dialog"][data-testid^="panel-"]')).toBeNull(); // the views are not floating dialogs
  });

  test("the tablist follows the WAI-ARIA keyboard model: arrows and Home/End move between tabs", async () => {
    await mount();
    fireEvent.keyDown(tid("etab-reel"), { key: "ArrowRight" });
    expect(tid("etab-tokens")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tid("etab-tokens"), { key: "End" });
    expect(tid("etab-trace")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tid("etab-trace"), { key: "Home" });
    expect(tid("etab-reel")).toHaveAttribute("aria-selected", "true");
  });
});

describe("one walkthrough, five views", () => {
  test("Next from a fresh page starts paused at message 1 and the reel, the token sequence and the sequence view all follow that same hop", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    const reel = view("reel");
    expect(tid("evidence-counter")).toHaveTextContent("Not started, 8 messages");
    expect(within(reel).queryByTestId("step-detail")).toBeNull();
    click(within(reel).getByTestId("step-next"));
    expect(within(reel).getByTestId("step-counter")).toHaveTextContent("Message 1 of 8");
    expect(within(reel).getByTestId("step-toggle")).toHaveTextContent("Resume"); // paused, not playing
    expect(tid("frame-1")).toHaveAttribute("aria-current", "step");
    expect(within(reel).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 1 detail");
    // the token sequence follows the same walkthrough
    const tokens = view("tokens");
    expect(within(tokens).getByTestId("step-counter")).toHaveTextContent("Message 1 of 8");
    expect(tid("tokhop-1")).toHaveAttribute("data-on", "true");
    // a click on a sequence row moves the same walkthrough: the reel follows
    const seq = view("sequence");
    expect(within(seq).getByTestId("step-counter")).toHaveTextContent("Message 1 of 8");
    click(tid("row-4"));
    expect(tid("row-4")).toHaveAttribute("aria-current", "step");
    view("tokens");
    expect(tid("tokhop-4")).toHaveAttribute("data-on", "true");
    expect(within(tid("epanel-tokens")).getByTestId("step-counter")).toHaveTextContent("Message 4 of 8");
    view("reel");
    expect(tid("frame-4")).toHaveAttribute("aria-current", "step");
  });

  test("only one counter announces (aria-live polite): the stepped view's bar when a stepped view is on, else the row's counter", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    // the reel is the tab that opens with the row: its bar owns the announcement from the start
    const reel = tid("epanel-reel");
    expect(tid("evidence-counter")).toHaveAttribute("aria-live", "off");
    expect(within(reel).getByTestId("step-counter")).toHaveAttribute("aria-live", "polite");
    view("trace");
    expect(tid("evidence-counter")).toHaveAttribute("aria-live", "polite"); // the trace is not stepped: the row announces again
  });

  test("a new run starts the walk over in every view", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    const reel = view("reel");
    click(within(reel).getByTestId("step-next"));
    click(within(reel).getByTestId("step-next"));
    expect(tid("evidence-counter")).toHaveTextContent("Message 2 of 8");
    click("tab-tools"); click("tool-get_portfolio_summary"); click("run");
    await waitFor(() => expect(tid("evidence-counter")).toHaveTextContent("Not started, 8 messages"));
  });

  test("no run yet: each view says so, and the walkthrough buttons are disabled only because there is nothing to walk", async () => {
    await mount();
    view("reel");
    expect(tid("reel-none")).toBeInTheDocument();
    expect(within(tid("epanel-reel")).getByTestId("step-next")).toBeDisabled();
    expect(tid("evidence-counter")).toHaveTextContent("No run yet");
    view("tokens");
    expect(tid("tokens-none")).toBeInTheDocument();
    view("sequence");
    expect(tid("sequence-none")).toBeInTheDocument();
    view("trace");
    expect(tid("gateway-trace-empty")).toBeInTheDocument();
  });
});

describe("what each view shows for each kind of run", () => {
  test("blocked by policy: the reel stops at the Privilege decision and says denied; the run note says where Simulate stopped; the view is not the red kind", async () => {
    await mount();
    await runTool("demo-some-tools", "sensitive_tax_record");
    await waitWord("Blocked by policy");
    const reel = view("reel");
    click(within(reel).getByTestId("step-toggle")); // Simulate
    await waitFor(() => expect(within(reel).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    expect(tid("run-note")).toHaveAttribute("data-verdict", "blocked");
    expect(tid("run-note-word")).toHaveTextContent("Blocked by policy");
    expect(tid("run-note-stop")).toHaveTextContent(/Simulate stops at message \d+, Policy decision/);
    const on = document.querySelector('[data-testid="evidence-tabs"] .rl-f[aria-current="step"]');
    expect(on).toHaveAttribute("data-verdict", "deny");
    expect(on.textContent).toMatch(/denied/);
    expect(within(reel).getByTestId("sdp-status")).toHaveTextContent("denied");
    expect(tid("evidence-tabs").className).not.toContain("pgc-calm--red"); // amber, never red
    expect(tid("evidence-tabs").className).toContain("pgc-calm--refusal"); // with a lock beside the word
  }, 20000);

  test("held: stops waiting on the human, and says it is simulated", async () => {
    await mount();
    await runTool("demo-all-tools", "open_ticket");
    await waitWord("Held");
    const seq = view("sequence");
    click(within(seq).getByTestId("step-toggle"));
    await waitFor(() => expect(within(seq).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    expect(within(seq).getByTestId("step-counter")).toHaveTextContent("Message 7 of 8");
    expect(tid("row-7")).toHaveAttribute("aria-current", "step");
    expect(tid("row-7").getAttribute("aria-label")).toMatch(/Human approval/);
  }, 20000);

  test("an upstream error in Mock is not the red kind of view (red is for a real error; where it stops is covered by planRun)", async () => {
    await mount();
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "upstream-error" } });
    click("action-discover");
    await waitWord("Upstream error");
    view("reel");
    expect(tid("evidence-tabs").className).not.toContain("pgc-calm--red");
    expect(tid("evidence-tabs").className).not.toContain("pgc-calm--refusal"); // an upstream failure is not a refusal: no lock
  });

  test("an upstream failure reads 'failed', not 'denied': the failed frame is verdict error, Simulate stops on it, no frame says denied", async () => {
    await mount();
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "upstream-error" } });
    click("action-discover");
    await waitWord("Upstream error");
    const reel = view("reel");
    click(within(reel).getByTestId("step-toggle")); // Simulate
    await waitFor(() => expect(within(reel).getByTestId("step-toggle")).toHaveTextContent("Replay"), { timeout: 15000 });
    const on = document.querySelector('[data-testid="evidence-tabs"] .rl-f[aria-current="step"]');
    expect(on).toHaveAttribute("data-verdict", "error");
    expect(on.textContent).toMatch(/failed/);
    expect(on.textContent).not.toMatch(/denied/);
    expect(within(reel).getByTestId("sdp-status")).toHaveTextContent("failed");
    expect(document.querySelector('[data-testid="evidence-tabs"] .rl-f[data-verdict="deny"]')).toBeNull();
    expect(tid("evidence-tabs").className).not.toContain("pgc-calm--red"); // amber with the word in Mock, never red
  }, 20000);

  test("a blocked door: the reel ends at its decision, hops that did not run sit behind the 'not in this run' chip", async () => {
    await mount();
    click("door-demo-blocked");
    click("action-discover");
    await waitWord("Blocked by policy");
    view("reel");
    expect(within(tid("epanel-reel")).getByRole("button", { name: /hops not in this run/ })).toBeInTheDocument();
    expect(within(tid("epanel-reel")).getByTestId("step-counter")).toHaveTextContent("Not started, 4 messages");
  });

  test("the simulated identity mismatch shows both identities in the view", async () => {
    await mount({ session: { source: "mock-persona", id: "demouser", name: "demouser", email: "demouser@example.com", expiresAt: new Date(Date.now() + 3600e3).toISOString() } });
    click("door-demo-all-tools");
    fireEvent.change(document.getElementById("pgc-scenario"), { target: { value: "identity-mismatch" } });
    await runTool("demo-all-tools", "list_entitlements");
    view("reel");
    const ids = tid("run-note-identities");
    expect(ids).toHaveTextContent(/Page login \(SIMULATED scenario\)/);
    expect(ids).toHaveTextContent("demouser");
    expect(ids).toHaveTextContent(/Identity the gateway evaluated/);
    expect(ids).toHaveTextContent("aidemo");
  });

  test("Gateway trace is the shared GatewayTrace with Mock decisions 'checked'", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    view("trace");
    const tr = within(tid("epanel-trace")).getByTestId("gateway-trace");
    expect(tr).toHaveTextContent("What Privilege did");
    expect(tr.textContent).toMatch(/Simulated: the lab's in-process gateway/);
  });
});

describe("switching mode or resetting with the views on", () => {
  const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "demo-all-tools", PGC_GW_KEY_DEMO_ALL_TOOLS: "test-only-key" };
  test("a Mock/Real switch remounts the row (N5) and starts the walk over; the new mode's views are empty", async () => {
    await mount({ env: REAL_ENV });
    await runTool("demo-all-tools", "list_entitlements");
    const reel = view("reel"); view("tokens");
    click(within(reel).getByTestId("step-next"));
    expect(tid("evidence-counter")).toHaveTextContent("Message 1 of 8");
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(tid("evidence-counter")).toHaveTextContent("No run yet");
    view("tokens");
    expect(tid("tokens-none")).toBeInTheDocument();
  });
  test("Reset in the header clears the run and the walk: the row's counter reads No run yet", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    const seq = view("sequence");
    click(within(seq).getByTestId("step-next"));
    expect(tid("evidence-counter")).toHaveTextContent("Message 1 of");
    click("reset");
    await waitFor(() => expect(tid("evidence-counter")).toHaveTextContent("No run yet"));
    click("etab-sequence");
    expect(tid("sequence-none")).toBeInTheDocument();
  });
});

describe("token sequence", () => {
  test("Mock: labelled MOCK, decoded by the vendored pane (Header, Payload, Signature), 'first / same / changed' as words and an icon, spec chips, illustrative hops tagged", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    const panel = view("tokens");
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
    const panel = view("tokens");
    click(within(panel).getByTestId("tokhop-3").querySelector("button"));
    expect(tid("epanel-tokens").textContent).not.toMatch(/signature (is )?(valid|verified)|✓ verified/i);
  });

  test("Real: no token is invented; the view says only an agent key is held and it is never shown", () => {
    const run = { id: "r", source: "real", simulated: false, verdict: { id: "allowed", word: "Allowed", sentence: "ok" }, hops: [{ n: 1, kind: "door-picked", from: "browser", to: "lab", verdict: "ok", title: "Door picked", request: { headers: { Authorization: "Bearer <agent key, 42 characters, kept on the server>" } }, response: {} }] };
    const Wrap = () => { const s = useRunStepper(run.hops, "allowed"); return <TokensPanel run={run} stepper={s} live />; };
    render(<Wrap />);
    expect(screen.getByTestId("tokens-intro")).toHaveTextContent(/Real: this lab only holds an agent key/);
    expect(screen.getByTestId("tokens-intro")).toHaveTextContent(/No token came back/);
    expect(screen.queryByText("MOCK")).toBeNull();
  });
});

describe("hostile input stays inert, and views are props only", () => {
  test("a hostile string in the arguments reaches the step detail as text: no element, no handler", async () => {
    const hostile = '<img src=x onerror=alert(1)> and <script>window.__pwn=1</script>';
    await mount();
    await runTool("demo-all-tools", "list_entitlements", { text: JSON.stringify({ user: hostile }) });
    const reel = view("reel");
    click(within(reel).getByTestId("step-next"));
    click(tid("frame-5"));
    expect(tid("epanel-reel").querySelector("img[src='x']")).toBeNull();
    expect(tid("epanel-reel").querySelector("script")).toBeNull();
    expect(tid("epanel-reel").textContent).toContain("<img src=x onerror=alert(1)>");
    expect(window.__pwn).toBeUndefined();
    for (const id of ["tokens", "sequence", "trace"]) {
      view(id);
      const el = tid(`epanel-${id}`);
      expect(el.querySelector("img[src='x']")).toBeNull();
      expect(el.querySelector("script")).toBeNull();
    }
  });

  test("a view body needs only its props: it renders in a bare tree with no provider", async () => {
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
  test("it is a non-modal FloatingDialog, off until switched on from the Sequence view, it follows the walked message, and closing hides it", async () => {
    await mount();
    await runTool("demo-all-tools", "list_entitlements");
    view("sequence");
    expect(screen.queryByTestId("panel-detail")).toBeNull();
    click(within(tid("epanel-sequence")).getByTestId("detail-toggle"));
    const dlg = tid("panel-detail");
    expect(dlg).not.toHaveAttribute("aria-modal");
    expect(within(dlg).getByTestId("detail-pick")).toBeInTheDocument();
    click(within(tid("epanel-sequence")).getByTestId("step-next"));
    expect(within(tid("panel-detail")).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 1 detail");
    click(within(tid("epanel-sequence")).getByTestId("step-next"));
    expect(within(tid("panel-detail")).getByTestId("step-detail")).toHaveAttribute("aria-label", "Step 2 detail");
    // the stepper controls are never covered by a backdrop
    expect(document.querySelector(".fd-backdrop")).toBeNull();
    click(within(tid("panel-detail")).getByRole("button", { name: /^Close Step detail/ }));
    expect(screen.queryByTestId("panel-detail")).toBeNull();
    expect(within(tid("epanel-sequence")).getByTestId("detail-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("colour rules for the views (static)", () => {
  const block = css.slice(css.indexOf("/* ---- evidence views"));
  test("the inline row carries the calm look (the refusal and red variants come from runLook, like the page's own tabs)", () => {
    expect(css).toMatch(/\.pgc-calm:not\(\.pgc-calm--red\)/);
  });
  test("the new rules use theme tokens only: no colour literal, no purple", () => {
    const noUrl = block.replace(/url\("data:[^"]*"\)/g, "");
    expect(noUrl).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(noUrl).not.toMatch(/purple|violet|indigo|lavender|magenta/i);
  });
  test("a refusal frame gets a lock and keeps its word (only on a refusal, never on an upstream failure)", () => {
    expect(block).toMatch(/\.pgc-calm--refusal \.gw-chip\[data-outcome="fail"\]/);
    expect(css).toMatch(/\.pgc-fd--refusal \.rl-f\[data-verdict="deny"\]/);
    expect(css).toMatch(/\.rl-f\[data-verdict="deny"\] \.rl-f__st::before/);
    expect(css).toMatch(/\.ev-tag\[data-state="bad"\]::before/);
  });
});

describe("colour rules for a failed hop (static)", () => {
  test("an error hop's word and sequence label use --danger-text (amber unless the run is a Real upstream failure) and carry no lock", () => {
    expect(css).toMatch(/\.pgc-fd \.rl-f\[data-verdict="error"\] \.rl-f__st \{ color: var\(--danger-text\)/);
    expect(css).toMatch(/\.pgc-fd \.sq-row\[data-verdict="error"\] \.sq-al \{ fill: var\(--danger-text\)/);
    expect(css).not.toMatch(/data-verdict="error"\][^{]*::before/);
  });
});
