import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api as realApi } from "./api.js";

// The page's one source of data: it asks this lab's server (GET /api/info, POST /api/discover, /api/call, /api/mode, /api/reset, the sign-in
// routes) and keeps what came back. It decides nothing about policy: every verdict, sentence and tool mark comes from the server.
//
// Stale answers: a door switch, a mode switch or a reset bumps `epoch`; an answer that comes back for an older epoch is dropped, so a slow call
// for the door you just left can never paint over the door you are on.

const pretty = (v) => JSON.stringify(v, null, 2);

export function useLab({ api = realApi } = {}) {
  const [boot, setBoot] = useState("loading"); // loading | ready | error
  const [bootError, setBootError] = useState(null);
  const [info, setInfo] = useState(null);
  const [door, setDoor] = useState(null);
  const [scenario, setScenario] = useState("none");
  const [discovery, setDiscovery] = useState(null); // the latest discovery run for the current door (even a refused or failed one)
  const [lastRun, setLastRun] = useState(null); // the latest run of any kind for the current door
  const [busy, setBusy] = useState(null); // { kind: 'discover' | 'call', tool? }
  const [failure, setFailure] = useState(null); // this lab could not complete the last request (not a gateway verdict)
  const [selectedTool, setSelectedTool] = useState(null);
  const [argText, setArgText] = useState({});
  const [modeError, setModeError] = useState(null);
  const [me, setMe] = useState(null);
  const [authConfig, setAuthConfig] = useState(null);
  const epoch = useRef(0);
  const busyRef = useRef(false);
  const last = useRef(null); // the last action, so "Try again" repeats it

  const loadAuth = useCallback(async () => {
    const [s, c] = await Promise.allSettled([api("/api/session"), api("/api/auth/config")]);
    setMe(s.status === "fulfilled" ? s.value.me ?? null : null);
    setAuthConfig(c.status === "fulfilled" ? c.value : null);
  }, [api]);

  const clearRuns = useCallback(() => {
    epoch.current += 1;
    busyRef.current = false;
    setDiscovery(null); setLastRun(null); setBusy(null); setFailure(null); setSelectedTool(null);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const i = await api("/api/info");
      setInfo(i);
      setDoor((d) => (d && i.doors.some((x) => x.id === d) ? d : i.doors[0]?.id ?? null));
      await loadAuth(); // the sign-in state is known before the page says it is ready, so a story can decide about its persona
      setBoot("ready"); setBootError(null);
      return i;
    } catch (e) {
      setBoot("error"); setBootError(e);
      return null;
    }
  }, [api, loadAuth]);

  useEffect(() => { loadInfo(); }, [loadInfo]);

  const chooseDoor = useCallback((id) => {
    if (id === door || !info?.doors.some((d) => d.id === id)) return;
    clearRuns();
    setDoor(id);
  }, [door, info, clearRuns]);

  // Rule 19: POST /api/mode with exactly {source}; Real not configured is a 409 and the page stays as it was; every switch reloads the data.
  const setMode = useCallback(async (source) => {
    setModeError(null);
    try {
      await api("/api/mode", { method: "POST", body: { source } });
    } catch (e) {
      setModeError(e);
      return false;
    }
    clearRuns();
    setScenario("none"); setDoor(null);
    await loadInfo();
    return true;
  }, [api, clearRuns, loadInfo]);

  const exec = useCallback(async (kind, tool, args, scenarioOverride, doorOverride) => {
    const sc = scenarioOverride ?? scenario;
    const useDoor = doorOverride ?? door;
    if (!useDoor || busyRef.current) return null;
    const mine = epoch.current;
    busyRef.current = true;
    last.current = { kind, tool, args };
    setBusy({ kind, tool }); setFailure(null);
    try {
      const run = await api(kind === "discover" ? "/api/discover" : "/api/call", {
        method: "POST",
        body: { door: useDoor, ...(sc !== "none" ? { scenario: sc } : {}), ...(kind === "call" ? { tool, arguments: args } : {}) },
      });
      if (mine !== epoch.current) return null;
      setLastRun(run);
      if (kind === "discover") setDiscovery(run);
      return run;
    } catch (e) {
      if (mine !== epoch.current) return null;
      // A request this lab could not complete leaves no earlier answer standing as if it were current: the Arguments response, the Evidence
      // tab, every panel and the dock counter all read lastRun/discovery, so clearing them here makes every surface agree.
      setLastRun(null); setDiscovery(null);
      setFailure(e);
      return null;
    } finally {
      if (mine === epoch.current) { busyRef.current = false; setBusy(null); }
    }
  }, [api, door, scenario]);

  const discover = useCallback(() => exec("discover"), [exec]);

  const catalogOf = useCallback((name) => info?.catalog.find((t) => t.name === name) ?? null, [info]);
  // Real: the starting arguments are the ones the server built from the tool's own listed schema (the Mock samples name other arguments).
  const argsFor = useCallback((name) => {
    if (argText[name] !== undefined) return argText[name];
    const listed = discovery?.tools?.find((t) => t.name === name)?.args;
    if (info?.source === "real") return pretty(listed ?? {});
    return pretty(catalogOf(name)?.args ?? listed ?? {});
  }, [argText, catalogOf, discovery, info]);
  const setArgs = useCallback((name, text) => setArgText((a) => ({ ...a, [name]: text })), []);

  // Run a tool with the arguments the form holds (or the ones given). Arguments that are not a JSON object never leave the page.
  const callTool = useCallback((name, args) => {
    let parsed = args;
    if (parsed === undefined) {
      try { parsed = JSON.parse(argsFor(name)); } catch { return Promise.resolve(null); }
    }
    return exec("call", name, parsed);
  }, [exec, argsFor]);

  // One turn of the Real agent chat. The server discovers the door and runs every tool the model asks for as a normal run, so the latest
  // discovery and the latest run land where a Tools-tab run would (Evidence, panels). A failure is thrown for the chat to word.
  const agentTurn = useCallback(async (messages) => {
    if (!door || busyRef.current) return null;
    const mine = epoch.current;
    busyRef.current = true;
    setBusy({ kind: "agent" }); setFailure(null);
    try {
      const out = await api("/api/agent", { method: "POST", body: { door, messages } });
      if (mine !== epoch.current) return null;
      const disc = out.steps?.find((s) => s.kind === "discover")?.run;
      const runs = (out.steps ?? []).map((s) => s.run).filter(Boolean);
      if (disc) setDiscovery(disc);
      if (runs.length) setLastRun(runs[runs.length - 1]);
      return out;
    } catch (e) {
      if (mine !== epoch.current) return null;
      throw e;
    } finally {
      if (mine === epoch.current) { busyRef.current = false; setBusy(null); }
    }
  }, [api, door]);
  // Show one earlier run (a chat step) in Evidence and the panels.
  const showRun = useCallback((run) => { if (run) setLastRun(run); }, []);

  // Repeat the last action. `scenarioOverride` lets "run again without the scenario" use the new choice before React has re-rendered.
  const repeat = useCallback((scenarioOverride) => {
    const l = last.current;
    if (!l) return exec("discover", undefined, undefined, scenarioOverride);
    return exec(l.kind, l.tool, l.args, scenarioOverride);
  }, [exec]);

  const reset = useCallback(async () => {
    try { await api("/api/reset", { method: "POST", body: {} }); } catch (e) { setFailure(e); return false; }
    clearRuns();
    setScenario("none"); setArgText({}); setModeError(null);
    last.current = null;
    await loadAuth();
    return true;
  }, [api, clearRuns, loadAuth]);

  const signInMock = useCallback(async (persona) => {
    await api("/api/auth/mock/login", { method: "POST", body: { persona } });
    await loadAuth();
  }, [api, loadAuth]);
  const loginStarted = useRef(false);
  const signInReal = useCallback(async ({ username, password }) => {
    if (!loginStarted.current) { await api("/api/auth/live/start", { method: "POST", body: {} }); loginStarted.current = true; }
    try {
      const out = await api("/api/auth/live/credentials", { method: "POST", body: { username, password } });
      if (!out.ok) { loginStarted.current = false; throw new Error("The sign-in needs a step this lab does not drive. Use a user whose policy asks for a password only."); }
    } catch (e) {
      // A wrong password leaves the PingOne flow waiting, so the dialog may try again; anything else ends it.
      if (!["credentials_refused", "bad_username", "bad_password"].includes(e.code)) loginStarted.current = false;
      throw e;
    }
    loginStarted.current = false;
    await loadAuth();
  }, [api, loadAuth]);
  const signOut = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch { /* the session cookie is only a convenience */ }
    await loadAuth();
  }, [api, loadAuth]);

  // A story's (or a story step's) run: set the door and the scenario it names, sign in as the persona it is told as (Mock sign-in only, and only when
  // nobody is signed in: it never replaces a person who is), then run it. Whatever it does, the verdict comes from the server like any other run.
  const runSpec = useCallback(async (spec, { persona } = {}) => {
    clearRuns();
    setDoor(spec.door); setScenario(spec.scenario ?? "none"); setSelectedTool(spec.tool ?? null);
    if (persona && info?.source === "mock" && authConfig?.mock?.available && !me) {
      try { await signInMock(persona); } catch { /* the run does not depend on a page login */ }
    }
    const args = spec.tool ? info?.catalog.find((t) => t.name === spec.tool)?.args ?? {} : undefined;
    return exec(spec.action === "call" ? "call" : "discover", spec.tool, args, spec.scenario ?? "none", spec.door);
  }, [clearRuns, exec, info, authConfig, me, signInMock]);

  const hasTools = Boolean(discovery && discovery.verdict.id === "allowed" && Array.isArray(discovery.tools));
  const doorInfo = useMemo(() => info?.doors.find((d) => d.id === door) ?? null, [info, door]);

  const identity = lastRun?.identity ?? info?.identity ?? null;

  return {
    boot, bootError, info, identity, door, doorInfo, scenario, setScenario, discovery, lastRun, busy, failure, hasTools,
    selectedTool, setSelectedTool, argsFor, setArgs, modeError, me, authConfig,
    reload: loadInfo, runSpec, chooseDoor, setMode, discover, callTool, agentTurn, showRun, repeat, reset, signInMock, signInReal, signOut,
  };
}
