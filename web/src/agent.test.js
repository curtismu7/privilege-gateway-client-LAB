import { describe, expect, test } from "vitest";
import { interpret, replyFor } from "./agent.js";

const CATALOG = ["list_entitlements", "who_has_role", "get_access_grants", "open_ticket", "get_portfolio_summary", "get_investment_accounts", "get_investment_balance", "get_investment_transactions", "sensitive_tax_record"];

describe("the simulated agent reads the message", () => {
  test("listing questions list; naming a tool runs it; keywords map to a tool; anything else gets help", () => {
    for (const m of ["list my tools", "What can you do?", "which tools are available", "show me my tools"]) expect(interpret(m, CATALOG).intent, m).toBe("list");
    expect(interpret("run get_investment_balance please", CATALOG)).toEqual({ intent: "run", tool: "get_investment_balance" });
    expect(interpret("Get investment balance", CATALOG)).toEqual({ intent: "run", tool: "get_investment_balance" });
    expect(interpret("what is in my portfolio", CATALOG)).toEqual({ intent: "run", tool: "get_portfolio_summary" });
    expect(interpret("who has role", CATALOG)).toEqual({ intent: "run", tool: "who_has_role" });
    expect(interpret("call sensitive-tax-record", CATALOG)).toEqual({ intent: "run", tool: "sensitive_tax_record" });
    expect(interpret("tell me a joke", CATALOG).intent).toBe("help");
    expect(interpret("   ", CATALOG).intent).toBe("empty");
  });

  test("a snake_case name after a run verb that no door lists is still sent, so the gateway answers it", () => {
    expect(interpret("call no_such_tool", CATALOG)).toEqual({ intent: "run", tool: "no_such_tool", unknown: true });
  });

  test("different messages never get one canned reply", () => {
    const allowed = { verdict: { id: "allowed", word: "Allowed", sentence: "s", basis: "checked" }, tools: [{ name: "a" }, { name: "b" }] };
    const blocked = { verdict: { id: "blocked", word: "Blocked by policy", sentence: "The tool is not in the grant.", basis: "checked" } };
    const ctx = (run) => ({ run, door: "demo-some-tools", name: "aidemo" });
    const a = replyFor({ intent: "list" }, ctx(allowed));
    const b = replyFor({ intent: "run", tool: "sensitive_tax_record" }, ctx(blocked));
    const c = replyFor({ intent: "run", tool: "who_has_role" }, ctx({ verdict: { id: "allowed", word: "Allowed", sentence: "s" } }));
    const d = replyFor({ intent: "help" }, {});
    expect(new Set([a.text, b.text, c.text, d.text]).size).toBe(4);
    expect(a.text).toMatch(/lists 2 tools on demo-some-tools for aidemo: a, b/);
    expect(a.chip).toEqual({ id: "allowed", word: "Allowed" });
    expect(b.text).toMatch(/refused/);
    expect(b.chip.word).toBe("Blocked by policy");
    expect(c.text).toMatch(/allowed/);
    expect(d.chip).toBeUndefined();
  });

  test("a list that cannot be read says why instead of inventing tools", () => {
    const r = replyFor({ intent: "list" }, { run: { verdict: { id: "blocked", word: "Blocked by policy", sentence: "No policy." } }, door: "demo-blocked", name: "aidemo" });
    expect(r.text).toMatch(/could not list/);
    expect(r.text).toMatch(/No policy/);
  });

  test("a long list is shortened with a count", () => {
    const tools = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}` }));
    const r = replyFor({ intent: "list" }, { run: { verdict: { id: "allowed", word: "Allowed" }, tools }, door: "d", name: "n" });
    expect(r.text).toMatch(/and 4 more/);
  });
});
