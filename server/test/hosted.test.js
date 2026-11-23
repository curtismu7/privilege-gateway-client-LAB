import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLab, startStubGateway, realEnv, TEST_KEYS } from './helpers.js';
import { createSessions } from '../src/auth/session.js';

// The owner-run SE-hosted instance (PGC_HOSTED=1): a Real page login before any Real call, one workspace per browser, a daily agent cap,
// and the agent through the Privilege LLM gateway. "The gateway" is a loopback stub and "the model" a stub fetch: no network.
const SECRET = 'TESTONLY-session-secret-0005-abcdefabcdef';
const LLM_KEY = 'TESTONLY-llm-virtual-key-0006-abcdef';
const HOSTED = { PGC_HOSTED: '1', PGC_SESSION_SECRET: SECRET, LAB_ALLOWED_HOSTS: 'lab.example' };
const ALL = 'demo-all-tools';

let stub; let lab;
async function start(extra = {}, modelFetch) {
  stub = await startStubGateway({ keys: TEST_KEYS });
  lab = await startLab({ env: realEnv(stub.origin, { ...HOSTED, ...extra }), modelFetch });
}
const stop = async () => { await lab?.close(); await stub?.close(); lab = null; stub = null; };

// A browser: keeps the cookies the lab sets, like a real one would.
function browser() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } return res; };
  return {
    jar,
    get: async (path) => keep(await fetch(`${lab.base}${path}`, { headers: { cookie: cookieHeader() } })),
    post: async (path, body) => keep(await fetch(`${lab.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader() }, body: JSON.stringify(body) })),
    // A Real page login for this browser's workspace, signed with the lab's own session secret (what /api/auth/live/credentials issues).
    signIn(sub = 'user-1') {
      const sessions = createSessions({ secret: SECRET, ttlMs: 3600e3 });
      const ws = jar.get('pgc_ws');
      const [kv] = sessions.cookie(sessions.issueClaims({ sub, name: sub }, ws), 3600, ws).split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    },
  };
}

test('hosted: a browser gets its own workspace cookie (HttpOnly, Secure), and keeps it', async () => {
  await start();
  try {
    const b = browser();
    const r1 = await b.get('/api/info');
    const set = r1.headers.getSetCookie().find((c) => c.startsWith('pgc_ws='));
    assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Lax/);
    const id = b.jar.get('pgc_ws');
    assert.match(id, /^v-[0-9a-f]{16}$/);
    const r2 = await b.get('/api/info');
    assert.equal(r2.headers.getSetCookie().some((c) => c.startsWith('pgc_ws=')), false, 'no new workspace once it has one');
    const info = await r2.json();
    assert.deepEqual(info.hosted, { signinRequired: true, signedIn: false });
  } finally { await stop(); }
});

test('hosted: Real discover, call and agent answer 401 signin_required until a Real page login, and nobody can switch the mode', async () => {
  await start();
  try {
    const b = browser();
    await b.get('/api/info');
    for (const [path, body] of [['/api/discover', { door: ALL }], ['/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } }], ['/api/agent', { door: ALL, messages: [{ role: 'user', text: 'hi' }] }]]) {
      const r = await b.post(path, body);
      assert.equal(r.status, 401, path);
      assert.equal((await r.json()).error, 'signin_required');
    }
    assert.equal(stub.seen.length, 0, 'nothing reached the gateway');
    // The mode is one setting shared by every visitor: an anonymous switch (which would also sign everyone out) is refused.
    const m = await b.post('/api/mode', { source: 'mock' });
    assert.equal(m.status, 409);
    assert.equal((await m.json()).error, 'mode_fixed');
    assert.equal((await (await b.get('/api/info')).json()).source, 'real');
  } finally { await stop(); }
});

test('hosted: signed in, Real works, and two browsers never share a run log', async () => {
  await start();
  try {
    const a = browser(); const b = browser();
    await a.get('/api/info'); await b.get('/api/info');
    assert.notEqual(a.jar.get('pgc_ws'), b.jar.get('pgc_ws'));
    a.signIn('user-a');
    assert.deepEqual((await (await a.get('/api/info')).json()).hosted, { signinRequired: true, signedIn: true });
    const r = await a.post('/api/discover', { door: ALL });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).verdict.id, 'allowed');
    assert.equal((await (await a.get('/api/runs')).json()).runs.length, 1);
    assert.equal((await (await b.get('/api/runs')).json()).runs.length, 0, 'b sees none of a\'s runs');
    assert.equal((await b.post('/api/discover', { door: ALL })).status, 401, 'a\'s login does not sign b in');
  } finally { await stop(); }
});

test('hosted: the agent goes through the LLM gateway\'s Anthropic lane with the virtual key, and stops at the daily cap per person', async () => {
  const seen = [];
  const modelFetch = async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await start({ PGC_LLM_GATEWAY_URL: 'https://llm-gw.example', PGC_LLM_VIRTUAL_KEY: LLM_KEY, PGC_AGENT_MODEL: 'claude-sonnet-4-5', PGC_AGENT_DAILY_LIMIT: '2' }, modelFetch);
  try {
    const b = browser();
    const info = await (await b.get('/api/info')).json();
    assert.equal(info.agent.via, 'llm-gateway');
    assert.equal(info.agent.model, 'claude-sonnet-4-5');
    b.signIn('user-cap');
    const ask = () => b.post('/api/agent', { door: ALL, messages: [{ role: 'user', text: 'hi' }] });
    const r1 = await ask();
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).reply, 'ok');
    assert.ok(seen[0].url.startsWith('https://llm-gw.example/llm/anthropic/v1/messages'), seen[0].url);
    assert.equal(seen[0].headers.get('authorization'), `Bearer ${LLM_KEY}`);
    assert.equal(seen[0].headers.get('x-api-key'), null);
    assert.equal(seen[0].body.model, 'claude-sonnet-4-5');
    for (const k of ['fallbacks', 'output_config']) assert.equal(seen[0].body[k], undefined, `${k} is not sent through the gateway`);
    assert.equal((await ask()).status, 200);
    const r3 = await ask();
    assert.equal(r3.status, 429);
    assert.equal((await r3.json()).error, 'agent_daily_limit');
    assert.equal(seen.length, 2, 'the capped message made no model call');
    assert.equal(lab.lab.guard.stats().modelAllowed, 2);
  } finally { await stop(); }
});

test('not hosted: no workspace cookie, no sign-in gate, and info says hosted null', async () => {
  stub = await startStubGateway({ keys: TEST_KEYS });
  lab = await startLab({ env: realEnv(stub.origin) });
  try {
    const r = await fetch(`${lab.base}/api/info`);
    assert.equal(r.headers.getSetCookie().length, 0);
    assert.equal((await r.json()).hosted, null);
    const d = await fetch(`${lab.base}/api/discover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door: ALL }) });
    assert.equal(d.status, 200);
  } finally { await stop(); }
});

test('an LLM gateway URL that is not https, or has no key, leaves the agent unconfigured with the reason', async () => {
  const { agentConfig } = await import('../src/agentChat.js');
  assert.match(agentConfig({ PGC_LLM_GATEWAY_URL: 'http://llm-gw.example' }).reason, /https/);
  assert.match(agentConfig({ PGC_LLM_GATEWAY_URL: 'https://llm-gw.example' }).reason, /PGC_LLM_VIRTUAL_KEY/);
  const ok = agentConfig({ PGC_LLM_GATEWAY_URL: 'https://llm-gw.example/', PGC_LLM_VIRTUAL_KEY: LLM_KEY });
  assert.equal(ok.configured, true);
  assert.equal(ok.base, 'https://llm-gw.example/llm/anthropic');
  assert.ok(!JSON.stringify(ok).includes(LLM_KEY));
});

test('hosted: at the workspace cap the least recently used browser is forgotten, not a 429 for the next visitor', async () => {
  await start({ PGC_MAX_WORKSPACES: '2' });
  try {
    const [a, b, c] = [browser(), browser(), browser()];
    await a.get('/api/runs'); await b.get('/api/runs');
    a.signIn('user-a');
    assert.equal((await a.post('/api/discover', { door: ALL })).status, 200);
    await b.get('/api/runs'); // b is now the most recent, a the least
    await a.get('/api/info').then(() => 0); // touching info does not create state
    const r = await c.get('/api/runs');
    assert.equal(r.status, 200, 'the third visitor is admitted');
    assert.equal(lab.lab.workspaces.ids().filter((id) => id !== 'default').length, 2);
  } finally { await stop(); }
});

test('hosted: X-Workspace and a "default" cookie are ignored; each browser keeps its own workspace', async () => {
  await start();
  try {
    const r = await fetch(`${lab.base}/api/runs`, { headers: { 'x-workspace': 'team', cookie: 'pgc_ws=default' } });
    assert.equal(r.status, 200);
    const set = r.headers.getSetCookie().find((c) => c.startsWith('pgc_ws='));
    assert.match(set, /^pgc_ws=v-[0-9a-f]{16};/, 'a fresh own workspace, not "team" or "default"');
    assert.equal((await r.json()).workspace, set.slice(7, 25));
  } finally { await stop(); }
});

test('hosted: Reset clears only the caller\'s workspace, never the shared netguard counters', async () => {
  await start();
  try {
    const a = browser(); await a.get('/api/info'); a.signIn('user-a');
    await a.post('/api/discover', { door: ALL });
    const before = lab.lab.guard.stats().attempts;
    assert.ok(before > 0);
    const r = await (await browser().post('/api/reset', {})).json();
    assert.deepEqual(r.cleared, ['run log', 'trace sink', 'sign-in session']);
    assert.equal(lab.lab.guard.stats().attempts, before);
    assert.equal((await (await a.get('/api/runs')).json()).runs.length, 1, 'a\'s runs survive another visitor\'s Reset');
  } finally { await stop(); }
});

test('hosted: a turn that never reaches the model does not count against the daily cap', async () => {
  let calls = 0;
  const modelFetch = async () => { calls += 1; return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  await start({ PGC_LLM_GATEWAY_URL: 'https://llm-gw.example', PGC_LLM_VIRTUAL_KEY: LLM_KEY, PGC_AGENT_DAILY_LIMIT: '1' }, modelFetch);
  try {
    const b = browser(); await b.get('/api/info'); b.signIn('user-z');
    for (let i = 0; i < 3; i += 1) {
      const r = await b.post('/api/agent', { door: 'demo-blocked', messages: [{ role: 'user', text: 'hi' }] });
      assert.equal(r.status, 200); assert.equal((await r.json()).stopped, 'discovery-refused');
    }
    assert.equal(calls, 0);
    assert.equal((await b.post('/api/agent', { door: ALL, messages: [{ role: 'user', text: 'hi' }] })).status, 200, 'the allowance is still there');
    assert.equal((await b.post('/api/agent', { door: ALL, messages: [{ role: 'user', text: 'hi' }] })).status, 429);
  } finally { await stop(); }
});

test('a gateway-style model id is kept, not silently replaced', async () => {
  const { agentConfig } = await import('../src/agentChat.js');
  assert.equal(agentConfig({ PGC_LLM_GATEWAY_URL: 'https://llm-gw.example', PGC_LLM_VIRTUAL_KEY: LLM_KEY, PGC_AGENT_MODEL: 'us.anthropic.claude-sonnet-4-5-v1:0' }).model, 'us.anthropic.claude-sonnet-4-5-v1:0');
});

test('the pending sign-in store is capped (oldest out) and expires', async () => {
  const { createLoginRunStore } = await import('../src/auth/loginRuns.js');
  let t = 0;
  const s = createLoginRunStore({ max: 2, ttlMs: 100, now: () => t });
  s.set('a', 1); s.set('b', 2); s.set('c', 3);
  assert.equal(s.size, 2); assert.equal(s.get('a'), undefined); assert.equal(s.get('c'), 3);
  t = 500;
  assert.equal(s.get('b'), undefined, 'expired');
  s.set('d', 4);
  assert.equal(s.size, 1, 'expired runs are dropped on the next start');
});
