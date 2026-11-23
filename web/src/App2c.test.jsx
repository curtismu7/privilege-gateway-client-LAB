// Step 2c on the real lab core: stories (?story= links and the picker), the vertical packs, branding, the sign-in states, the mode status,
// presenter mode, the Talk track and Reset. jsdom has no layout, so placement, pop-out and 375px are proven in a real browser (e2e/demo.py).
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App.jsx";
import { createTestApi, fetchFrom } from "./testLab.js";

const REAL_ENV = { MODE: "mock", PGC_GW_URL: "https://gateway.example/mcp", PGC_GW_APPS: "lab-banking-full", PGC_GW_KEY_LAB_BANKING_FULL: "test-only-key" };
let t;
const mount = async (opts = {}, search = "") => {
  window.history.replaceState(null, "", `/${search}`);
  t = createTestApi(opts);
  vi.stubGlobal("fetch", fetchFrom(t.api));
  const view = render(<App />);
  await screen.findByTestId("verdict-card");
  await waitFor(() => expect(tid("story-select")).not.toHaveTextContent("Loading stories")); // the stories and the talk track come from the server
  return view;
};
const tid = (x) => screen.getByTestId(x);
const q = (x) => screen.queryByTestId(x);
const click = (x) => fireEvent.click(typeof x === "string" ? tid(x) : x);
const word = () => tid("verdict-word").textContent;
const waitWord = (w) => waitFor(() => expect(word()).toBe(w));
const pick = (id) => fireEvent.change(tid("story-select"), { target: { value: id } });

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); delete document.documentElement.dataset.presenter; delete document.documentElement.dataset.talk; });

describe("stories", () => {
  test("a ?story= link opens the story, sets its door and starts its run; the check line says it matches", async () => {
    await mount({}, "?story=S02");
    await waitWord("Blocked by policy");
    expect(tid("story-card")).toHaveTextContent("S02 · The door that permits some tools");
    expect(tid("story-select")).toHaveValue("S02");
    expect(tid("door-lab-banking-limited")).toHaveAttribute("aria-checked", "true");
    expect(tid("story-check")).toHaveTextContent("This run gave Blocked by policy, as the story says.");
    // a call story lands on the response tab with the tool selected
    expect(tid("tab-args")).toHaveAttribute("aria-selected", "true");
    expect(t.calls.filter((c) => c.path === "/api/call")).toHaveLength(1);
    expect(t.calls.find((c) => c.path === "/api/call").body).toMatchObject({ door: "lab-banking-limited", tool: "sensitive_payroll_details" });
  });

  test("every one of the six links works: the story names a door and a run, and the verdict is the one it expects", async () => {
    const expected = { S01: "Allowed", S02: "Blocked by policy", S03: "Blocked by policy", S04: "Held", S05: "Upstream error", S06: "Allowed" };
    for (const [id, want] of Object.entries(expected)) {
      const view = await mount({}, `?story=${id}`);
      await waitFor(() => expect(word()).toBe(want));
      await waitFor(() => expect(tid("story-check")).toHaveTextContent("as the story says"));
      view.unmount();
    }
  });

  test("S05 injects the failure by its own scenario and S06 is told as demouser (the page login) with the mismatch labelled simulated", async () => {
    await mount({}, "?story=S05");
    await waitWord("Upstream error");
    expect(tid("scenario-select")).toHaveValue("upstream-error");
  });
  test("S06: signs in as demouser (Mock sign-in is available and nobody was signed in) and shows both identities as a simulated scenario", async () => {
    await mount({}, "?story=S06");
    await waitWord("Allowed");
    await waitFor(() => expect(tid("page-login-name")).toHaveTextContent("demouser"));
    expect(tid("story-persona")).toHaveTextContent("demouser");
    expect(tid("gateway-identity")).toHaveTextContent(/SIMULATED scenario/);
  });
  test("a person who is already signed in is not replaced by the story's persona", async () => {
    await mount({ session: { source: "mock-persona", id: "aidemo", name: "aidemo", email: "aidemo@example.com", expiresAt: new Date(Date.now() + 3600e3).toISOString() } }, "?story=S06");
    await waitWord("Allowed");
    expect(t.calls.some((c) => c.path === "/api/auth/mock/login")).toBe(false);
    expect(tid("page-login-name")).toHaveTextContent("aidemo");
  });
  test("when Mock sign-in is not available the story still runs, and says nothing about a sign-in it did not do", async () => {
    await mount({ authConfig: { workspace: "default", source: "mock", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { configured: false, problems: [] } } }, "?story=S06");
    await waitWord("Allowed");
    expect(t.calls.some((c) => c.path === "/api/auth/mock/login")).toBe(false);
    expect(q("page-login-name")).toBeNull();
  });

  test("the picker: choose a story, run it, run a step, close it; the address follows the choice", async () => {
    await mount();
    expect(q("story-card")).toBeNull();
    expect(tid("story-select").querySelectorAll("option")).toHaveLength(7); // free exploration + six
    pick("S01");
    expect(tid("story-card")).toBeInTheDocument();
    expect(word()).toBe("Ready"); // choosing does not run; the button does
    expect(window.location.search).toBe("?story=S01");
    click("story-run");
    await waitWord("Allowed");
    expect(tid("tab-tools")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tid("tool-count")).toHaveTextContent("18 of 18"));
    click("story-step-run-3"); // run a read-only tool
    await waitFor(() => expect(tid("story-step-check-3")).toHaveTextContent("as the story says"));
    expect(tid("tab-args")).toHaveAttribute("aria-selected", "true");
    click("story-close");
    expect(q("story-card")).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("a story step with no run has no Run button; the steps carry what to say and why", async () => {
    await mount();
    pick("S01");
    expect(q("story-step-run-1")).toBeNull();
    expect(tid("story-step-1")).toHaveTextContent(/Say:/);
    expect(tid("story-step-1")).toHaveTextContent(/Why:/);
  });

  test("a bad or unknown ?story= is said, not ignored, and nothing runs", async () => {
    await mount({}, "?story=S99");
    expect(await screen.findByTestId("story-urlnote")).toHaveTextContent("There is no story S99");
    expect(word()).toBe("Ready");
    expect(q("story-card")).toBeNull();
  });
  test("a hostile ?story= value is shown as nothing but a plain note (it never reaches the page as markup)", async () => {
    await mount({}, "?story=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    expect(await screen.findByTestId("story-urlnote")).toHaveTextContent("not a story id");
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.body.innerHTML).not.toContain("onerror");
  });

  test("the words are the chosen vertical's, no {{token}} is left, and switching the vertical changes them", async () => {
    await mount();
    expect(tid("vertical-select")).toHaveValue("retail");
    pick("S01");
    expect(tid("story-card")).toHaveTextContent("Northwind Retail");
    fireEvent.change(tid("vertical-select"), { target: { value: "finance" } });
    await waitFor(() => expect(tid("story-card")).toHaveTextContent("Fabrikam Bank"));
    expect(tid("story-card")).toHaveTextContent("payments-agent");
    expect(document.body.textContent).not.toMatch(/\{\{/);
    fireEvent.change(tid("vertical-select"), { target: { value: "health" } });
    await waitFor(() => expect(tid("story-card")).not.toHaveTextContent("Fabrikam Bank"));
    expect(tid("story-card")).toHaveTextContent(/Harbor|Meridian|health|clinic|care/i);
    expect(tid("stories")).toHaveTextContent("Health");
  });

  test("Real: the Mock-only stories are marked, cannot run and say why; a story that does run in Real uses a door Real has", async () => {
    await mount({ env: REAL_ENV });
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(within(tid("story-select")).getByText(/S04.*\(Mock only\)/)).toBeInTheDocument();
    pick("S04");
    expect(tid("story-block")).toHaveTextContent(/runs in Mock only/);
    expect(tid("story-run")).toBeDisabled();
    expect(tid("story-step-run-1")).toBeDisabled();
    pick("S01"); // lab-banking-full is the one door this Real config has
    expect(q("story-block")).toBeNull();
    expect(tid("story-run")).not.toBeDisabled();
  });
  test("Real: ?story=S04 opens the story but does not run it and does not switch the mode", async () => {
    // The lab starts in Real (configured), so the link is read in Real.
    await mount({ env: { ...REAL_ENV, MODE: "real" } }, "?story=S04");
    expect(tid("sim-banner")).toHaveAttribute("data-state", "live");
    expect(await screen.findByTestId("story-block")).toHaveTextContent(/runs in Mock only/);
    expect(t.calls.filter((c) => c.path === "/api/call")).toHaveLength(0);
    expect(word()).toBe("Ready");
  });

  test("the story area survives a story or talk-track outage: the lab still works", async () => {
    await mount({ hooks: { "/api/stories": () => { throw Object.assign(new Error("stories are down"), { status: 500 }); } } });
    await waitFor(() => expect(tid("story-error")).toHaveTextContent(/stories are down/));
    click("action-discover");
    await waitWord("Allowed");
  });
});

describe("branding and workspace", () => {
  test("customer.config name and tagline are the page's brand and title; the vertical it names is the starting one", async () => {
    await mount({ customerConfig: { name: "Contoso Gateway Lab", tagline: "Which tools may our agent use?", vertical: "health", cast: { brand: "Contoso Clinics" } } });
    expect(tid("brand-name")).toHaveTextContent("Contoso Gateway Lab");
    expect(tid("brand-tagline")).toHaveTextContent("Which tools may our agent use?");
    await waitFor(() => expect(document.title).toBe("Contoso Gateway Lab"));
    expect(tid("vertical-select")).toHaveValue("health");
    pick("S01");
    expect(tid("story-card")).toHaveTextContent("Contoso Clinics");
  });
  test("the default workspace shows no chip; a bad workspace in the address says so", async () => {
    await mount();
    expect(q("workspace-chip")).toBeNull();
    expect(tid("brand-name")).toHaveTextContent("Privilege Gateway Client Lab");
  });
  test("with ?workspace=team-1 every request carries X-Workspace and the page names the workspace", async () => {
    vi.resetModules();
    window.history.replaceState(null, "", "/?workspace=team-1");
    const seen = [];
    vi.stubGlobal("fetch", async (path, init) => { seen.push({ path, h: init.headers }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
    const { api } = await import("./api.js");
    await api("/api/info");
    expect(seen[0].h["X-Workspace"]).toBe("team-1");
    const mod = await import("./App.jsx");
    const t2 = createTestApi();
    vi.stubGlobal("fetch", fetchFrom(t2.api));
    render(<mod.default />);
    await screen.findByTestId("verdict-card");
    expect(tid("workspace-chip")).toHaveTextContent("Workspace: team-1");
    vi.resetModules();
  });
});

describe("mode and sign-in states", () => {
  test("the source is shown from /api/info at all times; Mock without Real says how to configure it", async () => {
    await mount();
    expect(tid("mode-source")).toHaveTextContent(/Source: Mock \(simulated\)/);
    expect(tid("mode-source")).toHaveTextContent(/Real option is off/);
    expect(tid("mode-status")).toHaveAttribute("data-wanted-unavailable", "false");
    expect(q("mode-unavailable")).toBeNull();
  });
  test("MODE=real with Real not configured: a visible warning that Real was asked for but the page shows Mock (rule 26)", async () => {
    await mount({ env: { MODE: "real" } });
    expect(tid("mode-unavailable")).toHaveTextContent(/Real was asked for .*not available.*showing Mock/);
    expect(tid("mode-unavailable")).toHaveAttribute("role", "alert");
    expect(tid("mode-select")).toHaveValue("mock");
  });
  test("Real configured: Mock says Real is available; switching shows Real, reloads data, and back again", async () => {
    await mount({ env: REAL_ENV });
    expect(tid("mode-source")).toHaveTextContent(/Real is configured here/);
    click("action-discover");
    await waitWord("Allowed");
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("mode-source")).toHaveTextContent(/Source: Real/));
    expect(word()).toBe("Ready"); // data reloaded
    fireEvent.change(tid("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(tid("mode-source")).toHaveTextContent(/Source: Mock/));
  });
  test("choosing Real when it is not configured is a 409 the page shows; the mode stays Mock", async () => {
    await mount();
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("mode-error")).toBeInTheDocument());
    expect(tid("mode-select")).toHaveValue("mock");
  });

  test("Mock sign-in refused by a guard: the rail shows a disabled Sign in with the reason as text and as its tooltip; no header Sign in", async () => {
    await mount({ authConfig: { workspace: "default", source: "mock", idp: "mock", mock: { enabled: true, available: false, refusal: "proxy_header" }, real: { configured: false, problems: [] } } });
    expect(q("sign-in")).toBeNull();
    expect(tid("rail-sign-in")).toBeDisabled();
    expect(tid("rail-sign-in").title).toMatch(/proxy/);
    expect(tid("signin-why")).toHaveTextContent(/proxy/);
  });
  test("Real page login not configured: the Sign in control is disabled with the how-to (pi.flow form, no redirect), and the login note says the identity is the key's", async () => {
    await mount({ env: REAL_ENV });
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(tid("rail-sign-in")).toBeDisabled();
    expect(tid("rail-sign-in").title).toMatch(/PGC_PINGONE_\*.*pi\.flow/s);
    expect(tid("login-note")).toHaveTextContent(/identity of the door's agent key.*declared by its own settings/);
  });
  test("Real page login configured: the Sign in control opens the shared password dialog (no persona picker)", async () => {
    await mount({ env: REAL_ENV, authConfig: { workspace: "default", source: "mock", idp: null, mock: { enabled: false, available: false, refusal: "disabled" }, real: { flow: "pi.flow", configured: true, problems: [] } } });
    fireEvent.change(tid("mode-select"), { target: { value: "real" } });
    await waitFor(() => expect(tid("sim-banner")).toHaveAttribute("data-state", "live"));
    expect(tid("rail-sign-in")).not.toBeDisabled();
    click("sign-in");
    const dlg = await screen.findByTestId("signin-dialog");
    expect(dlg.querySelector('input[type="password"]')).not.toBeNull();
    expect(q("persona-demouser")).toBeNull();
  });
  test("the persona picker lists aidemo, demouser and demoAdmin as three ordinary users: no admin mark on any of them", async () => {
    await mount();
    click("sign-in");
    await screen.findByTestId("persona-demouser");
    expect(tid("persona-aidemo")).toBeInTheDocument();
    const admin = await screen.findByTestId("persona-demoAdmin");
    for (const el of [tid("persona-aidemo"), tid("persona-demouser"), admin]) expect(el.textContent).not.toMatch(/\badmin persona\b|\(local switch/i);
    expect(admin.querySelector(".pgc-chip")).toBeNull();
    expect(admin.textContent).toBe(tid("persona-demouser").textContent.replace("demouser", "demoAdmin").replace("demouser@", "demoadmin@"));
  });
  test("even if a server still sent an admin flag, the picker gives demoAdmin no mark", async () => {
    await mount({ hooks: { "/api/auth/mock/personas": () => ({ personas: [{ id: "demoAdmin", name: "demoAdmin", email: "demoadmin@example.com", role: "Admin", admin: true }] }) } });
    click("sign-in");
    expect((await screen.findByTestId("persona-demoAdmin")).querySelector(".pgc-chip")).toBeNull();
  });
  test("even if a server still sent isAdmin, the rail adds no extra wording", async () => {
    await mount({ hooks: { "/api/session": () => ({ me: { source: "mock-persona", id: "demoAdmin", name: "demoAdmin", email: "demoadmin@example.com", isAdmin: true } }) } });
    expect(tid("page-login-name")).toHaveTextContent("demoAdmin");
    expect(tid("page-login").textContent).not.toMatch(/admin persona/i);
  });
  test("signed in as demoAdmin, the rail says nothing special about it", async () => {
    await mount();
    click("sign-in");
    click(await screen.findByTestId("persona-demoAdmin"));
    await waitFor(() => expect(tid("page-login-name")).toHaveTextContent("demoAdmin"));
    expect(tid("page-login").textContent).not.toMatch(/admin persona/i);
  });
});

describe("presenter mode and the talk track", () => {
  test("Present turns on larger type and opens the talk track beside the page; the banner is still first in main; Esc/P and the button turn it off", async () => {
    await mount();
    expect(document.documentElement.dataset.presenter).toBe("0");
    click("presenter");
    expect(document.documentElement.dataset.presenter).toBe("1");
    expect(tid("presenter")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("talk-track-dialog")).toBeInTheDocument();
    expect(document.documentElement.dataset.talk).toBe("open");
    expect(document.querySelector("main").firstElementChild).toBe(tid("sim-banner"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.documentElement.dataset.presenter).toBe("0");
    fireEvent.keyDown(document.body, { key: "p" });
    expect(document.documentElement.dataset.presenter).toBe("1");
    fireEvent.keyDown(document.body, { key: "P" });
    expect(document.documentElement.dataset.presenter).toBe("0");
  });
  test("the P key is not taken while typing, and Escape inside a dialog does not leave presenter mode", async () => {
    await mount();
    click("presenter");
    await screen.findByTestId("talk-track-dialog");
    fireEvent.keyDown(tid("story-select"), { key: "p" });
    expect(document.documentElement.dataset.presenter).toBe("1");
    fireEvent.keyDown(tid("talk-track-dialog"), { key: "Escape" });
    expect(document.documentElement.dataset.presenter).toBe("1");
  });
  test("Escape that closes the modal Sign in dialog does not also leave presenter mode", async () => {
    await mount();
    click("presenter");
    await screen.findByTestId("talk-track-dialog");
    click("sign-in");
    const dlg = await screen.findByTestId("signin-dialog");
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(q("signin-dialog")).toBeNull());
    expect(document.documentElement.dataset.presenter).toBe("1");
  });
  test("the lab's own setting (PGC_PRESENTER=1) and ?presenter=1 start in presenter mode", async () => {
    await mount({ presenter: true });
    await waitFor(() => expect(document.documentElement.dataset.presenter).toBe("1"));
    expect(await screen.findByTestId("talk-track-dialog")).toBeInTheDocument();
  });
  test("?presenter=1 starts in presenter mode", async () => {
    await mount({}, "?presenter=1");
    expect(document.documentElement.dataset.presenter).toBe("1");
  });

  test("the Talk track opens from the header toggle, is non-modal, carries the server's sections with the vertical's words, and closes", async () => {
    await mount();
    expect(q("talk-track-dialog")).toBeNull();
    click("talk-track-toggle");
    const dlg = await screen.findByTestId("talk-track-dialog");
    expect(dlg).not.toHaveAttribute("aria-modal"); // non-modal: the page stays usable while the script is open
    expect(document.querySelector(".fd-backdrop")).toBeNull();
    const items = within(tid("talk-track")).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(tid("talk-track")).toHaveTextContent("Northwind Retail");
    expect(tid("talk-track")).toHaveTextContent("The door that permits every tool");
    expect(document.body.textContent).not.toMatch(/\{\{/);
    expect(tid("talk-track-toggle")).toHaveAttribute("aria-pressed", "true");
    click("talk-track-toggle");
    await waitFor(() => expect(q("talk-track-dialog")).toBeNull());
    click("talk-track-toggle");
    expect(await screen.findByTestId("talk-track-dialog")).toBeInTheDocument();
    // the vertical changes its words
    fireEvent.change(tid("vertical-select"), { target: { value: "finance" } });
    await waitFor(() => expect(tid("talk-track")).toHaveTextContent("Fabrikam Bank"));
  });
  test("the page stays usable while the talk track is open (a verdict can be produced)", async () => {
    await mount();
    click("talk-track-toggle");
    await screen.findByTestId("talk-track-dialog");
    click("action-discover");
    await waitWord("Allowed");
  });
});

describe("Reset", () => {
  test("Reset restores the page: run, story and its address, walk, views, talk track and presenter mode (back to how the lab started)", async () => {
    await mount({}, "?story=S01");
    await waitWord("Allowed");
    click("presenter");
    click("etab-reel");
    click(within(tid("epanel-reel")).getByTestId("step-next"));
    expect(tid("evidence-counter")).toHaveTextContent("Message 1 of");
    expect(window.location.search).toBe("?story=S01");
    click("reset");
    await waitWord("Ready");
    expect(q("story-card")).toBeNull();
    expect(window.location.search).toBe("");
    expect(q("talk-track-dialog")).toBeNull();
    expect(tid("evidence-counter")).toHaveTextContent("No run yet");
    // "Ready" shows as soon as the lab's runs are cleared; the page restores presenter mode after the reset call returns, so wait for it.
    await waitFor(() => expect(document.documentElement.dataset.presenter).toBe("0"));
    expect(t.calls.some((c) => c.path === "/api/reset" && c.method === "POST")).toBe(true);
  });
  test("Reset keeps the mode and a lab started in presenter mode stays in it", async () => {
    await mount({ presenter: true });
    await waitFor(() => expect(document.documentElement.dataset.presenter).toBe("1"));
    click("action-discover");
    await waitWord("Allowed");
    click("reset");
    await waitWord("Ready"); // the reset has finished
    expect(document.documentElement.dataset.presenter).toBe("1");
    expect(tid("mode-select")).toHaveValue("mock");
  });
});
