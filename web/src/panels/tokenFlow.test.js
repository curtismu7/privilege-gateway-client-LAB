import { describe, expect, test } from "vitest";
import { createTestApi } from "../testLab.js";
import { buildTokenFlow, claimChanges, compareTokens, summaryOf } from "./tokenFlow.js";

// A tiny JWT-shaped string whose two segments decode to the given objects (test data only; the signature is junk).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims, header = { alg: "HS256", typ: "JWT" }) => `${b64(header)}.${b64(claims)}.c2ln-${b64(claims).slice(-6)}`;

describe("claimChanges", () => {
  test("added, removed, changed and same, in that order", () => {
    const rows = claimChanges({ sub: "a", aud: "x", scope: "tools", gone: 1 }, { sub: "a", aud: "y", scope: "tools", fresh: true });
    expect(rows.map((r) => [r.claim, r.status])).toEqual([["fresh", "added"], ["gone", "removed"], ["aud", "changed"], ["sub", "same"], ["scope", "same"]]);
    expect(rows.find((r) => r.claim === "aud")).toMatchObject({ before: "x", after: "y" });
  });
  test("an array or object claim is compared by value, not by reference", () => {
    expect(claimChanges({ act: { sub: "a" }, aud: ["x", "y"] }, { act: { sub: "a" }, aud: ["x", "y"] }).every((r) => r.status === "same")).toBe(true);
    expect(claimChanges({ aud: ["x"] }, { aud: ["x", "y"] })[0].status).toBe("changed");
  });
});

describe("compareTokens", () => {
  const t = (claims) => ({ claims, raw: jwt(claims) });
  test("the first token has no before", () => {
    expect(compareTokens(null, t({ sub: "a" })).kind).toBe("first");
  });
  test("identical token: same; same claims but another signature: same and resigned", () => {
    const a = t({ sub: "a" });
    expect(compareTokens(a, { ...a })).toMatchObject({ kind: "same", resigned: false });
    expect(compareTokens(a, { claims: { sub: "a" }, raw: `${a.raw}x` })).toMatchObject({ kind: "same", resigned: true });
  });
  test("a difference in any claim is changed, with counts", () => {
    const c = compareTokens(t({ sub: "a", aud: "x" }), t({ sub: "a", aud: "y", scope: "s" }));
    expect(c).toMatchObject({ kind: "changed", counts: { added: 1, removed: 0, changed: 1, same: 1 } });
    expect(summaryOf(c)).toBe("1 added, 0 removed, 1 changed");
  });
});

describe("buildTokenFlow on a real Mock run", () => {
  const { api, lab } = createTestApi();
  test("the token issued by the exchange is the first token; the introspection of it is the same token", async () => {
    const a = lab.info().catalog.find((x) => x.name === "list_entitlements").args;
    const run = await api("/api/call", { method: "POST", body: { door: "lab-banking-full", tool: "list_entitlements", arguments: a } });
    const flow = buildTokenFlow(run.hops);
    expect(flow.map((f) => f.hop.n)).toEqual(run.hops.filter((h) => h.verdict !== "skip").map((h) => h.n));
    const withTokens = flow.filter((f) => f.tokens.length);
    expect(withTokens.length).toBeGreaterThan(1);
    expect(withTokens[0].tokens[0].change.kind).toBe("first");
    const second = withTokens[1].tokens[0];
    expect(second.change.kind).toBe("same");
    // the introspection answer is the same claims plus `active`: shown as claims only, with one claim added
    const intro = withTokens[1].tokens.find((x) => x.claimsOnly);
    expect(intro.change).toMatchObject({ kind: "changed", counts: { added: 1, removed: 0, changed: 0 } });
    expect(intro.change.claims[0]).toMatchObject({ claim: "active", status: "added" });
    // every decoded token is a real decoded object, never a verified one
    for (const f of withTokens) for (const tk of f.tokens) { expect(tk.claims.mock).toBe(true); if (!tk.claimsOnly) { expect(tk.header.alg).toBeTruthy(); expect(tk.signature).toBeTruthy(); } }
  });
  test("no hops: nothing", () => {
    expect(buildTokenFlow(undefined)).toEqual([]);
    expect(buildTokenFlow([])).toEqual([]);
  });
});
