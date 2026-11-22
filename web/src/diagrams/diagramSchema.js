// A check for diagram-studio/1 documents, the shared diagram data format (STANDALONE-RULES rule 17). This is this lab's own copy: it follows the limits of
// the studio's validator (core/src/validate.js) for the parts of the format a flow-layout diagram uses, and has no import from another repo.
// It REFUSES what this lab does not draw (sequence layout, bands, notes, blocks, wire, refs, sources) instead of ignoring it, so a diagram that
// needs them cannot be loaded and drawn wrongly. It returns a list of problems; empty means valid. It never throws.
export const SCHEMA = "diagram-studio/1";
export const COLORS = ["red", "dark", "grey", "blue", "green", "amber"];
export const LIMITS = { nodes: 60, edges: 120, steps: 120, groups: 8, sub: 6 };
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const HOP = /^[A-Za-z0-9._:/-]{1,64}$/;
const REFUSED = ["layout", "bands", "notes", "blocks", "repo"];
const REFUSED_STEP = ["wire", "refs", "story"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const num = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 20000;

export function validateDiagram(d) {
  const p = [];
  if (!isObj(d)) return ["diagram must be an object"];
  if (d.schema !== SCHEMA) p.push(`schema must be "${SCHEMA}"`);
  for (const k of REFUSED) if (d[k] !== undefined) p.push(`${k} is not drawn by this lab`);
  if (typeof d.id !== "string" || !ID.test(d.id) || d.id.length > 48) p.push("bad id");
  if (!text(d.title, 120)) p.push("title is required (max 120)");
  if (d.lede !== undefined && (typeof d.lede !== "string" || d.lede.length > 600)) p.push("lede must be text (max 600)");
  const groups = isObj(d.groups) ? d.groups : {};
  if (!Object.keys(groups).length) p.push("at least one group");
  if (Object.keys(groups).length > LIMITS.groups) p.push(`at most ${LIMITS.groups} groups`);
  for (const [k, g] of Object.entries(groups)) {
    if (!ID.test(k)) p.push(`group key "${k}" is not an id`);
    if (!isObj(g) || !text(g.label, 80) || !COLORS.includes(g.color)) p.push(`group "${k}" needs a label and a known colour`);
  }
  const ids = new Set();
  if (!Array.isArray(d.nodes) || !d.nodes.length || d.nodes.length > LIMITS.nodes) p.push(`nodes: 1 to ${LIMITS.nodes}`);
  else for (const [i, n] of d.nodes.entries()) {
    const at = `node ${i + 1}`;
    if (!isObj(n)) { p.push(`${at} must be an object`); continue; }
    if (typeof n.id !== "string" || !ID.test(n.id) || ids.has(n.id)) p.push(`${at}: bad or duplicate id`);
    else ids.add(n.id);
    if (!text(n.label, 80)) p.push(`${at}: label is required (max 80)`);
    if (!Object.hasOwn(groups, n.group)) p.push(`${at}: unknown group`);
    if (n.sub !== undefined && (!Array.isArray(n.sub) || n.sub.length > LIMITS.sub || !n.sub.every((s) => typeof s === "string" && s.length <= 120))) p.push(`${at}: sub is up to ${LIMITS.sub} short lines`);
    if (n.sources !== undefined) p.push(`${at}: sources are not drawn by this lab`);
    if (!num(n.x) || !num(n.y)) p.push(`${at}: x and y must be numbers`);
  }
  if (!Array.isArray(d.edges) || d.edges.length > LIMITS.edges) p.push(`edges: an array of at most ${LIMITS.edges}`);
  else for (const [i, e] of d.edges.entries()) {
    const at = `edge ${i + 1}`;
    if (!isObj(e) || !ids.has(e.source) || !ids.has(e.target)) { p.push(`${at}: unknown source or target`); continue; }
    if (e.label !== undefined && (typeof e.label !== "string" || e.label.length > 160)) p.push(`${at}: label max 160`);
    if (e.dashed !== undefined && typeof e.dashed !== "boolean") p.push(`${at}: dashed must be true or false`);
    if (e.color !== undefined && !COLORS.includes(e.color)) p.push(`${at}: colour must be one of ${COLORS.join(", ")}`);
  }
  if (d.steps !== undefined) {
    if (!Array.isArray(d.steps) || d.steps.length > LIMITS.steps) p.push(`steps: an array of at most ${LIMITS.steps}`);
    else for (const [i, s] of d.steps.entries()) {
      const at = `step ${i + 1}`;
      if (!isObj(s) || !text(s.title, 120)) { p.push(`${at}: title is required`); continue; }
      if (typeof s.what !== "string" || s.what.length > 600) p.push(`${at}: what must be text (max 600)`);
      if (s.why !== undefined && (typeof s.why !== "string" || s.why.length > 600)) p.push(`${at}: why must be text (max 600)`);
      if (s.hop !== undefined && !(typeof s.hop === "string" && HOP.test(s.hop))) p.push(`${at}: hop must be a short id (letters, digits . _ : / -)`);
      for (const k of REFUSED_STEP) if (s[k] !== undefined) p.push(`${at}: ${k} is not drawn by this lab`);
      const n = Array.isArray(d.edges) ? d.edges.length : 0;
      if (!Array.isArray(s.edges) || !s.edges.every((x) => Number.isInteger(x) && x >= 0 && x < n)) p.push(`${at}: edges must be valid arrow numbers`);
    }
  }
  return p;
}
