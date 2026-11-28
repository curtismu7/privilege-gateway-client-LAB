// The call-path diagram as a function of the diagram DATA (diagrams/pgc-call-path.json) and the run's hops. Pure: no React, no DOM.
// Nothing about the drawing is decided here by hand: the boxes, arrows and steps are the file's; this only maps a run onto them.
import { loadDiagram } from "./loadDiagram.js";

export const CALL_PATH = "pgc-call-path";

/** The diagram as the kit's graph ({ nodes, edges, groups }): a diagram-studio/1 document already is one. `hops` (the run's hops, optional)
 * ride on the edges their step walks: the expanded box shows the run's API calls under Sent / Received (the kit's Passport, JsonView required). */
export function graphOf(d, hops = []) {
  // step index -> the edges it walks; each run hop lands on its step's edges (the same rule pathEdges uses).
  const byStep = new Map();
  for (const h of Array.isArray(hops) ? hops : []) {
    if (h.verdict === "skip") continue;
    const i = stepForHop(d, h);
    if (i < 0) continue;
    const call = {
      title: h.label ?? h.kind, fact: h.fact ?? "", verdict: h.verdict === "ok" ? "ok" : h.verdict === "deny" ? "deny" : h.verdict,
      request: h.request, response: h.response,
    };
    for (const e of d.steps[i].edges) (byStep.get(e) ?? byStep.set(e, []).get(e)).push(call);
  }
  return {
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, sub: n.sub, group: n.group })),
    edges: d.edges.map((e, i) => {
      const calls = byStep.get(i);
      return { source: e.source, target: e.target, label: e.label, ...(calls ? { hop: calls[0] } : {}) };
    }),
    groups: d.groups,
  };
}

/** The step (index into d.steps) a hop is the walk of, or -1. A step names its hop as `kind` or `kind:verdict` (the verdict form is tried first), with the shared hop-catalog kinds. */
export function stepForHop(d, hop) {
  if (!hop || !Array.isArray(d.steps)) return -1;
  for (const name of [`${hop.kind}:${hop.verdict}`, hop.kind]) {
    const i = d.steps.findIndex((s) => s.hop === name);
    if (i >= 0) return i;
  }
  return -1;
}

/** The arrows (indexes) the run's hops went along: every arrow of the step of each hop that ran. Hops that did not run (verdict skip) are not on the path. */
export function pathEdges(d, hops) {
  const out = new Set();
  for (const h of Array.isArray(hops) ? hops : []) {
    if (h.verdict === "skip") continue;
    const i = stepForHop(d, h);
    if (i >= 0) for (const e of d.steps[i].edges) out.add(e);
  }
  return out;
}

/** The box that is this run's outcome (`verdict-<id>`), or null (a run refused at the door or a bad request has no outcome box). */
export const outcomeNode = (d, verdictId) => (d.nodes.find((n) => n.id === `verdict-${verdictId}`) ? `verdict-${verdictId}` : null);

export const callPathDiagram = () => loadDiagram(CALL_PATH);
