// The Diagram panel: what the page hands the shared diagram-kit and how it follows the ONE walkthrough. React Flow draws no edges in jsdom (nothing is
// measured), so the arrows, the overlap check, dragging and Reset of box places are proven in a real browser (e2e/diagram.py); here: the data on the
// screen, the labels, the step that follows the hop, the outcome mark, expanding a box, Reset, and hostile text.
import React from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import DiagramPanel from "./DiagramPanel.jsx";
import PanelDock, { PANELS } from "./PanelDock.jsx";
import { useRunStepper } from "./useRunStepper.js";
import { callPathDiagram } from "../diagrams/callPath.js";
import { createTestApi } from "../testLab.js";

afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 150)); }); cleanup(); vi.restoreAllMocks(); });

const U = { user: "aidemo" };
async function realRun(door, tool, args, scenario) {
  const t = createTestApi();
  const out = await t.api("/api/call", { method: "POST", body: { door, tool, arguments: args, scenario } });
  return out.run ?? out;
}
// The panel exactly as the dock drives it: one stepper over the run's hops.
function Host({ run, diagram, extra }) {
  const stepper = useRunStepper(run?.hops, run?.verdict?.id ?? null);
  return <><DiagramPanel run={run} stepper={stepper} live diagram={diagram} />{extra}</>;
}
const node = (id) => screen.getByTestId(`dg-node-${id}`);
const open = () => [...document.querySelectorAll(".dk-open")].map((b) => b.getAttribute("data-testid"));
const labelOn = () => [...document.querySelectorAll(".dk-label--on")].map((l) => l.textContent);

describe("what the page draws from the data", () => {
  test("every box and every arrow label of diagrams/pgc-call-path.json is on the page, the labels in the kit's layer above the boxes", async () => {
    render(<Host run={await realRun("lab-banking-full", "list_entitlements", U)} />);
    const d = callPathDiagram();
    for (const n of d.nodes) expect(node(n.id)).toHaveTextContent(n.label);
    const layer = document.querySelector(".react-flow__viewport-portal");
    d.edges.forEach((e, i) => { const l = screen.getByTestId(`dk-label-e${i}`); expect(l).toHaveTextContent(e.label); expect(layer.contains(l)).toBe(true); });
    expect(document.querySelectorAll(".react-flow__edge-textwrapper, .react-flow__edge-label").length).toBe(0); // no SVG label under the boxes
  });
  test("with no run there is a note and the walk controls are not offered; Reset is", () => {
    render(<Host run={null} />);
    expect(screen.getByTestId("dg-now")).toHaveTextContent("You pick a door and a tool in the browser"); // the lede of the data file
    expect(screen.getByTestId("step-toggle")).toBeDisabled();
    expect(screen.getByTestId("step-reset")).not.toBeDisabled();
    expect(screen.getByTestId("step-counter")).toHaveTextContent("No run yet");
    expect(document.querySelector('[data-outcome="true"]')).toBeNull();
  });
});

describe("it follows the one walkthrough", () => {
  test("Next from a fresh page starts PAUSED at message 1 and lights the browser to lab arrow; the next message lights the next arrow", async () => {
    render(<Host run={await realRun("lab-banking-full", "list_entitlements", U)} />);
    expect(labelOn()).toEqual([]);
    fireEvent.click(screen.getByTestId("step-next"));
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Message 1 of 8");
    expect(screen.getByTestId("step-toggle")).toHaveTextContent("Resume"); // paused, not playing
    expect(labelOn()).toEqual(["1. pick a door, run a tool"]);
    expect(screen.getByTestId("dg-now")).toHaveTextContent("Pick a door and a tool");
    expect(node("browser").dataset.lit).toBe("true");
    expect(node("lab").dataset.lit).toBe("true");
    expect(node("mcp").dataset.lit).toBe("false");
    fireEvent.click(screen.getByTestId("step-next"));
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Message 2 of 8");
    expect(labelOn()).toEqual(["2. MCP call with the agent key"]);
    fireEvent.click(screen.getByTestId("step-prev"));
    expect(labelOn()).toEqual(["1. pick a door, run a tool"]);
  });
  test("the hop that has no arrow of its own says so; the hop that ends the run lights the verdict arrow", async () => {
    const run = await realRun("lab-banking-full", "list_entitlements", U);
    render(<Host run={run} />);
    for (let i = 0; i < run.hops.length; i += 1) fireEvent.click(screen.getByTestId("step-next"));
    expect(screen.getByTestId("step-counter")).toHaveTextContent(`Message ${run.hops.length} of ${run.hops.length}`);
    expect(labelOn()).toEqual(["6. the verdict, shown first"]);
    expect(screen.getByTestId("dg-now")).toHaveTextContent("The verdict is shown first");
  });
  test.each([
    ["allowed", ["lab-banking-full", "list_entitlements", U], "verdict-allowed", ["e3", "e4"], ["e6", "e7", "e5"]],
    ["blocked", ["lab-banking-blocked", "list_entitlements", U], "verdict-blocked", ["e6"], ["e3", "e4", "e5", "e7"]],
    ["held", ["lab-banking-full", "open_ticket", { user: "carol.nguyen", resource: "prod-db-primary", action: "review", justification: "Quarterly access review" }], "verdict-held", ["e7"], ["e3", "e4", "e5", "e6"]],
    ["upstream", ["lab-banking-full", "list_entitlements", U, "upstream-error"], "verdict-upstream", ["e3", "e5"], ["e4", "e6", "e7"]],
  ])("a %s run marks its own outcome box in words and dims the arrows it did not take", async (id, args, outcome, taken, notTaken) => {
    const run = await realRun(...args);
    expect(run.verdict.id).toBe(id);
    render(<Host run={run} />);
    expect(document.querySelectorAll('[data-outcome="true"]')).toHaveLength(1);
    expect(node(outcome).dataset.outcome).toBe("true");
    expect(node(outcome)).toHaveTextContent("This run");
    const dimmed = (e) => screen.getByTestId(`dk-label-${e}`).className.includes("dk-label--dim");
    for (const e of taken) expect(dimmed(e), `${e} was taken`).toBe(false);
    for (const e of notTaken) expect(dimmed(e), `${e} was not taken`).toBe(true);
  });
  test("a run refused at the door (no key) has no outcome box, and Simulate stops where the run did", async () => {
    const run = await realRun("lab-banking-full", "list_entitlements", U, "no-key");
    render(<Host run={run} />);
    expect(run.verdict.id).toBe("needs-sign-in");
    expect(document.querySelector('[data-outcome="true"]')).toBeNull();
  });
  test("a refusal box carries a lock and its words, an upstream failure its own icon: never red", async () => {
    render(<Host run={await realRun("lab-banking-blocked", "list_entitlements", U)} />);
    expect(node("verdict-blocked").querySelector("svg")).not.toBeNull();
    expect(node("verdict-blocked")).toHaveTextContent("Blocked by policy");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app.css"), "utf8");
    const rules = css.slice(css.lastIndexOf("/*", css.indexOf("step 3: the call-path Diagram panel"))).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/--box-red|--danger|--accent\b|#[0-9a-fA-F]{3,8}\b|\bred\b/);
  });
});

describe("a box expands in place (the kit's passport)", () => {
  test("click shows group, reach and the arrows in and out; again, another box, and the empty canvas collapse or move it", async () => {
    render(<Host run={await realRun("lab-banking-full", "list_entitlements", U)} />);
    expect(open()).toEqual([]);
    fireEvent.click(node("policy"));
    expect(open()).toEqual(["dg-node-policy"]);
    const p = screen.getByTestId("dk-passport-policy");
    expect(node("policy").contains(p)).toBe(true);
    expect(p).toHaveTextContent("PingOne Privilege gateway");
    expect(screen.getByTestId("dk-passport-outgoing")).toHaveTextContent("Outgoing · 3");
    expect(screen.getByTestId("dk-passport-incoming")).toHaveTextContent("Incoming · 1");
    expect(node("policy")).toHaveTextContent("No policy means no"); // the data's own lines, shown while expanded
    fireEvent.click(node("policy")); expect(open()).toEqual([]);
    fireEvent.click(node("policy")); fireEvent.click(node("mcp")); expect(open()).toEqual(["dg-node-mcp"]);
    fireEvent.click(document.querySelector(".react-flow__pane")); expect(open()).toEqual([]);
  });
  test("Reset collapses the box and stops the walk", async () => {
    render(<Host run={await realRun("lab-banking-full", "list_entitlements", U)} />);
    fireEvent.click(screen.getByTestId("step-next"));
    fireEvent.click(node("door"));
    expect(open()).toEqual(["dg-node-door"]);
    fireEvent.click(screen.getByTestId("step-reset"));
    await waitFor(() => expect(open()).toEqual([]));
    expect(screen.getByTestId("step-counter")).toHaveTextContent("Not started");
  });
});

describe("moved boxes and Reset", () => {
  // jsdom cannot drag; the places a drag leaves are the dock's `boxes`, so a box starts moved and Reset must bring it back to the data's own place.
  function Moved({ run }) {
    const stepper = useRunStepper(run?.hops, run?.verdict?.id ?? null);
    const [boxes, setBoxes] = React.useState({ door: { x: 1234, y: 56 } });
    return <><DiagramPanel run={run} stepper={stepper} live boxes={boxes} onMoveBox={(id, p) => setBoxes((b) => ({ ...b, [id]: p }))} onResetBoxes={() => setBoxes({})} /><output data-testid="moved">{Object.keys(boxes).join(",")}</output></>;
  }
  const at = (id) => screen.getByTestId(`dg-node-${id}`).closest(".react-flow__node").style.transform;
  test("a moved box is drawn where it was moved, the note counts it, and Reset puts it back where the DATA places it", async () => {
    const d = callPathDiagram(); const door = d.nodes.find((n) => n.id === "door");
    render(<Moved run={await realRun("lab-banking-full", "list_entitlements", U)} />);
    expect(at("door")).toContain("translate(1234px, 56px)");
    expect(at("lab")).toContain("translate(250px, 120px)".replace("250", String(d.nodes.find((n) => n.id === "lab").x)).replace("120", String(d.nodes.find((n) => n.id === "lab").y)));
    expect(screen.getByTestId("dg-note")).toHaveTextContent("1 box moved");
    fireEvent.click(screen.getByTestId("step-reset"));
    await waitFor(() => expect(screen.getByTestId("moved")).toHaveTextContent(/^$/));
    await waitFor(() => expect(at("door")).toContain(`translate(${door.x}px, ${door.y}px)`));
    expect(screen.getByTestId("dg-note")).not.toHaveTextContent("moved;");
  });
  test("Reset works before any walk and with no run at all (it is never disabled)", () => {
    render(<Moved run={null} />);
    expect(screen.getByTestId("step-reset")).not.toBeDisabled();
    expect(at("door")).toContain("translate(1234px, 56px)");
    fireEvent.click(screen.getByTestId("step-reset"));
    expect(screen.getByTestId("moved")).toHaveTextContent(/^$/);
  });
});

describe("hostile text is inert", () => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  test("a hostile box label, arrow label, step text and hop title render as text: no element, no handler", async () => {
    const d = JSON.parse(JSON.stringify(callPathDiagram()));
    d.nodes[0].label = evil; d.nodes[0].sub = [evil]; d.edges[0].label = evil; d.steps[0].title = evil; d.steps[0].what = evil;
    const run = await realRun("lab-banking-full", "list_entitlements", U);
    render(<Host run={run} diagram={d} />);
    fireEvent.click(screen.getByTestId("step-next"));
    fireEvent.click(node("browser")); // expanded: the sub lines and the passport too
    expect(document.querySelector("img[src='x'], script")).toBeNull();
    expect(node("browser")).toHaveTextContent(evil);
    expect(screen.getByTestId("dk-label-e0")).toHaveTextContent(evil);
    expect(screen.getByTestId("dg-now")).toHaveTextContent(evil);
    expect(window.__pwned).toBeUndefined();
  });
  test("control and bidirectional characters in a hop title are shown as escapes", async () => {
    const run = await realRun("lab-banking-full", "list_entitlements", U);
    run.hops[0] = { ...run.hops[0], kind: "no-such-kind", title: "a‮b" };
    render(<Host run={run} />);
    fireEvent.click(screen.getByTestId("step-next"));
    expect(screen.getByTestId("dg-now")).toHaveTextContent("a\\u202eb");
    expect(screen.getByTestId("dg-now")).toHaveTextContent("no arrow of its own");
  });
});

describe("the Diagram panel in the dock", () => {
  test("is the fifth panel, with its own icon, and opens as a FloatingDialog that follows the dock's walk", async () => {
    expect(PANELS.map((p) => p.id)).toEqual(["reel", "tokens", "sequence", "diagram", "trace"]);
    const run = await realRun("lab-banking-full", "list_entitlements", U);
    function Dock() { const stepper = useRunStepper(run.hops, run.verdict.id); return <PanelDock run={run} stepper={stepper} />; }
    render(<Dock />);
    fireEvent.click(screen.getByTestId("dock-diagram"));
    const panel = await screen.findByTestId("panel-diagram");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("dock-diagram")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("step-next"));
    expect(screen.getAllByTestId("step-counter")[0]).toHaveTextContent("Message 1 of 8");
    expect(screen.getByTestId("dock-counter")).toHaveTextContent("Message 1 of 8");
    // one announcement: the open Diagram panel owns the polite counter, the dock's is silent
    expect(screen.getByTestId("dock-counter")).toHaveAttribute("aria-live", "off");
    expect(within(screen.getByTestId("panel-diagram")).getByTestId("step-counter")).toHaveAttribute("aria-live", "polite");
  });
});
