// The lab's core: one object per app instance that owns the mock gateway, the netguard, the Real wiring, the mode and the run
// log, and turns "discover this door" / "run this tool" into one run record (verdict, hops, trace). app.js only routes to it.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createMockGateway, MOCK_ORIGIN } from './mockGateway.js';
import { createMockClientFactory } from './mockClient.js';
import { createNetguard, selfTest as netguardSelfTest } from './netguard.js';
import { createRealDoor } from './gatewayReal.js';
import { loadReal } from './realDoor.js';
import { createMode } from './mode.js';
import { verdictFor, identityFor } from './verdict.js';
import { buildHops, failed, statusOf } from './hops.js';
import { traceFromDoor, assertTrace } from './gatewayTrace.js';
import { DOORS, TOOLS, SCENARIOS, MOCK_IDENTITY, MOCK_PAGE_LOGIN, DOOR_NAME, TOOL_NAME, callerIdFor, sampleArgsFor, toolByName, doorById } from './doors.js';
import { ENV_PREFIX } from './config.js';
import { createWorkspaces, DEFAULT_WORKSPACE } from './workspaces.js';
import { readSettings } from './settings.js';
import { loginConfig } from './auth/pingoneLogin.js';
import { formFromSchema, cleanSchema } from './toolSchema.js';
import { createAgentChat } from './agentChat.js';

export class LabError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const MAX_ARGS_BYTES = 8 * 1024;
const MAX_ARGS_DEPTH = 8;
const MAX_RUNS = 20;
const catalogFile = new URL('./vendor/hop-catalog.json', import.meta.url);

// Iterative depth and size check, so a hostile nesting cannot blow the stack (Node 22+ stacks are small).
function checkArguments(args) {
  if (args === undefined) return {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new LabError(400, 'bad_arguments', 'arguments must be a JSON object');
  const stack = [[args, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > MAX_ARGS_DEPTH) throw new LabError(400, 'bad_arguments', `arguments are nested more than ${MAX_ARGS_DEPTH} levels deep`);
    if (v && typeof v === 'object') for (const c of Object.values(v)) stack.push([c, d + 1]);
  }
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_ARGS_BYTES) throw new LabError(400, 'bad_arguments', `arguments are larger than ${MAX_ARGS_BYTES} bytes`);
  return args;
}

// The shared client keeps only the first 300 characters of an HTTP error body in its message (and cuts without saying so). The captured wire body
// holds the fuller text (scrubbed of keys at capture), so a long message is rebuilt from it; if there is nothing fuller, the cut is marked.
const CLIENT_CAP = 300;
function fullerMessage(bad, message) {
  if (typeof message !== 'string' || message.length < CLIENT_CAP || !/^MCP HTTP \d{3}/.test(message)) return message;
  const b = bad?.response?.body;
  const text = typeof b === 'string' ? b : typeof b?.message === 'string' ? b.message : typeof b?.error?.message === 'string' ? b.error.message : null;
  return text ? `${message.match(/^MCP HTTP \d{3}/)[0]}: ${text}` : `${message}… (shortened)`;
}

// A tool result: the shared client keeps the first 800 characters of its text (silently). The captured wire body holds the whole reply, so the
// text is rebuilt from it, up to this lab's own cap; past the cap the cut is marked.
const CLIENT_TEXT_CAP = 800;
const RESULT_CAP = 20000;
function fullResultText(result) {
  const text = typeof result?.text === 'string' ? result.text : '';
  if (text.length < CLIENT_TEXT_CAP) return text;
  const reply = [...(Array.isArray(result?.wire) ? result.wire : [])].reverse().find((w) => w.rpcMethod === 'tools/call')?.response?.body?.result;
  const whole = Array.isArray(reply?.content) ? reply.content.map((x) => (x?.type === 'text' ? x.text : `[${x?.type}]`)).join('\n') : null;
  const best = typeof whole === 'string' && whole.length > text.length ? whole : text;
  if (best.length > RESULT_CAP) return `${best.slice(0, RESULT_CAP)}… (shortened)`;
  return best === text && text.length >= CLIENT_TEXT_CAP && !(typeof whole === 'string' && whole.length === text.length) ? `${text}… (shortened)` : best;
}

function classify(result, { action, source }) {
  const wire = Array.isArray(result?.wire) ? result.wire : [];
  const bad = wire.find((w) => w.http === 'POST' && failed(w));
  const message = fullerMessage(bad, result?.refusal?.message ?? bad?.response?.body?.message ?? bad?.response?.body?.error?.message ?? bad?.error ?? null);
  if (bad) {
    const s = statusOf(bad);
    if (s === 401) return { outcome: 'key', status: s, message };
    if (s === 403) return { outcome: 'policy', status: s, message };
    if (s === null || s >= 500) return { outcome: 'upstream', status: s, message };
    // The simulated gateway answers -32602 (invalid params) for a missing or empty required argument and for an unknown tool name: the caller's
    // mistake. A real gateway's -32602 is not read this way, because Real cannot tell it from a refusal worded as one.
    if (source === 'mock' && bad?.response?.body?.error?.code === -32602) return { outcome: 'bad-request', status: s, message };
    return { outcome: 'rpc-error', status: s, message };
  }
  if (!result?.ok) return { outcome: 'upstream', status: null, message: message ?? 'the call did not complete' };
  const primary = [...wire].reverse().find((w) => w.rpcMethod === (action === 'call' ? 'tools/call' : 'tools/list'));
  const body = primary?.response?.body;
  if (!body || body.result === undefined) return { outcome: 'unusable', status: statusOf(primary), message };
  if (source === 'mock' && body.result?._meta?.held === true) return { outcome: 'held', status: statusOf(primary), message: null };
  if (action === 'call' && result.isError) return { outcome: 'tool-error', status: statusOf(primary), message: result.text };
  return { outcome: 'ok', status: statusOf(primary), message: null };
}

// name -> inputSchema, from the last captured tools/list reply (already scrubbed and size-capped by the shared client).
function schemasFromWire(wire) {
  const rec = [...(wire ?? [])].reverse().find((w) => w.rpcMethod === 'tools/list');
  const listed = rec?.response?.body?.result?.tools;
  return new Map(Array.isArray(listed) ? listed.filter((t) => t && typeof t.name === 'string').map((t) => [t.name, t.inputSchema]) : []);
}

export function createLab({ env = process.env, version = '0.0.0', catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')), modelFetch = globalThis.fetch } = {}) {
  const mockGateway = createMockGateway();
  // The guard reads the mode and the Real origin lazily, because Real is loaded with the guard and the mode needs Real's state.
  let real;
  let mode;
  const login = loginConfig(env);
  let agentChat = null; // the Real agent; built at the end, once the lab object exists (it runs its tools through lab.discover and lab.call)
  const guard = createNetguard({ getMode: () => mode.get(), mockGateway, getRealOrigin: () => real?.origin ?? null, getLoginBase: () => (login.ok ? login.base : null), getModelConfigured: () => agentChat?.info().configured === true });
  real = loadReal(env, guard, { clientInfo: { name: 'privilege-gateway-client-lab', version } });
  mode = createMode({ wanted: env.MODE, realAvailable: real.available, realReason: real.reason });
  const workspaces = createWorkspaces({ dataDir: readSettings(env).dataDir });

  const activeDoors = () => (mode.get() === 'real' ? real.doors : DOORS.map((d) => d.id));

  function prepare({ door, scenario = 'none', tool, args }) {
    const source = mode.get();
    if (typeof door !== 'string' || !DOOR_NAME.test(door) || !activeDoors().includes(door)) throw new LabError(404, 'unknown_door', 'No such door in the active mode.');
    if (typeof scenario !== 'string' || !SCENARIOS.includes(scenario)) throw new LabError(400, 'bad_scenario', `scenario must be one of ${SCENARIOS.join(', ')}`);
    if (source === 'real' && scenario !== 'none') throw new LabError(400, 'mock_only', 'Scenarios are simulated and exist in Mock only. Real shows what the gateway really did.');
    if (tool !== undefined && (typeof tool !== 'string' || !TOOL_NAME.test(tool))) throw new LabError(400, 'bad_tool', 'tool must be a short name of letters, digits, dot, dash and underscore');
    if (source === 'real' && !real.callerIds.has(callerIdFor(door))) throw new LabError(409, 'no_key_for_door', `No agent key is set for door ${door}. Add ${ENV_PREFIX}_GW_KEY_${callerIdFor(door).toUpperCase()} to this lab's own .env and restart.`);
    return { source, scenario, args: tool === undefined ? undefined : checkArguments(args) };
  }

  function mockDoorFor(scenario, doorId) {
    const callers = DOORS.map((d) => ({ id: callerIdFor(d.id), label: d.id, key: scenario === 'bad-key' && d.id === doorId ? 'mock-wrong-agent-key' : mockGateway.keyFor(d.id) }));
    const client = createMockClientFactory({ fetch: guard.guardedFetch, noKey: scenario === 'no-key' });
    return createRealDoor({ config: { ok: true, origin: MOCK_ORIGIN, apps: DOORS.map((d) => d.id), callers, version: null }, client, clientInfo: { name: 'privilege-gateway-client-lab', version }, capture: true });
  }

  async function run(action, { door, scenario, tool, args: rawArgs }, { traceparent, workspace = DEFAULT_WORKSPACE, pageLogin = null } = {}) {
    const ws = workspaces.get(workspace);
    if (action === 'call' && tool === undefined) throw new LabError(400, 'bad_tool', 'tool is required');
    const { source, scenario: sc, args } = prepare({ door, scenario, tool, args: rawArgs });
    const mock = source === 'mock';
    const method = action === 'call' ? 'tools/call' : 'tools/list';
    const callerId = callerIdFor(door);
    if (mock && sc === 'upstream-error') mockGateway.armFault(door, method);
    let result;
    try {
      const doorApi = mock ? mockDoorFor(sc, door) : real.door;
      result = action === 'call' ? await doorApi.call(door, callerId, tool, args) : await doorApi.list(door, callerId);
    } catch (err) {
      // The shared door catches its own errors; this is the netguard or an unexpected throw: a named JSON failure, never a hang.
      result = { ok: false, refusal: { status: null, message: String(err?.message ?? 'the call failed').slice(0, 300), layer: 'other' }, ms: 0, wire: [] };
    } finally { mockGateway.clearFault(); }

    const cls = classify(result, { action, source });
    const doorCfg = mock ? doorById(door) : null;
    const mismatch = mock && sc === 'identity-mismatch';
    // The page-login user of the Mock mismatch scenario: the persona signed in to this workspace when it differs from the gateway's identity (a person cannot mismatch themselves), else demouser.
    const shownLogin = pageLogin && pageLogin.name !== MOCK_IDENTITY.name ? pageLogin : MOCK_PAGE_LOGIN;
    const identity = identityFor({ source, declared: real.identity, mismatch, mockIdentity: MOCK_IDENTITY, pageLogin: shownLogin });

    // The tool list for a discovery: exactly what the gateway listed. Mock and Real both list only what the grant allows, so a listed tool carries no permitted mark.
    let tools = null;
    if (action === 'discover' && cls.outcome === 'ok') {
      const listedSchemas = mock ? new Map() : schemasFromWire(result.wire);
      tools = (result.tools ?? []).map((t) => {
        const known = toolByName(t.name);
        if (mock) return { name: t.name, description: t.description, args: sampleArgsFor(t.name), required: known ? [...known.required] : [], write: Boolean(known?.write) };
        // Real: the form and the agent use the tool's own listed schema, never the Mock samples (a Mock argument name is not the real tool's).
        // The shared Real client keeps only name and description, so the schema is read from the captured tools/list reply.
        const schema = listedSchemas.get(t.name);
        const form = formFromSchema(schema);
        return { name: t.name, description: t.description, args: form ? form.args : {}, required: form ? form.required : [], write: Boolean(known?.write), inputSchema: cleanSchema(schema) };
      });
    }
    const counts = tools ? { total: tools.length } : undefined;
    const facts = { source, action, door, tool, outcome: cls.outcome, status: cls.status, message: cls.message, tools: counts, policy: doorCfg ? doorCfg.policy : undefined, scenario: sc, mockSub: MOCK_IDENTITY.name };
    const verdict = verdictFor(facts, identity);
    const built = buildHops({ source, action, door, tool, args, scenario: sc, result, facts, verdict, catalog, gateway: mock ? mockGateway : null, incomingTraceparent: traceparent });

    const trace = traceOf(result, method, source);
    const problems = assertTrace(trace);
    const record = {
      id: randomBytes(6).toString('hex'), at: new Date().toISOString(), source, simulated: mock, action, door, tool: tool ?? null, scenario: sc,
      identity, verdict, tools,
      result: action === 'call' && cls.outcome === 'ok' ? { text: fullResultText(result), isError: result.isError === true } : null,
      hops: built.hops, hopProblems: built.problems, traceId: built.traceId, trace, traceProblems: problems,
    };
    ws.runs.unshift({ id: record.id, at: record.at, source, action, door, tool: record.tool, verdict: { id: verdict.id, word: verdict.word } });
    ws.runs.length = Math.min(ws.runs.length, MAX_RUNS);
    // The trace sink keeps only what is already redacted: the hops (the shared hop-detail redacts at capture) and the run's facts.
    ws.sink.add({ id: record.id, at: record.at, workspace: ws.id, source, door, tool: record.tool, verdict: { id: verdict.id, word: verdict.word }, traceId: record.traceId, hops: record.hops });
    return record;
  }

  function traceOf(result, method, source) {
    const t = traceFromDoor(result, { rpcMethod: method });
    if (source === 'real') return t;
    const rec = [...(result.wire ?? [])].reverse().find((w) => w.rpcMethod === method) ?? [...(result.wire ?? [])].reverse().find((w) => w.http === 'POST');
    return { ...t, source: 'mock', decisions: (rec?.mock?.decisions ?? []).map((d) => ({ basis: 'checked', ...d })), record: null };
  }

  const doorList = () => {
    if (mode.get() === 'real') return real.doors.map((id) => ({ id, description: null, policy: null, keyed: real.callerIds.has(callerIdFor(id)) }));
    return DOORS.map((d) => ({ id: d.id, description: d.description, policy: d.policy, keyed: true }));
  };

  const lab = {
    mode,
    info() {
      const source = mode.get();
      return {
        source, realAvailable: real.available, realReason: real.reason, realWanted: mode.realWanted, startNote: mode.startNote(),
        gateway: { origin: source === 'real' ? real.origin : MOCK_ORIGIN, simulated: source === 'mock' },
        doors: doorList(),
        identity: identityFor({ source, declared: real.identity, mockIdentity: MOCK_IDENTITY, pageLogin: MOCK_PAGE_LOGIN }),
        scenarios: source === 'mock' ? SCENARIOS : ['none'],
        catalog: TOOLS.map((t) => ({ name: t.name, description: t.description, args: structuredClone(t.args), required: [...t.required], write: Boolean(t.write) })),
        // The Real agent chat: configured or not, which model, and what to set. Never the key.
        agent: (({ configured, model, reason }) => ({ configured, model, reason, available: source === 'real' && configured }))(agentChat.info()),
        version,
      };
    },
    agentTurn: (input, opts) => agentChat.turn(input, opts),
    setSource: (next) => mode.set(next),
    discover: (input, opts) => run('discover', input, opts),
    call: (input, opts) => run('call', input, opts),
    runs: (workspace = DEFAULT_WORKSPACE) => workspaces.get(workspace).runs.map((r) => ({ ...r })),
    trace: (workspace = DEFAULT_WORKSPACE) => workspaces.get(workspace).sink.entries(),
    // Reset clears one workspace (its run log, trace sink and data directory). The mock gateway's sessions and faults and the
    // netguard counters are shared by every workspace, so they are cleared too. The mode (Mock or Real) is left as it is.
    reset(workspace = DEFAULT_WORKSPACE) {
      workspaces.reset(workspace);
      mockGateway.reset();
      guard.resetStats();
      return { ok: true, workspace, cleared: ['run log', 'trace sink', 'sign-in session', 'mock gateway sessions and faults', 'netguard counters'], mode: mode.get() };
    },
    workspaces,
    login,
    guard,
    mockGateway,
    netguardSelfTest,
    realAvailable: real.available,
  };
  agentChat = createAgentChat({ env, lab, guard, fetchImpl: modelFetch });
  return lab;
}
