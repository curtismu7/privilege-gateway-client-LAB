import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";
import { validateArgs } from "./ArgsTab.jsx";
import { historyFor, HISTORY_BYTES, HISTORY_MESSAGES, MESSAGE_CHARS, plainReply, MOCK_PROMPTS, REAL_PROMPTS } from "./ChatTab.jsx";
import { createLab } from "../../server/src/lab.js";
import hopCatalog from "../../server/src/vendor/hop-catalog.json";

const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "lab-banking-full", PGC_GW_KEY_LAB_BANKING_FULL: "test-only-key" };
let t;
const mount = async (opts) => {
  t = createTestApi(opts);
  vi.stubGlobal("fetch", fetchFrom(t.api));
  const view = render(<App />);
  await screen.findByTestId("verdict-card");
  return view;
};
const tid = (x) => screen.getByTestId(x);
const click = (x) => fireEvent.click(typeof x === "string" ? tid(x) : x);
const word = () => tid("verdict-word").textContent;
const waitWord = (w) => waitFor(() => expect(word()).toBe(w));
const discover = async () => { click("action-discover"); await waitWord("Allowed"); };
const door = (id) => click(`door-${id}`);

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("shell and layout", () => {
  test("the simulation banner is the first element of main, the shell bar and the Mock/Real toggle are there, and the verdict leads the stage", async () => {
    await mount();
    const main = document.querySelector("main");
    expect(main.firstElementChild).toBe(tid("sim-banner"));
    expect(tid("sim-banner")).toHaveTextContent(/simulation/i);
    expect(document.querySelectorAll("header.shell-bar")).toHaveLength(1);
    expect(tid("mode-select")).toHaveValue("mock");
    expect(tid("mode-select").querySelector('[data-testid="mode-real"]')).toBeDisabled();
    expect(tid("mode-select").querySelector('[data-testid="mode-real"]').title).toMatch(/not configured/i);
    const stage = document.querySelector(".pgc-stage");
    expect(stage.firstElementChild).toBe(tid("verdict-card"));
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(word()).toBe("Ready");
  });

  test("the rail names the gateway identity (one source) and offers exactly the three doors, one tab stop, arrow keys", async () => {
    await mount();
    expect(tid("gateway-identity-name")).toHaveTextContent("aidemo");
    expect(tid("gateway-identity")).toHaveTextContent("Identity the gateway evaluated");
    const radios = within(tid("door-picker")).getAllByRole("radio");
    expect(radios.map((r) => r.textContent.match(/lab-banking-[a-z-]+/)[0])).toEqual(["lab-banking-full", "lab-banking-limited", "lab-banking-blocked"]);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios.every((r) => /\w{4}/.test(r.textContent.replace(/lab-banking-[a-z-]+/, "")))).toBe(true); // each has a one-line description
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(tid("door-lab-banking-limited")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(tid("door-lab-banking-limited"), { key: "End" });
    expect(tid("door-lab-banking-blocked")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(tid("door-lab-banking-blocked"), { key: "ArrowRight" });
    expect(tid("door-lab-banking-full")).toHaveAttribute("aria-checked", "true");
  });

  test("the Advanced drawer holds the Mock-only scenario control and the door URL on a .invalid host", async () => {
    await mount();
    expect(tid("advanced").tagName).toBe("DETAILS");
    const options = [...tid("scenario-select").querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual(["none", "no-key", "bad-key", "upstream-error", "identity-mismatch"]);
    expect(tid("door-url")).toHaveTextContent("https://mock-gateway.invalid/lab-banking-full/mcp");
  });

  test("a boot failure is named on the page, with a way to try again", async () => {
    t = createTestApi({ hooks: { "/api/info": () => { throw Object.assign(new Error("This lab's server could not be reached."), { code: "unreachable" }); } } });
    vi.stubGlobal("fetch", fetchFrom(t.api));
    render(<App />);
    expect(await screen.findByTestId("boot-error")).toHaveTextContent(/could not be reached/);
    expect(tid("sim-banner")).toBeInTheDocument();
  });
});

describe("verdicts", () => {
  test("lab-banking-full: Allowed, 18 of 18 tools listed, the verdict names word, sentence, facts and basis", async () => {
    await mount();
    await discover();
    expect(tid("verdict-sentence")).toHaveTextContent(/listed 18 tools on lab-banking-full/);
    expect(tid("verdict-facts")).toHaveTextContent("Identity the gateway evaluated");
    expect(tid("verdict-facts")).toHaveTextContent("Checked by this lab's simulated gateway");
    expect(tid("verdict-card")).toHaveAttribute("data-tone", "ok");
    expect(tid("tool-count")).toHaveTextContent("18 of 18 tools");
    expect(document.querySelectorAll("[data-refused]")).toHaveLength(0);
  });

  test("lab-banking-limited: only the 7 granted tools are listed, as on the real gateway; the filter narrows the list", async () => {
    await mount();
    door("lab-banking-limited");
    await discover();
    expect(tid("tool-count")).toHaveTextContent("7 of 7 tools listed");
    expect(document.querySelectorAll("[data-refused]")).toHaveLength(0);
    expect(screen.queryByText(/Not permitted/)).toBeNull();
    expect(screen.queryByTestId("tool-sensitive_tax_record")).toBeNull();
    expect(tid("perm-summary")).toHaveTextContent(/lists only what the grant allows/);
    fireEvent.change(tid("tool-filter"), { target: { value: "get_investment" } });
    expect(tid("tool-count")).toHaveTextContent("3 of 7 tools");
    fireEvent.change(tid("tool-filter"), { target: { value: "zzz" } });
    expect(tid("tools-nomatch")).toHaveTextContent("No tools match");
  });

  test("a tool the list left out, run by name, is Blocked by policy in amber with the word, and the door's list stays", async () => {
    await mount();
    door("lab-banking-limited");
    await discover();
    expect(tid("by-name-run")).toBeDisabled();
    fireEvent.change(tid("by-name-input"), { target: { value: "sensitive_tax_record" } });
    click("by-name-run");
    await waitWord("Blocked by policy");
    expect(tid("verdict-card")).toHaveAttribute("data-tone", "hold");
    expect(tid("verdict-card").querySelector("svg")).not.toBeNull();
    click("tab-tools");
    expect(tid("tool-count")).toHaveTextContent("7 of 7 tools");
  });

  test("lab-banking-blocked: Blocked by policy before any tool is listed, and the empty state says so", async () => {
    await mount();
    door("lab-banking-blocked");
    click("action-discover");
    await waitWord("Blocked by policy");
    expect(tid("tools-empty")).toHaveTextContent("No tools: blocked by policy");
    expect(tid("verdict-sentence")).toHaveTextContent(/no policy/i);
  });

  test("a permitted tool is Allowed with the result through JsonPane and the MOCK tokens decoded", async () => {
    await mount();
    await discover();
    click("tool-list_entitlements");
    click("run");
    await waitWord("Allowed");
    expect(tid("response")).toHaveTextContent("Response");
    expect(tid("response-json")).toBeInTheDocument();
    expect(tid("run-tokens")).toHaveTextContent(/MOCK tokens/);
    expect(screen.getAllByTestId("decoded-token").length).toBeGreaterThan(0);
  });

  test("open_ticket on lab-banking-full is Held, simulated and amber", async () => {
    await mount();
    await discover();
    click("tool-open_ticket");
    click("run");
    await waitWord("Held");
    expect(tid("verdict-card")).toHaveAttribute("data-tone", "hold");
    expect(tid("verdict-sim")).toHaveTextContent(/SIMULATED/);
  });

  test("scenarios: Upstream error shows the long message wrapped; no-key is Needs sign-in and one click runs it without the scenario", async () => {
    await mount();
    fireEvent.change(tid("scenario-select"), { target: { value: "upstream-error" } });
    click("action-discover");
    await waitWord("Upstream error");
    expect(tid("verdict-detail").textContent.length).toBeGreaterThan(300);
    expect(tid("verdict-sentence")).toHaveTextContent(/not a policy decision/);
    fireEvent.change(tid("scenario-select"), { target: { value: "no-key" } });
    click("action-repeat");
    await waitWord("Needs sign-in");
    click("action-clear-scenario");
    await waitWord("Allowed");
    expect(tid("scenario-select")).toHaveValue("none");
  });

  test("the identity-mismatch scenario is labelled SIMULATED in the card, the rail and the evidence", async () => {
    await mount();
    fireEvent.change(tid("scenario-select"), { target: { value: "identity-mismatch" } });
    click("action-discover");
    await waitFor(() => expect(tid("mismatch-note")).toHaveTextContent("SIMULATED"));
    expect(tid("gateway-identity")).toHaveTextContent(/SIMULATED scenario/);
    click("tab-evidence");
    expect(tid("identity-table")).toHaveTextContent(/Page login \(SIMULATED scenario\)/);
  });

  test("a request this lab cannot complete is named, not a blank card", async () => {
    await mount({ hooks: { "/api/discover": () => { throw Object.assign(new Error("This lab's server could not be reached. Check that it is still running, then try again."), { status: 0, code: "unreachable" }); } } });
    click("action-discover");
    await waitFor(() => expect(word()).toBe("Could not complete this request"));
    expect(tid("verdict-card")).toHaveAttribute("data-tone", "slate");
  });
});

describe("arguments and response", () => {
  test("validation: Run is disabled for an empty required argument or broken JSON; Send anyway shows a Bad request, never an Upstream error", async () => {
    await mount();
    await discover();
    click("tool-who_has_role");
    fireEvent.change(tid("args-text"), { target: { value: '{"role": ""}' } });
    expect(tid("run")).toBeDisabled();
    expect(tid("args-note")).toHaveTextContent("Missing required: role");
    click("run-anyway");
    await waitWord("Bad request");
    expect(tid("verdict-card")).not.toHaveTextContent(/upstream/i);
    fireEvent.change(tid("args-text"), { target: { value: "{broken" } });
    expect(tid("run")).toBeDisabled();
    expect(screen.queryByTestId("run-anyway")).toBeNull();
    expect(tid("args-note")).toHaveTextContent(/not valid JSON/);
  });

  test("validateArgs", () => {
    expect(validateArgs('{"a":1}', ["a"]).ok).toBe(true);
    expect(validateArgs('{"a":null}', ["a"]).ok).toBe(false);
    expect(validateArgs("[]", []).ok).toBe(false);
    expect(validateArgs("{}", []).msg).toBe("No required arguments.");
  });

  test("with no tool selected it says so and goes back to the list", async () => {
    await mount();
    click("tab-args");
    expect(tid("args-empty")).toHaveTextContent("No tool selected");
    click(within(tid("args-empty")).getByRole("button", { name: "Go to Tools" }));
    expect(tid("tab-tools")).toHaveAttribute("aria-selected", "true");
  });
});

describe("evidence", () => {
  test("decision JSON and the shared 'What Privilege did' trace, Mock decisions marked checked", async () => {
    await mount();
    await discover();
    click("tab-evidence");
    expect(tid("decision-json")).toBeInTheDocument();
    expect(tid("gateway-trace")).toHaveTextContent("What Privilege did");
    expect(tid("gateway-trace-basis")).toHaveTextContent(/Simulated/);
    expect(tid("identity-table")).toHaveTextContent("aidemo");
  });

  test("nothing attempted yet is an honest empty state", async () => {
    await mount();
    click("tab-evidence");
    expect(tid("evidence-empty")).toHaveTextContent("Nothing attempted yet");
  });
});

describe("tools tab states", () => {
  test("empty state before discovery, and an empty list from the gateway", async () => {
    await mount({ hooks: { "/api/discover": async (b, lab) => { const run = await lab.discover({ door: b.door }, {}); return { ...run, tools: [] }; } } });
    expect(tid("tools-empty")).toHaveTextContent("No tools discovered yet");
    click("get-tools");
    await waitWord("Allowed");
    expect(tid("tools-empty")).toHaveTextContent("listed no tools");
  });

  test("hostile text and very long names render as inert text and wrap", async () => {
    const hostile = "<img src=x onerror=alert(1)> ‮";
    const longName = `get_${"very_long_name_".repeat(10)}end`;
    await mount({
      hooks: {
        "/api/discover": async (b, lab) => {
          const run = await lab.discover({ door: b.door }, {});
          run.tools[0] = { ...run.tools[0], name: longName, description: hostile, args: { [`arg_${"x".repeat(80)}`]: "v" } };
          return run;
        },
      },
    });
    click("get-tools");
    await waitWord("Allowed");
    expect(document.querySelector("img")).toBeNull();
    expect(tid("tool-grid")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(tid("tool-grid")).toHaveTextContent("\\u202e");
    expect(tid(`tool-${longName}`)).toBeInTheDocument();
    click(`tool-${longName}`);
    expect(tid("args-tool")).toHaveTextContent(longName);
  });
});

describe("agent chat", () => {
  test("a clearly labelled SIMULATED agent that reads the message and never gives one canned answer", async () => {
    await mount();
    door("lab-banking-limited");
    click("tab-chat");
    expect(tid("chat-sim-note")).toHaveTextContent(/^SIMULATED agent/);
    const say = async (text) => {
      fireEvent.change(tid("chat-input"), { target: { value: text } });
      click("chat-send");
      await waitFor(() => expect(screen.queryByTestId("chat-thinking")).toBeNull());
      const replies = screen.getAllByTestId("msg-agent");
      return replies[replies.length - 1].textContent;
    };
    const list = await say("list my tools");
    expect(list).toMatch(/lists 7 tools on lab-banking-limited/);
    expect(list).toMatch(/not listed is refused when called/);
    const balance = await say("get investment balance");
    expect(balance).toMatch(/get_investment_balance/);
    expect(balance).toMatch(/allowed/i);
    const refused = await say("call sensitive_tax_record");
    expect(refused).toMatch(/refused/);
    const help = await say("what is the weather");
    expect(help).toMatch(/I can list the tools/);
    const typo = await say("call no_such_tool");
    expect(typo).toMatch(/malformed/);
    expect(new Set([list, balance, refused, help, typo]).size).toBe(5);
    // the one refused tool did not put the door into a blocked state
    click("tab-tools");
    expect(tid("tool-count")).toHaveTextContent("7 of 7 tools");
  });

  test("on a blocked door the agent says it was blocked", async () => {
    await mount();
    door("lab-banking-blocked");
    click("tab-chat");
    fireEvent.change(tid("chat-input"), { target: { value: "list my tools" } });
    click("chat-send");
    await waitFor(() => expect(screen.getAllByTestId("msg-agent")).toHaveLength(1));
    expect(tid("msg-agent")).toHaveTextContent(/could not list/);
    expect(tid("msg-agent")).toHaveTextContent("Blocked by policy");
  });
});

describe("mock sign-in", () => {
  test("the header Sign in opens a FloatingDialog persona picker; picking one shows the page login and its session expiry (Mock only)", async () => {
    await mount();
    click("sign-in");
    const dialog = await screen.findByTestId("signin-dialog");
    expect(dialog).toHaveTextContent(/SIMULATED sign-in/);
    fireEvent.click(await screen.findByTestId("persona-demouser"));
    await waitFor(() => expect(tid("who")).toHaveTextContent("demouser"));
    expect(tid("page-login-name")).toHaveTextContent("demouser");
    expect(tid("session-expiry")).toHaveTextContent(/Session ends in \d+ h/);
    expect(screen.queryByTestId("signin-dialog")).toBeNull();
    click("rail-sign-out");
    await waitFor(() => expect(screen.queryByTestId("page-login-name")).toBeNull());
  });

  test("when Mock sign-in is off the rail says how to turn it on and no Sign in button is offered", async () => {
    await mount({ authConfig: { workspace: "default", source: "mock", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { configured: false, problems: [] } } });
    expect(screen.queryByTestId("sign-in")).toBeNull();
    expect(tid("page-login")).toHaveTextContent(/ALLOW_MOCK_SIGNIN=1/);
  });
});

describe("Real mode", () => {
  test("switching to Real reloads the data, flips the banner to live, shows the identity as declared by settings, and the chat is not offered", async () => {
    await mount({ env: REAL_ENV });
    await discover();
    expect(tid("mode-select").querySelector('[data-testid="mode-real"]')).not.toBeDisabled();
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(word()).toBe("Ready");
    expect(tid("gateway-identity")).toHaveTextContent("Identity declared by this lab's settings");
    expect(within(tid("door-picker")).getAllByRole("radio")).toHaveLength(1);
    expect(tid("scenario-select")).toBeDisabled();
    click("tab-chat");
    // No agent key in this lab's settings: the real agent says what to set, and points at the Tools tab.
    expect(tid("chat-real-off")).toHaveTextContent(/PGC_ANTHROPIC_API_KEY/);
    expect(tid("chat-real-off")).toHaveTextContent(/Tools tab/);
    // and back: a visible toggle that works in both directions
    fireEvent.change(tid("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(tid("sim-banner")).not.toHaveAttribute("data-state"));
    expect(within(tid("door-picker")).getAllByRole("radio")).toHaveLength(3);
  });

  test("Reset clears the run and keeps the mode", async () => {
    await mount();
    await discover();
    click("reset");
    await waitWord("Ready");
    expect(tid("mode-select")).toHaveValue("mock");
  });
});

// Real runs with real shapes: a Mock lab core makes them, and they are relabelled the way a Real lab returns them.
async function realShapedRuns() {
  const m = createLab({ env: { MODE: "mock" }, version: "9.9.9", catalog: hopCatalog });
  const disc = await m.discover({ door: "lab-banking-full" }, {});
  const call = await m.call({ door: "lab-banking-full", tool: "who_has_role", args: { role: "prod-db-admin" } }, {});
  const blocked = await m.call({ door: "lab-banking-limited", tool: "sensitive_holdings", args: { account_id: "x" } }, {});
  return { disc, call, blocked };
}
const AGENT_ENV = { ...REAL_ENV, PGC_ANTHROPIC_API_KEY: "test-only-model-key" };
const toReal = async () => { fireEvent.change(tid("mode-select"), { target: { value: "real" } }); await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live")); };

describe("Real agent chat", () => {
  test("a configured Real agent sends the text history, shows its reply, each step with the gateway's verdict, and a chip opens that run", async () => {
    const { disc, call, blocked } = await realShapedRuns();
    const sent = [];
    const reply = { source: "real", simulated: false, model: "claude-sonnet-5-5", by: "model", stopped: "done", reply: "Two people hold prod-db-admin. The sensitive tool was refused.",
      steps: [{ kind: "discover", run: disc }, { kind: "call", tool: "who_has_role", args: { role: "prod-db-admin" }, run: call }, { kind: "call", tool: "sensitive_holdings", args: { account_id: "x" }, run: blocked }] };
    await mount({ env: AGENT_ENV, hooks: { "/api/agent": (body) => { sent.push(body); return reply; } } });
    await toReal();
    click("tab-chat");
    expect(tid("chat-real-note")).toHaveTextContent(/REAL agent/);
    expect(tid("chat-real-note")).toHaveTextContent(/claude-sonnet-5-5/);
    fireEvent.change(tid("chat-input"), { target: { value: "who holds prod-db-admin?" } });
    click("chat-send");
    await screen.findByText(/Two people hold prod-db-admin/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ door: "lab-banking-full", messages: [{ role: "user", text: "who holds prod-db-admin?" }] });
    const chips = screen.getAllByTestId("chat-step-chip");
    expect(chips.map((c) => c.textContent)).toEqual([disc.verdict.word, call.verdict.word, blocked.verdict.word]);
    expect(chips[2]).toHaveAttribute("data-verdict", "blocked");
    // The last run of the turn is the page's current run; a chip shows another one.
    await waitWord(blocked.verdict.word);
    click(chips[1]);
    await waitWord(call.verdict.word);
    // A second message carries the earlier turn as text.
    fireEvent.change(tid("chat-input"), { target: { value: "and who else?" } });
    click("chat-send");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  test("a call for a tool the gateway did not list is labelled so, with the gateway's verdict", async () => {
    const { disc, blocked } = await realShapedRuns();
    const reply = { source: "real", simulated: false, model: "claude-sonnet-5-5", by: "model", stopped: "done", reply: "The gateway refused it.",
      steps: [{ kind: "discover", run: disc }, { kind: "call", tool: "sensitive_holdings", args: { account_id: "x" }, run: blocked, unlisted: true }] };
    await mount({ env: AGENT_ENV, hooks: { "/api/agent": () => reply } });
    await toReal();
    click("tab-chat");
    fireEvent.change(tid("chat-input"), { target: { value: "call sensitive_holdings" } });
    click("chat-send");
    await screen.findByText(/The gateway refused it/);
    expect(screen.getAllByTestId("chat-step-call")[0]).toHaveTextContent(/did not list: sensitive_holdings/);
    expect(screen.getAllByTestId("chat-step-chip")[1]).toHaveAttribute("data-verdict", "blocked");
  });

  test("a lab failure is worded in the chat as the lab's, and is not sent back as history", async () => {
    const sent = [];
    await mount({ env: AGENT_ENV, hooks: { "/api/agent": (body) => { sent.push(body); throw Object.assign(new Error("The real agent runs in Real only."), { status: 409, code: "agent_real_only" }); } } });
    await toReal();
    click("tab-chat");
    fireEvent.change(tid("chat-input"), { target: { value: "hi" } });
    click("chat-send");
    await screen.findByText(/This lab could not run the agent/);
    expect(screen.getAllByTestId("msg-agent")[0]).toHaveAttribute("data-stopped", "lab-error");
    fireEvent.change(tid("chat-input"), { target: { value: "again" } });
    click("chat-send");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].messages).toEqual([{ role: "user", text: "hi" }, { role: "user", text: "again" }]);
  });

  test("plainReply drops Markdown bold and heading markers, keeps line breaks and list dashes, and leaves other text alone", () => {
    expect(plainReply("Three users:\n- **alice.chen:** admin\n- __dave__ reader")).toBe("Three users:\n- alice.chen: admin\n- dave reader");
    expect(plainReply("## Grants\nnone")).toBe("Grants\nnone");
    expect(plainReply("a * b ** c <b>x</b>")).toBe("a * b ** c <b>x</b>");
  });

  test("historyFor caps each earlier reply, the number of messages and the UTF-8 size the server accepts", () => {
    const longReply = [{ who: "you", text: "q" }, { who: "agent", text: "y".repeat(MESSAGE_CHARS * 3) }];
    expect(historyFor(longReply, "next")[1].text).toHaveLength(MESSAGE_CHARS);
    const many = Array.from({ length: 100 }, (_, i) => ({ who: i % 2 ? "agent" : "you", text: "x" }));
    const h = historyFor(many, "next");
    expect(h.length).toBeLessThanOrEqual(HISTORY_MESSAGES);
    expect(h[0].role).toBe("user");
    const wide = Array.from({ length: 20 }, (_, i) => ({ who: i % 2 ? "agent" : "you", text: "\u201c\u2014".repeat(900) }));
    expect(new TextEncoder().encode(JSON.stringify(historyFor(wide, "n"))).length).toBeLessThan(16 * 1024);
  });

  test("historyFor keeps the newest text within the size budget and always starts with a user message", () => {
    // Seven full-size replies are more than the byte budget, so the oldest question drops out.
    const full = Array.from({ length: Math.ceil(HISTORY_BYTES / MESSAGE_CHARS) + 1 }, () => ({ who: "agent", text: "x".repeat(MESSAGE_CHARS) }));
    const msgs = [{ who: "you", text: "old question" }, ...full, { who: "agent", local: true, text: "lab error" }];
    const h = historyFor(msgs, "new question");
    expect(h.at(-1)).toEqual({ role: "user", text: "new question" });
    expect(h[0].role).toBe("user");
    expect(h.some((m) => m.text === "lab error")).toBe(false);
    expect(h.some((m) => m.text === "old question")).toBe(false);
  });

  test("Real Tools tab: the argument form starts from the listed tool's own arguments, not the Mock sample", async () => {
    const { disc } = await realShapedRuns();
    const realDisc = { ...disc, source: "real", simulated: false, tools: disc.tools.map((t) => (t.name === "get_access_grants" ? { ...t, args: { resource: "prod-db-primary" }, required: ["resource"] } : t)) };
    await mount({ env: AGENT_ENV, hooks: { "/api/discover": () => realDisc } });
    await toReal();
    click("tab-tools");
    await discover();
    click("tool-get_access_grants");
    expect(JSON.parse(tid("args-text").value)).toEqual({ resource: "prod-db-primary" });
    expect(tid("args-note")).toHaveTextContent("Required: resource");
  });

  test("hosted: in Real a visitor who is not signed in is told to sign in; Mock and a signed-in visitor see no such note", async () => {
    await mount({ env: AGENT_ENV, hooks: { "/api/info": (_b, l) => ({ ...l.info(), hosted: { signinRequired: true, signedIn: false } }) } });
    expect(screen.queryByTestId("hosted-signin")).toBeNull();
    await toReal();
    expect(tid("hosted-signin")).toHaveTextContent(/Sign in to run the Real lab/);
  });

  test("hosted: the rail says a sign-in is needed for Real calls; the local lab keeps 'do not need one'", async () => {
    const authConfig = { workspace: "default", source: "real", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { flow: "pi.flow", configured: true, problems: [] } };
    await mount({ env: AGENT_ENV, authConfig, hooks: { "/api/info": (_b, l) => ({ ...l.info(), hosted: { signinRequired: true, signedIn: false } }) } });
    await toReal();
    expect(tid("signin-why")).toHaveTextContent(/On this hosted lab, sign in to run the Real gateway calls and the agent/);
    expect(tid("signin-why")).not.toHaveTextContent(/do not need one/);
  });

  test("not hosted: the rail keeps saying the gateway calls do not need a page login", async () => {
    const authConfig = { workspace: "default", source: "real", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { flow: "pi.flow", configured: true, problems: [] } };
    await mount({ env: AGENT_ENV, authConfig });
    await toReal();
    expect(tid("signin-why")).toHaveTextContent(/do not need one/);
  });

  test("hosted: after the redirect sign-in the rail says 'Signed in with PingOne', without the pi.flow label", async () => {
    const authConfig = { workspace: "default", source: "real", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { flow: "redirect", configured: true, problems: [] } };
    const me = { source: "real-login", sub: "u-1", name: "Pat", username: "pat", email: null };
    await mount({ env: AGENT_ENV, authConfig, session: me });
    await toReal();
    expect(tid("rail")).toHaveTextContent("Signed in with PingOne");
    expect(tid("rail")).not.toHaveTextContent("pi.flow");
  });

  test("the Real agent note names the Privilege LLM gateway when the agent goes through it", async () => {
    await mount({ env: { ...REAL_ENV, PGC_LLM_GATEWAY_URL: "https://llm-gw.example", PGC_LLM_VIRTUAL_KEY: "test-only-llm-key", PGC_AGENT_MODEL: "claude-sonnet-4-5" } });
    await toReal();
    click("tab-chat");
    expect(tid("chat-real-note")).toHaveTextContent(/through the Privilege LLM gateway/);
    expect(tid("chat-real-note")).not.toHaveTextContent(/Anthropic API/);
  });

  test("hosted: a redirect sign-in that came back with an error says why in words, and the error leaves the address", async () => {
    window.history.replaceState(null, "", "/?signin_error=signin_refused");
    await mount({ env: AGENT_ENV });
    expect(tid("signin-error")).toHaveTextContent(/PingOne refused the sign-in/);
    expect(window.location.search).toBe("");
  });

  test("hosted: a sign-in refused because too many are in progress says so in words", async () => {
    window.history.replaceState(null, "", "/?signin_error=signin_busy");
    await mount({ env: AGENT_ENV });
    expect(tid("signin-error")).toHaveTextContent(/Too many sign-ins are in progress/);
  });

  test("hosted: a visitor with a Real page login sees no sign-in note in Real", async () => {
    const me = { source: "real-login", sub: "u-1", name: "Pat", username: "pat", email: null };
    await mount({ env: AGENT_ENV, session: me, hooks: { "/api/info": (_b, l) => ({ ...l.info(), hosted: { signinRequired: true, signedIn: true } }) } });
    await toReal();
    expect(screen.queryByTestId("hosted-signin")).toBeNull();
  });
});

describe("Agent chat first, prompts and inline evidence (owner 2026-11-23)", () => {
  test("Agent chat is the first tab and the one the lab opens on", async () => {
    await mount();
    const tabs = within(screen.getByRole("tablist", { name: "Details" })).getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("data-testid", "tab-chat");
    expect(tid("tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(tid("chat-panel")).toBeInTheDocument();
  });

  test("the prompt dropdown fills the message without sending it; Mock and Real have their own lists", async () => {
    await mount({ env: AGENT_ENV, hooks: { "/api/agent": () => { throw new Error("must not send"); } } });
    const options = within(tid("chat-prompts")).getAllByRole("option").map((o) => o.value).filter(Boolean);
    expect(options).toEqual([...MOCK_PROMPTS]);
    fireEvent.change(tid("chat-prompts"), { target: { value: "list my tools" } });
    expect(tid("chat-input")).toHaveValue("list my tools");
    expect(tid("chat-prompts")).toHaveValue("");
    expect(screen.queryAllByTestId("msg-you")).toHaveLength(0);
    await toReal();
    click("tab-chat");
    expect(within(tid("chat-prompts")).getAllByRole("option").map((o) => o.value).filter(Boolean)).toEqual([...REAL_PROMPTS]);
  });

  test("Mock: a reply's Evidence opens the verdict and the reel of that run inline; a frame walks the page's one walkthrough", async () => {
    await mount();
    fireEvent.change(tid("chat-input"), { target: { value: "list my tools" } });
    click("chat-send");
    await waitWord("Allowed");
    click(await screen.findByTestId("chat-evidence-toggle"));
    const ev = tid("chat-evidence");
    expect(ev).toHaveTextContent("Allowed");
    expect(ev).toHaveTextContent("Discovery (tools/list)");
    const frames = within(ev).getAllByRole("button").filter((b) => b.className.includes("rl-f"));
    expect(frames.length).toBeGreaterThan(1);
    click(frames[1]);
    await waitFor(() => expect(within(tid("chat-evidence")).getAllByRole("button").filter((b) => b.className.includes("rl-f"))[1]).toHaveAttribute("aria-current", "step"));
  });

  test("Real: a frame of an earlier run loads that run first (the page's one walkthrough follows it)", async () => {
    const { disc, call, blocked } = await realShapedRuns();
    const reply = { source: "real", simulated: false, model: "claude-sonnet-5-5", by: "model", stopped: "done", reply: "Three calls made for the walkthrough test.", steps: [{ kind: "discover", run: disc }, { kind: "call", tool: "who_has_role", args: {}, run: call }, { kind: "call", tool: "sensitive_holdings", args: {}, run: blocked }] };
    await mount({ env: AGENT_ENV, hooks: { "/api/agent": () => reply } });
    await toReal();
    click("tab-chat");
    fireEvent.change(tid("chat-input"), { target: { value: "go" } });
    click("chat-send");
    await screen.findByText("Three calls made for the walkthrough test.");
    await waitWord(blocked.verdict.word);
    click(screen.getAllByTestId("chat-evidence-toggle")[1]); // the who_has_role call, not the page's current run
    const ev = tid("chat-evidence");
    expect(ev).toHaveTextContent(call.verdict.word);
    expect(ev).toHaveTextContent(/load this run into Evidence/);
    click(within(ev).getAllByRole("button").filter((b) => b.className.includes("rl-f"))[0]);
    await waitWord(call.verdict.word);
    await waitFor(() => expect(tid("chat-evidence")).toHaveTextContent(/This run is in Evidence/));
  });
});

