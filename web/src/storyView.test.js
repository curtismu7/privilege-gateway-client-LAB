import { describe, expect, test } from "vitest";
import { badStoryParam, runMatches, storyBlock, storyCheck, storyIdFromSearch, storyOptionLabel } from "./storyView.js";
import { signInState } from "./signinView.js";
import { readWorkspace } from "./api.js";
import { seedTalkPlace } from "./panels/talkPlace.js";

const info = (source, ids = ["lab-banking-full", "lab-banking-limited", "lab-banking-blocked"]) => ({ source, doors: ids.map((id) => ({ id })) });
const S = { id: "S04", title: "A write that waits", door: "lab-banking-full", mockOnly: true, run: { action: "call", door: "lab-banking-full", tool: "open_ticket" }, expect: { verdict: "held" } };

describe("?story= parsing", () => {
  test("only S followed by two digits is a story id; everything else is null and flagged", () => {
    expect(storyIdFromSearch("?story=S03")).toBe("S03");
    expect(storyIdFromSearch("?x=1&story=S06&y=2")).toBe("S06");
    for (const bad of ["?story=S3", "?story=s03", "?story=S03x", "?story=<img src=x onerror=alert(1)>", "?story=", "?story=S03%0A", "", "?other=S01"]) expect(storyIdFromSearch(bad), bad).toBeNull();
    expect(badStoryParam("?story=S99")).toBe(false); // a well-formed id the list does not have is the list's business
    expect(badStoryParam("?story=nope")).toBe(true);
    expect(badStoryParam("?story=")).toBe(true);
    expect(badStoryParam("")).toBe(false);
    expect(badStoryParam("?a=b")).toBe(false);
  });
});

describe("what can run", () => {
  test("a Mock-only story is blocked in Real with the reason; a missing door blocks; Mock runs everything", () => {
    expect(storyBlock(S, info("mock"))).toBeNull();
    expect(storyBlock(S, info("real"))).toMatch(/runs in Mock only/);
    expect(storyBlock({ ...S, mockOnly: false }, info("real", ["some-other-door"]))).toMatch(/lab-banking-full.*not one of the doors.*Real/);
    expect(storyBlock({ ...S, mockOnly: false }, info("real", ["lab-banking-full"]))).toBeNull();
    expect(storyBlock(S, null)).toMatch(/not loaded/);
    expect(storyBlock(null, info("mock"))).toMatch(/not loaded/);
  });
  test("the option label marks Mock-only stories only in Real", () => {
    expect(storyOptionLabel(S, info("mock"))).toBe("S04  A write that waits");
    expect(storyOptionLabel(S, info("real"))).toBe("S04  A write that waits (Mock only)");
  });
});

describe("the check line", () => {
  const run = { action: "call", door: "lab-banking-full", tool: "open_ticket", scenario: "none", verdict: { id: "held", word: "Held" }, identity: {} };
  test("it exists only for the matching run, and says whether the verdict is the expected one", () => {
    expect(runMatches(run, S.run)).toBe(true);
    expect(runMatches({ ...run, tool: "other" }, S.run)).toBe(false);
    expect(runMatches({ ...run, scenario: "no-key" }, S.run)).toBe(false);
    expect(storyCheck(null, S.run, S.expect)).toBeNull();
    expect(storyCheck({ ...run, door: "lab-banking-blocked" }, S.run, S.expect)).toBeNull();
    expect(storyCheck(run, S.run, S.expect)).toMatchObject({ ok: true, word: "Held" });
    expect(storyCheck({ ...run, verdict: { id: "allowed", word: "Allowed" } }, S.run, S.expect)).toMatchObject({ ok: false, got: "allowed", want: "held" });
  });
  test("a mismatch expectation is checked against the identity", () => {
    const spec = { action: "call", door: "d", tool: "t", scenario: "identity-mismatch" };
    const r = { action: "call", door: "d", tool: "t", scenario: "identity-mismatch", verdict: { id: "allowed", word: "Allowed" }, identity: { mismatch: true } };
    expect(storyCheck(r, spec, { verdict: "allowed", mismatch: true }).ok).toBe(true);
    expect(storyCheck({ ...r, identity: { mismatch: false } }, spec, { verdict: "allowed", mismatch: true }).ok).toBe(false);
  });
});

describe("sign-in states from /api/auth/config", () => {
  const cfg = (o) => ({ mock: { enabled: true, available: true, refusal: null }, real: { configured: false, problems: [] }, ...o });
  test("Mock: available, or one plain sentence per refusal code", () => {
    expect(signInState("mock", cfg())).toEqual({ available: true, why: null });
    expect(signInState("mock", cfg({ mock: { enabled: false, available: false, refusal: "disabled" } })).why).toMatch(/IDP=mock and ALLOW_MOCK_SIGNIN=1/);
    expect(signInState("mock", cfg({ mock: { enabled: true, available: false, refusal: "proxy_header" } })).why).toMatch(/proxy/);
    expect(signInState("mock", cfg({ mock: { enabled: true, available: false, refusal: "non_loopback_listener" } })).why).toMatch(/loopback/);
    expect(signInState("mock", cfg({ mock: { enabled: true, available: false, refusal: "something_new" } })).available).toBe(false);
    expect(signInState("mock", null).available).toBe(false);
  });
  test("Real: configured, or how to configure it and that it is a pi.flow form with no redirect", () => {
    expect(signInState("real", cfg({ real: { configured: true, problems: [] } }))).toEqual({ available: true, why: null });
    const s = signInState("real", cfg({ real: { configured: false, problems: ["no environment id"] } }));
    expect(s.available).toBe(false);
    expect(s.why).toMatch(/PGC_PINGONE_\*/);
    expect(s.why).toMatch(/pi\.flow/);
    expect(s.why).toMatch(/no environment id/);
  });
});

describe("the workspace id", () => {
  test("absent is default; a valid id is used; a malformed one is never silently the default", () => {
    expect(readWorkspace("")).toEqual({ id: "default", problem: null });
    expect(readWorkspace("?workspace=team-1")).toEqual({ id: "team-1", problem: null });
    for (const bad of ["?workspace=Team", "?workspace=a%20b", "?workspace=-x", "?workspace=" + "x".repeat(33), "?workspace=__proto__", "?workspace=a/b"]) {
      const r = readWorkspace(bad);
      expect(r.id, bad).toBe("default");
      expect(r.problem, bad).toMatch(/not valid/);
    }
    expect(readWorkspace("?workspace=")).toEqual({ id: "default", problem: null });
  });
});

describe("where the talk track first opens", () => {
  test("below the header, at the right, above the dock; a saved place is never touched; a phone gets none", () => {
    localStorage.clear();
    expect(seedTalkPlace("k1", { vp: { w: 1440, h: 900 }, headerBottom: 110, dockH: 56 })).toBe(true);
    const saved = JSON.parse(localStorage.getItem("k1"));
    expect(saved.pos).toEqual({ x: 1440 - 430 - 16, y: 120 });
    expect(saved.size.w).toBe(430);
    expect(saved.pos.y + saved.size.h).toBeLessThanOrEqual(900 - 56);
    localStorage.setItem("k2", JSON.stringify({ pos: { x: 5, y: 5 }, size: { w: 300, h: 300 } }));
    expect(seedTalkPlace("k2", { vp: { w: 1440, h: 900 } })).toBe(false);
    expect(JSON.parse(localStorage.getItem("k2")).pos).toEqual({ x: 5, y: 5 });
    expect(seedTalkPlace("k3", { vp: { w: 375, h: 812 } })).toBe(false);
    expect(localStorage.getItem("k3")).toBeNull();
  });
});
