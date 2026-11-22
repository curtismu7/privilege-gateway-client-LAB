import { decodedTokensIn } from "../json/JsonPane.jsx";

// The tokens in play at each hop, and what changed from one token to the next. Decoding is the vendored pane's (rule 24b): this file never
// reads a segment itself, and a decoded token is never called verified (the signature is shown as sent; the receiver checks it).
// Everything comes from the ordered demo-hop/1 array of the run: a hop's request and response. Real redacts on the server, so a Real run
// usually has no token to show, and the panel says so instead of inventing one.
const DEPTH = 8;

// Deep equality over decoded JSON, depth-limited (a claim is data, never code).
function same(a, b, depth = 0) {
  if (a === b) return true;
  if (depth > DEPTH || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k], depth + 1));
}

// Claim by claim: added, removed, changed or same, in the order added, removed, changed, same.
export function claimChanges(before = {}, after = {}) {
  const rows = [];
  for (const k of Object.keys(after)) {
    if (!Object.hasOwn(before, k)) rows.push({ claim: k, status: "added", after: after[k] });
    else rows.push({ claim: k, status: same(before[k], after[k]) ? "same" : "changed", before: before[k], after: after[k] });
  }
  for (const k of Object.keys(before)) if (!Object.hasOwn(after, k)) rows.push({ claim: k, status: "removed", before: before[k] });
  const order = { added: 0, removed: 1, changed: 2, same: 3 };
  return rows.sort((x, y) => order[x.status] - order[y.status]);
}

// How a token differs from the one before it in the run. kind: first | same | changed. A token with identical claims but another
// signature is "same" with resigned: true (the receiver would still see a different token).
export function compareTokens(prev, next) {
  if (!prev) return { kind: "first", claims: [], counts: { added: 0, removed: 0, changed: 0, same: 0 } };
  const claims = claimChanges(prev.claims, next.claims);
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const c of claims) counts[c.status] += 1;
  const identical = counts.added + counts.removed + counts.changed === 0;
  return { kind: identical ? "same" : "changed", claims, counts, resigned: identical && prev.raw !== next.raw };
}

// An introspection answer (RFC 7662) is the claim set the receiver learned from a token, with `active` added: it is not a token (no header, no
// signature) but it is what is "in play" at that hop, so it is compared like one and drawn as claims only.
const claimSetOf = (hop) => {
  const b = hop?.response?.body;
  return b && typeof b === "object" && !Array.isArray(b) && typeof b.active === "boolean" && typeof b.sub === "string"
    ? [{ name: "response.body", claimsOnly: true, raw: null, header: null, signature: null, claims: b }]
    : [];
};

// One entry per hop that ran: { hop, tokens: [{ name, raw, header, claims, signature, change }] }. The tokens of a hop are its request's
// then its response's; "the token before" is the previous token anywhere earlier in the run.
export function buildTokenFlow(hops = []) {
  let prev = null;
  return (Array.isArray(hops) ? hops : []).filter((h) => h.verdict !== "skip").map((hop) => {
    const found = [...decodedTokensIn(hop.request, "request"), ...decodedTokensIn(hop.response, "response"), ...claimSetOf(hop)];
    const tokens = found.map((t) => {
      const change = compareTokens(prev, t);
      prev = t;
      return { ...t, change };
    });
    return { hop, tokens };
  });
}

// The words for a change, used in text next to the icon (never colour alone).
export const CHANGE_WORD = { added: "Added", removed: "Removed", changed: "Changed", same: "Same" };
export function summaryOf(change) {
  if (change.kind === "first") return "First token in this run";
  if (change.kind === "same") return change.resigned ? "Same claims as the token before (signed again)" : "Same token as the one before";
  const { added, removed, changed } = change.counts;
  return [`${added} added`, `${removed} removed`, `${changed} changed`].join(", ");
}
