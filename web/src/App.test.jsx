import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";
import { validateArgs } from "./ArgsTab.jsx";

const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "demo-all-tools", PGC_GW_KEY_DEMO_ALL_TOOLS: "test-only-key" };
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
    expect(radios.map((r) => r.textContent.match(/demo-[a-z-]+/)[0])).toEqual(["demo-all-tools", "demo-some-tools", "demo-blocked"]);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios.every((r) => /\w{4}/.test(r.textContent.replace(/demo-[a-z-]+/, "")))).toBe(true); // each has a one-line description
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(tid("door-demo-some-tools")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(tid("door-demo-some-tools"), { key: "End" });
    expect(tid("door-demo-blocked")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(tid("door-demo-blocked"), { key: "ArrowRight" });
    expect(tid("door-demo-all-tools")).toHaveAttribute("aria-checked", "true");
  });

  test("the Advanced drawer holds the Mock-only scenario control and the door URL on a .invalid host", async () => {
    await mount();
    expect(tid("advanced").tagName).toBe("DETAILS");
    const options = [...tid("scenario-select").querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual(["none", "no-key", "bad-key", "upstream-error", "identity-mismatch"]);
    expect(tid("door-url")).toHaveTextContent("https://mock-gateway.invalid/demo-all-tools/mcp");
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
  test("demo-all-tools: Allowed, 18 of 18 tools listed, the verdict names word, sentence, facts and basis", async () => {
    await mount();
    await discover();
    expect(tid("verdict-sentence")).toHaveTextContent(/listed 18 tools on demo-all-tools/);
    expect(tid("verdict-facts")).toHaveTextContent("Identity the gateway evaluated");
    expect(tid("verdict-facts")).toHaveTextContent("Checked by this lab's simulated gateway");
    expect(tid("verdict-card")).toHaveAttribute("data-tone", "ok");
    expect(tid("tool-count")).toHaveTextContent("18 of 18 tools");
    expect(document.querySelectorAll("[data-refused]")).toHaveLength(0);
  });

  test("demo-some-tools: only the 7 granted tools are listed, as on the real gateway; the filter narrows the list", async () => {
    await mount();
    door("demo-some-tools");
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
    door("demo-some-tools");
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

  test("demo-blocked: Blocked by policy before any tool is listed, and the empty state says so", async () => {
    await mount();
    door("demo-blocked");
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

  test("open_ticket on demo-all-tools is Held, simulated and amber", async () => {
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
    door("demo-some-tools");
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
    expect(list).toMatch(/lists 7 tools on demo-some-tools/);
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
    door("demo-blocked");
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
    expect(tid("chat-real")).toHaveTextContent(/Mock-only simulation/);
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
