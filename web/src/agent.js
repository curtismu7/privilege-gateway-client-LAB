// The SIMULATED agent of the Mock chat. It calls no model. It reads the message and decides what to ask the gateway (through the lab's own
// server), then words the answer from what the gateway really returned in this lab, so no two different messages get the same canned reply.
// The decisions (permitted, refused, held, bad request) are the server's verdicts; this file only chooses which call to make and phrases it.

const HELP = "I can list the tools on this door or run one. Try “list my tools”, “get investment balance”, “who has role” or “call who_has_role”.";

const WANTS_LIST = /\b(list|show|which|what|available|my)\b[^.?!]*\b(tools?|can you do|able to|allowed)\b|\bwhat can (you|i)\b|\btools\b\s*(list|available)?\??$/i;
const KEYWORDS = [
  [/balance/, "get_investment_balance"],
  [/portfolio/, "get_portfolio_summary"],
  [/transaction/, "get_investment_transactions"],
  [/entitlement/, "list_entitlements"],
  [/who\s+has\s+(the\s+)?role|role holders/, "who_has_role"],
  [/access\s+grant|grants/, "get_access_grants"],
  [/\bticket\b/, "open_ticket"],
];
// "call no_such_tool", "run get_foo": a snake_case word after a run verb is taken as a tool name even when no door lists it, so a typo is a
// Bad request from the gateway (its decision), not a silent miss here.
const NAMED = /\b(?:run|call|use|try|invoke)\s+([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/i;

export function interpret(message, catalogNames = []) {
  const text = String(message ?? "").trim();
  if (!text) return { intent: "empty" };
  const lower = text.toLowerCase();
  const normal = lower.replace(/[\s-]+/g, "_");
  const known = [...catalogNames].sort((a, b) => b.length - a.length).find((n) => normal.includes(n));
  if (known) return { intent: "run", tool: known };
  const named = NAMED.exec(lower);
  if (named) return { intent: "run", tool: named[1], unknown: true };
  for (const [re, tool] of KEYWORDS) if (re.test(lower) && catalogNames.includes(tool)) return { intent: "run", tool };
  if (WANTS_LIST.test(lower)) return { intent: "list" };
  return { intent: "help" };
}

const chipFor = (v) => ({ id: v.id, word: v.word });
const shortList = (names, max = 8) => (names.length > max ? `${names.slice(0, max).join(", ")}, and ${names.length - max} more` : names.join(", "));

// run = the server's run record for the call or discovery the agent just made.
export function replyFor(plan, { run, door, name }) {
  if (plan.intent === "empty") return null;
  if (plan.intent === "help") return { text: HELP };
  const v = run.verdict;
  const who = name || "the caller";
  if (plan.intent === "list") {
    if (v.id !== "allowed" || !run.tools) return { text: `I could not list the tools on ${door}. ${v.sentence}`, chip: chipFor(v) };
    const ok = run.tools.filter((t) => t.permitted === true);
    const no = run.tools.length - ok.length;
    return {
      text: `On ${door} ${who} can use ${ok.length} of ${run.tools.length} tools: ${shortList(ok.map((t) => t.name)) || "none"}.${no ? ` The gateway refuses the other ${no} (write and sensitive tools).` : ""}`,
      chip: chipFor(v),
    };
  }
  // intent run
  const tool = plan.tool;
  if (v.id === "allowed") return { text: `I called ${tool} for ${who} on ${door}. The gateway's decision: allowed. It returned a sample result (simulated).`, chip: chipFor(v) };
  if (v.id === "blocked") return { text: `I tried ${tool} for ${who} on ${door}, but the gateway refused it. ${v.sentence}`, chip: chipFor(v) };
  if (v.id === "held") return { text: `I asked for ${tool} on ${door}. The gateway held it until a person approves it, so nothing ran yet (simulated).`, chip: chipFor(v) };
  if (v.id === "bad-request") return { text: `I called ${tool} on ${door}, but the gateway rejected the request as malformed. ${v.detail ? `It said: ${v.detail}.` : ""}`.trim(), chip: chipFor(v) };
  return { text: `I could not run ${tool} on ${door}. ${v.sentence}`, chip: chipFor(v) };
}
