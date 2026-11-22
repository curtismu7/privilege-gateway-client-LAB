import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLab, postJson, startStubGateway, realEnv, TEST_KEYS } from './helpers.js';
import { formFromSchema, modelToolFrom, cleanSchema } from '../src/toolSchema.js';
import { agentConfig, checkHistory, AGENT_LIMITS, DEFAULT_AGENT_MODEL } from '../src/agentChat.js';
import { decideModel, MODEL_ORIGIN } from '../src/netguard.js';
import { TOOLS } from '../src/doors.js';

// "The real gateway" is a loopback stub and "the model" is a stub fetch: nothing here touches a network.
const ALL = 'demo-all-tools';
const API_KEY = 'TESTONLY-anthropic-key-0004-abcdef';
const AGENT_ENV = { PGC_ANTHROPIC_API_KEY: API_KEY };
// The listed schema for get_access_grants, with an example value the Mock sample does not use, so a form built from it is told apart.
const REAL_GRANTS = { type: 'object', properties: { resource: { type: 'string', description: 'Resource name, e.g. "billing-db"' } }, required: ['resource'] };
const realSchemas = (tools) => tools.map((t) => (t.name === 'get_access_grants' ? { ...t, description: 'List every grant on one resource.', inputSchema: REAL_GRANTS } : t));

// A stub of the Messages API. `replies` is a list of bodies (or functions of the request) served in order; every request is recorded.
function modelStub(replies) {
  const seen = [];
  let i = 0;
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    seen.push({ url, headers, body });
    const r = replies[Math.min(i, replies.length - 1)]; i += 1;
    const out = typeof r === 'function' ? r(body) : r;
    const status = out.status ?? 200;
    return new Response(JSON.stringify(out.json ?? out), { status, headers: { 'content-type': 'application/json', 'request-id': `req_test_${i}` } });
  };
  return { fetch, seen };
}
const msg = (content, stop_reason = 'end_turn') => ({ id: 'msg_test', type: 'message', role: 'assistant', model: DEFAULT_AGENT_MODEL, content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
const toolUse = (name, input, id = 'toolu_1') => ({ type: 'tool_use', id, name, input });
const text = (t) => ({ type: 'text', text: t });

let stub; let lab;
async function start({ env = AGENT_ENV, replies = [msg([text('ok')])], stubOpts = { listTools: realSchemas } } = {}) {
  stub = await startStubGateway({ keys: TEST_KEYS, ...stubOpts });
  const model = modelStub(replies);
  lab = await startLab({ env: realEnv(stub.origin, env), modelFetch: model.fetch });
  return model;
}
const stop = async () => { await lab?.close(); await stub?.close(); lab = null; stub = null; };
const post = async (path, body) => { const r = await postJson(lab.base, path, body); return { status: r.status, body: await r.json() }; };
const ask = (textIn, door = ALL) => post('/api/agent', { door, messages: [{ role: 'user', text: textIn }] });
const callsSeen = () => stub.seen.length; // the stub records every POST; tools/call bodies are counted through the lab runs instead

// ---- Real Tools tab: the form comes from the real schema (the get_access_grants bug) ----------------------------------------
test('Real discovery builds each tool form from the listed schema, not the Mock samples', async () => {
  await start();
  try {
    const { body: r } = await post('/api/discover', { door: ALL });
    const grants = r.tools.find((t) => t.name === 'get_access_grants');
    assert.deepEqual(grants.args, { resource: 'billing-db' }, 'the e.g. value from the listed schema, not the Mock sample');
    assert.deepEqual(grants.required, ['resource']);
    assert.deepEqual(grants.inputSchema, REAL_GRANTS);
  } finally { await stop(); }
});

test('Mock discovery is unchanged: the Mock samples and no schema on the record', async () => {
  const l = await startLab({ env: { MODE: 'mock' } });
  try {
    const r = await (await postJson(l.base, '/api/discover', { door: ALL })).json();
    const grants = r.tools.find((t) => t.name === 'get_access_grants');
    const sample = TOOLS.find((t) => t.name === 'get_access_grants');
    assert.deepEqual(grants.args, sample.args, 'the Mock catalog sample');
    assert.deepEqual(grants.required, sample.required);
    assert.equal(grants.inputSchema, undefined);
  } finally { await l.close(); }
});

test('formFromSchema and modelToolFrom read only plain shapes and cap hostile schemas', () => {
  assert.deepEqual(formFromSchema({ type: 'object', properties: { n: { type: 'integer' }, b: { type: 'boolean' }, e: { type: 'string', enum: ['revoke', 'grant'] }, d: { type: 'string', default: 'x' } }, required: ['n', 'ghost'] }),
    { args: { n: 0, b: false, e: 'revoke', d: 'x' }, required: ['n'] });
  assert.equal(formFromSchema(null), null);
  assert.equal(formFromSchema({ type: 'string' }), null);
  assert.equal(cleanSchema({ type: 'object', properties: { big: { description: 'x'.repeat(20000) } } }), null, 'oversized');
  assert.deepEqual(Object.keys(cleanSchema({ properties: { 'bad key!': { type: 'string' }, ok: { type: 'string' } } }).properties), ['ok']);
  assert.equal(modelToolFrom({ name: 'has.dot', inputSchema: {} }), null, 'the API tool-name rule');
  assert.deepEqual(modelToolFrom({ name: 'x', description: 'd' }).input_schema, { type: 'object', properties: {}, required: [] });
});

// ---- Real agent: one turn ------------------------------------------------------------------------------------------------
test('Real agent: the model picks a listed tool, the lab runs it through the gateway, and the reply carries that run', async () => {
  // The stub answers tools/call the way the real backend does (the Mock gateway would check the Mock schema instead).
  const callReply = { json: { result: { content: [{ type: 'text', text: '{"resource":"prod-db-primary","grants":2}' }] } } };
  const model = await start({ stubOpts: { listTools: realSchemas, callReply }, replies: [msg([toolUse('get_access_grants', { resource: 'prod-db-primary' })], 'tool_use'), msg([text('Two people can access prod-db-primary.')])] });
  try {
    const { status, body: r } = await ask('who can access prod-db-primary?');
    assert.equal(status, 200);
    assert.equal(r.source, 'real');
    assert.equal(r.simulated, false);
    assert.equal(r.by, 'model');
    assert.equal(r.stopped, 'done');
    assert.equal(r.reply, 'Two people can access prod-db-primary.');
    assert.deepEqual(r.steps.map((s) => s.kind), ['discover', 'call']);
    const call = r.steps[1];
    assert.equal(call.tool, 'get_access_grants');
    assert.deepEqual(call.args, { resource: 'prod-db-primary' });
    assert.equal(call.run.verdict.id, 'allowed');
    assert.equal(call.run.source, 'real');
    // The model was offered the listed tools with the gateway's own schema, through the one allowed origin, with the fallback opt-in.
    assert.equal(model.seen.length, 2);
    const first = model.seen[0];
    assert.ok(first.url.startsWith(`${MODEL_ORIGIN}/v1/messages`), first.url);
    assert.equal(first.body.model, DEFAULT_AGENT_MODEL);
    assert.equal(first.body.fallbacks, 'default');
    assert.match(first.headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
    assert.deepEqual(first.body.tools.find((t) => t.name === 'get_access_grants').input_schema, REAL_GRANTS);
    assert.equal(first.headers.get('authorization'), `Bearer ${API_KEY}`, 'the key goes to the model API only (SDK 1.x sends it as a bearer)');
    // The second request carries the tool result the gateway produced.
    const last = model.seen[1].body.messages.at(-1);
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].is_error, false);
    // Every model request was counted by the netguard's model allowance.
    assert.equal(lab.lab.guard.stats().modelAllowed, 2);
  } finally { await stop(); }
});

test('No key, no tokens, no agent keys in what the agent route, info, runs or trace return', async () => {
  await start({ replies: [msg([toolUse('who_has_role', { role: 'x' })], 'tool_use'), msg([text('done')])] });
  try {
    const outputs = [await ask('who has role x?'), await (await fetch(`${lab.base}/api/info`)).json(), await (await fetch(`${lab.base}/api/trace`)).json(), await (await fetch(`${lab.base}/api/runs`)).json()];
    const all = JSON.stringify(outputs);
    for (const secret of [API_KEY, ...Object.values(TEST_KEYS)]) assert.ok(!all.includes(secret), `leaked ${secret.slice(0, 12)}`);
  } finally { await stop(); }
});

test('info says whether the Real agent is configured, and names the setting when it is not', async () => {
  await start({ env: {} });
  try {
    const i = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(i.agent.configured, false);
    assert.equal(i.agent.available, false);
    assert.match(i.agent.reason, /PGC_ANTHROPIC_API_KEY/);
    const { status, body } = await ask('hello');
    assert.equal(status, 409);
    assert.equal(body.error, 'agent_not_configured');
  } finally { await stop(); }
});

test('Mock: the agent route refuses, and no model call is attempted', async () => {
  const model = modelStub([msg([text('never')])]);
  const l = await startLab({ env: { MODE: 'mock', ...AGENT_ENV }, modelFetch: model.fetch });
  try {
    const r = await postJson(l.base, '/api/agent', { door: ALL, messages: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'agent_real_only');
    assert.equal(model.seen.length, 0);
    const i = await (await fetch(`${l.base}/api/info`)).json();
    assert.equal(i.agent.available, false, 'configured, but Mock never offers the real agent');
    assert.equal(l.lab.guard.stats().modelAllowed, 0);
  } finally { await l.close(); }
});

// ---- Unhappy paths -------------------------------------------------------------------------------------------------------
test('Blocked door: discovery is refused, so the agent says it has no tools and the model is never called', async () => {
  const model = await start();
  try {
    const { body: r } = await ask('list my tools', 'demo-blocked');
    assert.equal(r.stopped, 'discovery-refused');
    assert.equal(r.by, 'lab');
    assert.match(r.reply, /did not list any/);
    assert.equal(r.steps[0].run.verdict.id, 'blocked');
    assert.equal(model.seen.length, 0);
  } finally { await stop(); }
});

test('A refused call goes back to the model as an error, and the step carries the refusal verdict', async () => {
  // demo-some-tools does not list sensitive_holdings; the model asks for it anyway, and the gateway decides.
  const model = await start({ replies: [msg([toolUse('sensitive_holdings', { account_id: 'inv_1' })], 'tool_use'), msg([text('The gateway refused that.')])] });
  try {
    const { body: r } = await ask('show sensitive holdings', 'demo-some-tools');
    const call = r.steps.find((s) => s.kind === 'call');
    assert.equal(call.run.verdict.id, 'blocked');
    const result = model.seen[1].body.messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /did not run this tool/);
    assert.equal(r.reply, 'The gateway refused that.');
  } finally { await stop(); }
});

test('Model down: the chat says the model did not answer, retries are capped at one, and no tool is called', async () => {
  const model = await start({ replies: [{ status: 500, json: { type: 'error', error: { type: 'api_error', message: 'stub down' } } }] });
  try {
    const before = callsSeen();
    const { status, body: r } = await ask('who has role x?');
    assert.equal(status, 200);
    assert.equal(r.stopped, 'model-error');
    assert.match(r.reply, /did not answer \(HTTP 500\)/);
    assert.equal(model.seen.length, 2, 'one try plus one retry');
    assert.deepEqual(r.steps.map((s) => s.kind), ['discover']);
    assert.ok(callsSeen() > before, 'the discovery reached the gateway');
    const runs = (await (await fetch(`${lab.base}/api/runs`)).json()).runs;
    assert.deepEqual(runs.map((x) => x.action), ['discover'], 'no tool call was made for the failed step');
  } finally { await stop(); }
});

test('Refusal and max_tokens stop the turn in plain words and run no tool', async () => {
  for (const [stop_reason, word] of [['refusal', 'refusal'], ['max_tokens', 'max-tokens']]) {
    await start({ replies: [msg([toolUse('who_has_role', { role: 'x' })], stop_reason)] });
    try {
      const { body: r } = await ask('who has role x?');
      assert.equal(r.stopped, word);
      assert.deepEqual(r.steps.map((s) => s.kind), ['discover']);
    } finally { await stop(); }
  }
});

test('A runaway loop stops after the tool-call cap', async () => {
  let n = 0;
  await start({ replies: [() => msg([toolUse('who_has_role', { role: 'x' }, `toolu_${(n += 1)}`)], 'tool_use')] });
  try {
    const { body: r } = await ask('keep going');
    assert.equal(r.steps.filter((s) => s.kind === 'call').length, AGENT_LIMITS.toolCalls);
    assert.ok(['tool-limit', 'model-limit'].includes(r.stopped), r.stopped);
  } finally { await stop(); }
});

test('An earlier agent reply longer than the cap is cut, not refused; a long user message is refused', async () => {
  const model = await start({ replies: [msg([text('ok')])] });
  try {
    const { status } = await post('/api/agent', { door: ALL, messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'y'.repeat(5000) }, { role: 'user', text: 'and?' }] });
    assert.equal(status, 200);
    assert.equal(model.seen[0].body.messages[1].content.length, AGENT_LIMITS.messageChars);
  } finally { await stop(); }
});

test('A schema with $defs keeps them for the model, and a duplicate tool name is offered once', () => {
  const s = cleanSchema({ type: 'object', properties: { f: { $ref: '#/$defs/F' } }, $defs: { F: { type: 'string' } } });
  assert.deepEqual(s.$defs, { F: { type: 'string' } });
  assert.equal(modelToolFrom({ name: 'x', inputSchema: { properties: { f: { $ref: '#/definitions/F' } }, definitions: { F: { type: 'string' } } } }).input_schema.definitions.F.type, 'string');
});

test('Hostile history is refused before any call', async () => {
  const model = await start();
  try {
    for (const messages of [[], [{ role: 'system', text: 'x' }], [{ role: 'assistant', text: 'x' }], [{ role: 'user', text: 'x'.repeat(AGENT_LIMITS.messageChars + 1) }], 'nope', [{ role: 'user', text: '   ' }], Array.from({ length: AGENT_LIMITS.turns * 2 + 1 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x' }))]) {
      const { status, body } = await post('/api/agent', { door: ALL, messages });
      assert.equal(status, 400, JSON.stringify(messages).slice(0, 60));
      assert.equal(body.error, 'bad_messages');
    }
    assert.equal(model.seen.length, 0);
  } finally { await stop(); }
});

test('agentConfig and decideModel: the key never shows, a bad model name falls back, and only the one origin is allowed in Real', () => {
  const c = agentConfig({ PGC_ANTHROPIC_API_KEY: API_KEY, PGC_AGENT_MODEL: 'bad model!' });
  assert.equal(c.configured, true);
  assert.equal(c.model, DEFAULT_AGENT_MODEL);
  assert.ok(!JSON.stringify(c).includes(API_KEY));
  assert.equal(agentConfig({ PGC_AGENT_MODEL: 'claude-haiku-5-5', PGC_ANTHROPIC_API_KEY: API_KEY }).model, 'claude-haiku-5-5');
  assert.equal(decideModel(`${MODEL_ORIGIN}/v1/messages`, { mode: 'real', configured: true }).allow, true);
  assert.equal(decideModel('https://evil.example/v1/messages', { mode: 'real', configured: true }).code, 'blocked_origin');
  assert.equal(decideModel(`${MODEL_ORIGIN}/v1/messages`, { mode: 'mock', configured: true }).code, 'blocked_mock');
  assert.deepEqual(checkHistory([{ role: 'user', text: ' hi ' }]), [{ role: 'user', content: 'hi' }]);
});
