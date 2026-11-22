// What the verdict card shows, as a plain function of the page state. The decision itself (the word, the sentence, the basis, the next steps) is
// the server's: this only lays it out. No policy logic lives here, and nothing here reads a tool name to decide an outcome.

export const NOT_NAMED = "Not named in this lab's settings";

// Which tone paints the card edge and icon. A refusal is NEVER red: Blocked by policy and Held are amber (ink with a lock or hourglass and the
// words), Needs sign-in, Upstream error (in Mock) and Bad request are neutral. Red is only for a real error: a Real upstream failure or a
// Real request this lab could not complete.
export const ICONS = { allowed: "check", blocked: "lock", "needs-sign-in": "key", held: "hourglass", upstream: "unplug", "bad-request": "alert" };

// How the evidence surfaces look for a run: a refusal (blocked, needs sign-in) carries a lock beside its word; a Real upstream failure is the one
// red case (a real error). Everything else is the calm look: ink, amber and the words, never red. One answer for the panels and the tabs.
export function runLook(run) {
  const id = run?.verdict?.id;
  return { refusal: id === "blocked" || id === "needs-sign-in", red: run?.source === "real" && id === "upstream" };
}

export const BASIS_TEXT = {
  checked: "Checked by this lab's simulated gateway.",
  observed: "Observed: read directly from the gateway's answer.",
  inferred: "Inferred: this lab concluded it from the gateway's answer. The gateway does not report its own checks.",
};

// The words for "how this was decided". Under a SIMULATED line nothing was observed from a real gateway: a simulated run that the server marks
// "observed" (a staged upstream failure) says it was simulated by this lab.
export const SIMULATED_BASIS = "simulated";
export const shownBasis = (basis, simulated) => (simulated && basis === "observed" ? SIMULATED_BASIS : basis);
export function basisText(basis, simulated) {
  const b = shownBasis(basis, simulated);
  return b === SIMULATED_BASIS ? "Simulated by this lab." : BASIS_TEXT[b] ?? b;
}

export function resultText(v, run) {
  const st = Number.isInteger(v.status) ? ` (HTTP ${v.status})` : "";
  const sim = v.simulated ? " (simulated)" : "";
  switch (v.id) {
    case "allowed": return run.action === "discover" ? `${run.tools?.length ?? 0} tools discovered${st}` : `Allowed${v.simulated ? sim : st}`;
    case "blocked": return `Refused${st}`;
    case "needs-sign-in": return `Not accepted${st}`;
    case "held": return "Held, not run (simulated)";
    case "upstream": return Number.isInteger(v.status) ? `Failed${st}` : "No answer from the gateway";
    case "bad-request": return `Rejected as malformed${st}`;
    default: return v.word;
  }
}

function identityFacts(identity) {
  return [identity?.label ?? "Identity", identity?.name ?? NOT_NAMED, identity?.email ?? null];
}

// The card. `s` = { busy, failure, lastRun, door, info, tool }, all plain data from useLab.
export function cardFor(s) {
  const { busy, failure, lastRun, door, info } = s;
  const source = info.source;
  const identity = lastRun?.identity ?? info.identity;
  const idFact = identityFacts(identity);
  const baseFacts = (tool, result) => [idFact, ["Door", door, null], ["Tool", tool, null], ["Result", result, null]];

  if (busy) {
    const running = busy.kind === "call";
    return {
      id: "working", tone: "slate", icon: "spinner", spin: true, word: "Working",
      sentence: running ? `Running ${busy.tool} on ${door}…` : `Asking ${door} which tools it may use…`,
      facts: baseFacts(running ? busy.tool : "None yet", "Pending"), next: [], actions: [{ id: "none", label: "Working…", disabled: true }],
    };
  }

  if (failure) {
    // This lab could not complete the request at all (not a gateway verdict): a Real failure is the one place red is used.
    return {
      id: "failure", tone: source === "real" ? "danger" : "slate", icon: "alert", word: "Could not complete this request",
      sentence: failure.message, facts: baseFacts(s.tool ?? "None yet", "No answer from this lab's server"),
      next: failure.code === "unreachable" ? ["Check that the lab is running, then try again."] : [], actions: [{ id: "repeat", label: "Try again", primary: true }, { id: "door", label: "Switch door" }],
    };
  }

  if (!lastRun) {
    return {
      id: "ready", tone: "slate", icon: "list", word: "Ready", sentence: `No tools discovered yet on ${door}. ${source === "mock" ? `Every call is evaluated for ${identity?.name ?? "the gateway identity"} by the simulated gateway.` : "Every call uses the agent key this lab holds for the door."} Ask the gateway which tools it offers.`,
      facts: baseFacts("None yet", "Nothing attempted yet"), next: [], actions: [{ id: "discover", label: "Get MCP tools", primary: true }],
    };
  }

  const v = lastRun.verdict;
  const tone = v.id === "upstream" && v.source === "real" ? "danger" : v.id === "allowed" ? "ok" : v.id === "blocked" || v.id === "held" ? "hold" : "slate";
  const tool = lastRun.action === "discover" ? "Discovery (tools/list)" : lastRun.tool ?? "None yet";
  const mismatch = lastRun.identity?.mismatch ? { note: lastRun.identity.mismatchNote, pageLogin: lastRun.identity.pageLogin, gateway: lastRun.identity } : null;
  const actions = [];
  const hasTools = Boolean(s.hasTools);
  switch (v.id) {
    case "allowed":
      actions.push(lastRun.action === "discover" ? { id: "choose", label: "Choose a tool", primary: true } : { id: "choose", label: "Run another tool", primary: true });
      break;
    case "blocked":
      if (lastRun.action === "call" && hasTools) actions.push({ id: "choose", label: "Choose a permitted tool", primary: true }, { id: "door", label: "Switch door" });
      else actions.push({ id: "repeat", label: lastRun.action === "discover" ? "Retry Get MCP tools" : "Run it again", primary: true }, { id: "door", label: "Switch door" });
      break;
    case "needs-sign-in":
      actions.push(lastRun.scenario && lastRun.scenario !== "none" ? { id: "clear-scenario", label: "Run again without the scenario", primary: true } : { id: "repeat", label: "Try again", primary: true });
      break;
    case "held":
      actions.push({ id: "choose", label: "Run another tool", primary: true });
      break;
    case "bad-request":
      actions.push(lastRun.action === "call" ? { id: "args", label: "Fix the arguments", primary: true } : { id: "repeat", label: "Try again", primary: true }, { id: "choose", label: "Choose a tool" });
      break;
    default:
      actions.push({ id: "repeat", label: "Try again", primary: true }, { id: "door", label: "Switch door" });
  }
  return {
    id: v.id, tone, icon: ICONS[v.id] ?? "alert", word: v.word, sentence: v.sentence, basis: v.basis, simulated: v.simulated,
    facts: baseFacts(tool, resultText(v, lastRun)), next: v.next ?? [], detail: v.detail ?? null, mismatch, actions,
  };
}
