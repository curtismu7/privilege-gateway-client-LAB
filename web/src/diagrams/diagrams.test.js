// The call-path diagram is DATA (diagrams/pgc-call-path.json, diagram-studio/1), loaded by name and validated here; the page draws what the data says.
// Rule 17 in tests: the file validates, the validator refuses what is wrong, every hop a real run produces finds its step, and no source file builds a
// node or an arrow by hand.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validateDiagram, SCHEMA } from "./diagramSchema.js";
import { checked, diagramNames, loadDiagram } from "./loadDiagram.js";
import { CALL_PATH, callPathDiagram, graphOf, outcomeNode, pathEdges, stepForHop } from "./callPath.js";
import { createTestApi } from "../testLab.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const file = JSON.parse(readFileSync(join(root, "diagrams", "pgc-call-path.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(file));
const problems = (mutate) => { const d = clone(); mutate(d); return validateDiagram(d); };

describe("the diagram file and its loader", () => {
  test("pgc-call-path.json is a valid diagram-studio/1 document and is loaded by name", () => {
    expect(file.schema).toBe(SCHEMA);
    expect(validateDiagram(file)).toEqual([]);
    expect(diagramNames()).toContain(CALL_PATH);
    expect(loadDiagram(CALL_PATH)).toEqual(file);
    expect(callPathDiagram()).toEqual(file);
  });
  test("an unknown name, a non-string and an invalid file load as null (never a throw)", () => {
    expect(loadDiagram("nope")).toBeNull();
    expect(loadDiagram(undefined)).toBeNull();
    expect(loadDiagram("__proto__")).toBeNull();
  });
  test("it draws the four outcomes and the boxes the owner asked for, and no red group", () => {
    const ids = file.nodes.map((n) => n.id);
    for (const id of ["browser", "lab", "door", "policy", "mcp", "verdict-allowed", "verdict-blocked", "verdict-held", "verdict-upstream"]) expect(ids).toContain(id);
    for (const g of Object.values(file.groups)) expect(g.color).not.toBe("red");
    for (const e of file.edges) expect(e.color).not.toBe("red");
  });
  test("every arrow is walked by a step, every box has an arrow, and step hops are unique", () => {
    const used = new Set(file.steps.flatMap((s) => s.edges));
    file.edges.forEach((_, i) => expect(used.has(i), `edge ${i} is on no step`).toBe(true));
    const touched = new Set(file.edges.flatMap((e) => [e.source, e.target]));
    file.nodes.forEach((n) => expect(touched.has(n.id), `${n.id} has no arrow`).toBe(true));
    const hops = file.steps.map((s) => s.hop);
    expect(hops.every(Boolean)).toBe(true);
    expect(new Set(hops).size).toBe(hops.length);
  });
  test("every step hop is a kind of the shared catalog (the vendored one) or a verdict form of one", async () => {
    const catalog = (await import("../../../server/src/vendor/hop-catalog.json")).default;
    for (const s of file.steps) {
      const kind = s.hop.split(":")[0];
      expect(Object.hasOwn(catalog.kinds, kind), `${s.hop} is not a hop kind`).toBe(true);
    }
  });
  test("graphOf is the kit's graph: boxes, arrows with their labels, groups", () => {
    const g = graphOf(file);
    expect(g.nodes).toHaveLength(file.nodes.length);
    expect(g.edges.map((e) => e.label)).toEqual(file.edges.map((e) => e.label));
    expect(g.groups).toBe(file.groups);
  });
});

describe("the validator (this lab's own copy of the studio's limits)", () => {
  test("refuses a wrong schema, an unknown group, a duplicate id, a bad arrow and a bad step", () => {
    expect(problems((d) => { d.schema = "diagram-studio/2"; })).toEqual(expect.arrayContaining([expect.stringContaining("schema")]));
    expect(problems((d) => { d.nodes[0].group = "nope"; })).toEqual(expect.arrayContaining([expect.stringContaining("unknown group")]));
    expect(problems((d) => { d.nodes[1].id = d.nodes[0].id; })).toEqual(expect.arrayContaining([expect.stringContaining("duplicate")]));
    expect(problems((d) => { d.edges[0].target = "nobody"; })).toEqual(expect.arrayContaining([expect.stringContaining("unknown source or target")]));
    expect(problems((d) => { d.steps[0].edges = [99]; })).toEqual(expect.arrayContaining([expect.stringContaining("valid arrow numbers")]));
    expect(problems((d) => { d.steps[0].hop = "has space"; })).toEqual(expect.arrayContaining([expect.stringContaining("hop must be")]));
    expect(problems((d) => { d.edges[0].label = "x".repeat(161); })).toEqual(expect.arrayContaining([expect.stringContaining("label max 160")]));
    expect(problems((d) => { d.groups.page.color = "pink"; })).toEqual(expect.arrayContaining([expect.stringContaining("colour")]));
    expect(problems((d) => { d.nodes[0].x = Infinity; })).toEqual(expect.arrayContaining([expect.stringContaining("x and y")]));
    expect(validateDiagram(null)).toEqual(["diagram must be an object"]);
    expect(validateDiagram([])).toEqual(["diagram must be an object"]);
  });
  test("refuses what this lab does not draw instead of drawing it wrongly", () => {
    expect(problems((d) => { d.layout = "sequence"; }).join()).toMatch(/layout is not drawn/);
    expect(problems((d) => { d.bands = []; }).join()).toMatch(/bands is not drawn/);
    expect(problems((d) => { d.steps[0].wire = {}; }).join()).toMatch(/wire is not drawn/);
    expect(problems((d) => { d.nodes[0].sources = [{ path: "a", line: 1 }]; }).join()).toMatch(/sources are not drawn/);
  });
  test("an invalid diagram does not load: the loader's gate hands back null for a file that fails validation, and the file itself for a good one", () => {
    expect(validateDiagram({ ...file, nodes: [] }).length).toBeGreaterThan(0);
    expect(checked({ ...file, nodes: [] })).toBeNull();
    expect(checked({ ...file, layout: "sequence" })).toBeNull();
    expect(checked(undefined)).toBeNull();
    expect(checked(file)).toBe(file);
  });
});

describe("mapping a run onto the diagram", () => {
  const d = file;
  const hop = (kind, verdict = "ok") => ({ kind, verdict });
  test("a hop finds its step by its shared kind, the verdict form first", () => {
    expect(d.steps[stepForHop(d, hop("door-picked"))].title).toMatch(/Pick a door/);
    expect(d.steps[stepForHop(d, hop("tool-dispatched", "ok"))].hop).toBe("tool-dispatched");
    expect(d.steps[stepForHop(d, hop("tool-dispatched", "error"))].hop).toBe("tool-dispatched:error");
    expect(d.steps[stepForHop(d, hop("tool-dispatched", "deny"))].hop, "a verdict with no step of its own finds the kind's step").toBe("tool-dispatched");
    expect(d.steps[stepForHop(d, hop("verdict"))].hop).toBe("verdict");
    expect(d.steps[stepForHop(d, hop("policy-check"))].hop).toBe("policy-check");
    expect(d.steps[stepForHop(d, hop("tool-call"))].hop).toBe("tool-call");
    expect(d.steps[stepForHop(d, hop("discover"))].hop).toBe("discover");
    expect(stepForHop(d, hop("website"))).toBe(-1);
    expect(stepForHop(d, hop("agent-reply"))).toBe(-1);
    expect(stepForHop(d, hop("sign-in"))).toBe(-1);
    expect(stepForHop(d, null)).toBe(-1);
    expect(stepForHop({ steps: undefined }, hop("door-picked"))).toBe(-1);
  });
  test("the outcome box is verdict-<id> when the diagram has one, else none", () => {
    expect(outcomeNode(d, "allowed")).toBe("verdict-allowed");
    expect(outcomeNode(d, "blocked")).toBe("verdict-blocked");
    expect(outcomeNode(d, "held")).toBe("verdict-held");
    expect(outcomeNode(d, "upstream")).toBe("verdict-upstream");
    expect(outcomeNode(d, "needs-sign-in")).toBeNull();
    expect(outcomeNode(d, "bad-request")).toBeNull();
    expect(outcomeNode(d, undefined)).toBeNull();
  });

  // The real lab core: every hop of every kind of run finds a step (an unmapped hop would show "no arrow of its own" for a hop that should have one).
  const U = { user: "aidemo" };
  const runs = [
    ["allowed", { door: "demo-all-tools", tool: "list_entitlements", args: U }],
    ["blocked", { door: "demo-blocked", tool: "list_entitlements", args: U }],
    ["blocked", { door: "demo-some-tools", tool: "sensitive_patient_records", args: { patient_id: "pat_4410" } }],
    ["held", { door: "demo-all-tools", tool: "open_ticket", args: { title: "Review access", action: "flag" } }],
    ["upstream", { door: "demo-all-tools", tool: "list_entitlements", args: U, scenario: "upstream-error" }],
    ["needs-sign-in", { door: "demo-all-tools", tool: "list_entitlements", args: U, scenario: "no-key" }],
  ];
  test.each(runs)("a %s run: every hop that ran has a step, the path leaves out what did not run", async (id, body) => {
    const t = createTestApi();
    const run = await t.api("/api/call", { method: "POST", body: { door: body.door, scenario: body.scenario, tool: body.tool, arguments: body.args } });
    const r = run.run ?? run;
    expect(r.verdict.id).toBe(id); // the run is the kind this case means
    for (const h of r.hops.filter((x) => x.verdict !== "skip")) expect(stepForHop(d, h), `${h.kind}:${h.verdict} (message ${h.n})`).toBeGreaterThanOrEqual(0);
    const path = pathEdges(d, r.hops);
    expect(path.has(0)).toBe(true); // the browser always asked
    expect(path.has(8)).toBe(true); // the verdict always came back
    if (r.verdict.id === "allowed") { expect(path.has(3)).toBe(true); expect(path.has(4)).toBe(true); expect(path.has(6)).toBe(false); }
    if (r.verdict.id === "blocked") { expect(path.has(6)).toBe(true); expect(path.has(3)).toBe(false); }
    if (r.verdict.id === "held") { expect(path.has(7)).toBe(true); expect(path.has(3)).toBe(false); }
    if (r.verdict.id === "upstream") { expect(path.has(5)).toBe(true); expect(path.has(4)).toBe(false); }
  });
  test("a skipped hop is not on the path, and bad input is an empty path", () => {
    expect([...pathEdges(d, [{ kind: "tool-dispatched", verdict: "skip" }])]).toEqual([]);
    expect([...pathEdges(d, undefined)]).toEqual([]);
  });
});

describe("rule 17: nothing is hand-built", () => {
  const SRC = join(here, "..");
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === "diagram-kit") return []; // the vendored kit is pinned and has its own tests
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const sources = walk(SRC).filter((p) => /\.(jsx?|mjs)$/.test(p) && !/\.test\.[jt]sx?$/.test(p));
  test("no source file declares a literal list of nodes or arrows, or a node with a literal position", () => {
    expect(sources.length).toBeGreaterThan(20);
    const HAND = [/\b(nodes|edges|initialNodes|initialEdges)\s*[=:]\s*\{?\s*\[\s*\{/, /position:\s*\{\s*x:\s*-?\d/, /\bnodes=\{\[/, /\bedges=\{\[/];
    for (const p of sources) {
      const text = readFileSync(p, "utf8");
      for (const re of HAND) expect(re.test(text), `${relative(SRC, p)} builds a node or arrow by hand (${re})`).toBe(false);
    }
  });
  test("the checker would catch a hand-built node (the guard is not vacuous)", () => {
    const bad = 'const nodes = [{ id: "a", position: { x: 0, y: 0 } }];';
    expect(/\b(nodes|edges|initialNodes|initialEdges)\s*[=:]\s*\{?\s*\[\s*\{/.test(bad)).toBe(true);
    expect(/position:\s*\{\s*x:\s*-?\d/.test(bad)).toBe(true);
  });
  test("no source names the forbidden diagram library (rule 5)", () => {
    const banned = new RegExp(["mer", "maid"].join(""), "i"); // spelled in two parts so this test file does not trip the repo-wide scan for the word
    for (const p of sources) expect(banned.test(readFileSync(p, "utf8")), relative(SRC, p)).toBe(false);
  });
});
