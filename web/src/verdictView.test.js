import { describe, expect, test } from "vitest";
import { cardFor, resultText, ICONS, runLook, basisText, shownBasis } from "./verdictView.js";

const info = (source = "mock") => ({ source, identity: { label: source === "mock" ? "Identity the gateway evaluated" : "Identity declared by this lab's settings", name: source === "mock" ? "aidemo" : null, email: null } });
const run = (id, over = {}, source = "mock") => ({ action: "call", tool: "t", scenario: "none", identity: info(source).identity, verdict: { id, word: id, sentence: "S", basis: "checked", source, simulated: source === "mock", status: 403, next: [], detail: null }, ...over });
const card = (r, extra = {}, source = "mock") => cardFor({ busy: null, failure: null, lastRun: r, door: "lab-banking-limited", info: info(source), hasTools: true, ...extra });

describe("verdict card model", () => {
  test("a refusal is never red: blocked and held are amber, the rest neutral or green", () => {
    expect(card(run("blocked")).tone).toBe("hold");
    expect(card(run("held")).tone).toBe("hold");
    expect(card(run("allowed")).tone).toBe("ok");
    for (const id of ["needs-sign-in", "bad-request", "upstream"]) expect(card(run(id)).tone, id).toBe("slate");
  });

  test("red (danger) is for a real error only: a Real upstream failure or a Real request this lab could not complete", () => {
    expect(card(run("upstream", {}, "real"), {}, "real").tone).toBe("danger");
    expect(card(null, { failure: { message: "x", code: "no_key_for_door" } }, "real").tone).toBe("danger");
    expect(card(null, { failure: { message: "x", code: "unreachable" } }, "mock").tone).toBe("slate");
  });

  test("runLook: a refusal gets the lock look, only a Real upstream failure is red, nothing else is", () => {
    expect(runLook(null)).toEqual({ refusal: false, red: false });
    for (const id of ["blocked", "needs-sign-in"]) expect(runLook(run(id))).toEqual({ refusal: true, red: false });
    for (const id of ["allowed", "held", "bad-request"]) expect(runLook(run(id))).toEqual({ refusal: false, red: false });
    expect(runLook(run("upstream", { source: "mock" }))).toEqual({ refusal: false, red: false });
    expect(runLook(run("upstream", { source: "real" }, "real"))).toEqual({ refusal: false, red: true });
  });

  test("a simulated run never says 'Observed: read directly from the gateway's answer'; a Real one still does", () => {
    expect(basisText("observed", true)).toMatch(/^Simulated by this lab/);
    expect(basisText("observed", true)).not.toMatch(/observed|read directly/i);
    expect(shownBasis("observed", true)).toBe("simulated");
    expect(basisText("observed", false)).toBe("Observed: read directly from the gateway's answer.");
    expect(basisText("checked", true)).toBe("Checked by this lab's simulated gateway.");
    expect(basisText("inferred", false)).toMatch(/^Inferred/);
    const c = card(run("upstream", { verdict: { id: "upstream", word: "Upstream error", sentence: "S", basis: "observed", source: "mock", simulated: true, status: 502, next: [], detail: null } }));
    expect(c.simulated).toBe(true);
    expect(c.basis).toBe("observed");
  });

  test("every verdict has an icon and a word, and the sentence is the server's", () => {
    for (const id of Object.keys(ICONS)) {
      const c = card(run(id));
      expect(c.icon).toBeTruthy();
      expect(c.word).toBe(id);
      expect(c.sentence).toBe("S");
    }
  });

  test("facts: identity from one source (the server's label), door, tool and result", () => {
    const c = card(run("blocked"));
    expect(c.facts[0]).toEqual(["Identity the gateway evaluated", "aidemo", null]);
    expect(c.facts[1][1]).toBe("lab-banking-limited");
    expect(c.facts[2][1]).toBe("t");
    expect(c.facts[3][1]).toBe("Refused (HTTP 403)");
    const r = card(run("blocked", { identity: { label: "Identity declared by this lab's settings", name: "agent-owner", email: null } }, "real"), {}, "real");
    expect(r.facts[0]).toEqual(["Identity declared by this lab's settings", "agent-owner", null]);
  });

  test("a Real identity that settings do not name says so instead of inventing one", () => {
    const c = cardFor({ busy: null, failure: null, lastRun: null, door: "d", info: info("real") });
    expect(c.facts[0][1]).toBe("Not named in this lab's settings");
  });

  test("working, ready and failure states", () => {
    expect(cardFor({ busy: { kind: "call", tool: "who_has_role" }, lastRun: null, door: "d", info: info() })).toMatchObject({ id: "working", spin: true });
    expect(cardFor({ busy: null, lastRun: null, door: "d", info: info() })).toMatchObject({ id: "ready", word: "Ready" });
    expect(cardFor({ busy: null, failure: { message: "m", code: "unreachable" }, lastRun: null, door: "d", info: info() })).toMatchObject({ id: "failure", sentence: "m" });
  });

  test("actions: a refused call with a tool list offers a listed tool; without one it retries; no-key offers to drop the scenario", () => {
    expect(card(run("blocked")).actions.map((a) => a.id)).toEqual(["choose", "door"]);
    expect(card(run("blocked", { action: "discover" })).actions.map((a) => a.id)).toEqual(["repeat", "door"]);
    expect(card(run("needs-sign-in", { scenario: "no-key" })).actions[0].id).toBe("clear-scenario");
    expect(card(run("bad-request")).actions.map((a) => a.id)).toEqual(["args", "choose"]);
    expect(card(run("upstream")).actions.map((a) => a.id)).toEqual(["repeat", "door"]);
    expect(card(run("blocked")).actions.filter((a) => a.primary)).toHaveLength(1);
  });

  test("the identity-mismatch note is carried only when the server says so", () => {
    const id = { ...info().identity, mismatch: true, pageLogin: { name: "demouser" }, mismatchNote: "SIMULATED scenario" };
    expect(card(run("blocked", { identity: id })).mismatch).toMatchObject({ note: "SIMULATED scenario" });
    expect(card(run("blocked")).mismatch).toBeNull();
  });

  test("result text", () => {
    expect(resultText({ id: "upstream", status: null }, {})).toBe("No answer from the gateway");
    expect(resultText({ id: "allowed", status: 200, simulated: true }, { action: "discover", tools: [1, 2] })).toBe("2 tools discovered (HTTP 200)");
    expect(resultText({ id: "bad-request", status: 200 }, {})).toBe("Rejected as malformed (HTTP 200)");
  });
});
