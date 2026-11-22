import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGateway, MOCK_ORIGIN, UPSTREAM_MESSAGE } from '../src/mockGateway.js';
import { DOORS, TOOLS, grantedTools, isPermitted } from '../src/doors.js';
import { mockPost, openSession } from './helpers.js';

const call = (gw, door, session, name, args, id = 5) => mockPost(gw, door, { key: gw.keyFor(door), session, body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } } });
const list = (gw, door, session) => mockPost(gw, door, { key: gw.keyFor(door), session, body: { jsonrpc: '2.0', id: 4, method: 'tools/list' } });
const ARGS = Object.fromEntries(TOOLS.map((t) => [t.name, t.args]));

test('the door configuration is the spec: 18 tools, 18 / 7 / 0 permitted', () => {
  assert.equal(TOOLS.length, 18);
  assert.deepEqual(DOORS.map((d) => d.id), ['demo-all-tools', 'demo-some-tools', 'demo-blocked']);
  assert.deepEqual(DOORS.map((d) => grantedTools(d).length), [18, 7, 0]);
  assert.deepEqual(grantedTools(DOORS[1]), ['list_entitlements', 'who_has_role', 'get_access_grants', 'get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions']);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, 18);
  assert.equal(TOOLS.filter((t) => t.name.startsWith('sensitive_')).length, 10);
  assert.equal(isPermitted(DOORS[1], 'open_ticket'), false);
  assert.equal(isPermitted(DOORS[1], '__proto__'), false);
  assert.equal(isPermitted(DOORS[0], 'constructor'), false);
});

test('no key or a wrong key is 401 with a WWW-Authenticate challenge, and nothing else is answered', async () => {
  const gw = createMockGateway();
  const body = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  const none = await mockPost(gw, 'demo-all-tools', { body });
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /^Bearer realm="https:\/\/mock-gateway\.invalid\/demo-all-tools\/mcp"$/);
  const bad = await mockPost(gw, 'demo-all-tools', { key: 'mock-wrong', body });
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get('www-authenticate'), /error="invalid_token"/);
  // another door's key is a wrong key here
  const cross = await mockPost(gw, 'demo-all-tools', { key: gw.keyFor('demo-some-tools'), body });
  assert.equal(cross.status, 401);
  assert.equal(gw.sessionCount(), 0);
  assert.equal(none.json._meta.simulated, true);
  assert.equal(none.headers.get('server'), 'mock-privilege-gateway (simulated)');
});

test('the handshake: initialize gives a session id, notifications/initialized is 202, GET is 405', async () => {
  const gw = createMockGateway();
  const key = gw.keyFor('demo-all-tools');
  const init = await mockPost(gw, 'demo-all-tools', { key, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.equal(init.status, 200);
  const sid = init.headers.get('mcp-session-id');
  assert.match(sid, /^mock-session-[0-9a-f]{18}$/);
  assert.equal(init.json.result.serverInfo.name, 'mock-privilege-gateway (simulated)');
  assert.equal(init.json.result._meta.simulated, true);
  const note = await mockPost(gw, 'demo-all-tools', { key, session: sid, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  assert.equal(note.text, '');
  const get = await gw.handle(new URL(`${MOCK_ORIGIN}/demo-all-tools/mcp`), { method: 'GET', headers: { authorization: `Bearer ${key}` } });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, DELETE');
});

test('JSON-RPC errors: -32700 parse, -32600 invalid request, -32601 method not found, -32602 bad params', async () => {
  const gw = createMockGateway();
  const door = 'demo-all-tools';
  const key = gw.keyFor(door);
  const session = await openSession(gw, door);
  const parse = await mockPost(gw, door, { key, session, raw: '{"jsonrpc": "2.0", "id": 1, "meth' });
  assert.equal(parse.status, 400);
  assert.equal(parse.json.error.code, -32700);
  for (const raw of ['[]', '"x"', '42', 'null', JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'x' }), JSON.stringify({ jsonrpc: '2.0', id: 1 }), JSON.stringify({ jsonrpc: '2.0', id: 1, method: 7 })]) {
    const r = await mockPost(gw, door, { key, session, raw });
    assert.equal(r.status, 400, raw);
    assert.equal(r.json.error.code, -32600, raw);
  }
  const nf = await mockPost(gw, door, { key, session, body: { jsonrpc: '2.0', id: 9, method: 'resources/list' } });
  assert.equal(nf.status, 200);
  assert.equal(nf.json.error.code, -32601);
  assert.equal(nf.json.id, 9);
  const noName = await call(gw, door, session, undefined, {});
  assert.equal(noName.json.error.code, -32602);
  const unknown = await call(gw, door, session, 'no_such_tool', {});
  assert.equal(unknown.json.error.code, -32602);
  assert.match(unknown.json.error.message, /Unknown tool/);
  const missing = await call(gw, door, session, 'who_has_role', {});
  assert.equal(missing.json.error.code, -32602);
  assert.match(missing.json.error.message, /missing role/);
  const arr = await call(gw, door, session, 'who_has_role', [1]);
  assert.equal(arr.json.error.code, -32602);
});

test('session handling: no session id is 400, an unknown or other door\'s session is 404, DELETE closes it', async () => {
  const gw = createMockGateway();
  const key = gw.keyFor('demo-all-tools');
  const noSession = await mockPost(gw, 'demo-all-tools', { key, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(noSession.status, 400);
  const unknown = await mockPost(gw, 'demo-all-tools', { key, session: 'mock-session-doesnotexist', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.code, -32001);
  const s = await openSession(gw, 'demo-all-tools');
  const other = await mockPost(gw, 'demo-some-tools', { key: gw.keyFor('demo-some-tools'), session: s, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(other.status, 404, 'a session belongs to one door');
  gw.dropSessions();
  assert.equal((await list(gw, 'demo-all-tools', s)).status, 404, 'a dropped session is "session not found"');
  const s2 = await openSession(gw, 'demo-all-tools');
  const del = await gw.handle(new URL(`${MOCK_ORIGIN}/demo-all-tools/mcp`), { method: 'DELETE', headers: { authorization: `Bearer ${key}`, 'mcp-session-id': s2 } });
  assert.equal(del.status, 204);
  assert.equal((await list(gw, 'demo-all-tools', s2)).status, 404);
});

test('an unknown door, a bad path and a foreign origin are not served', async () => {
  const gw = createMockGateway();
  assert.equal(gw.handles(new URL('https://mock-gateway.invalid/demo-all-tools/mcp')), true);
  assert.equal(gw.handles(new URL('https://gateway.example/demo-all-tools/mcp')), false);
  for (const p of ['/nope/mcp', '/demo-all-tools', '/demo-all-tools/mcp/extra', '/__proto__/mcp', '/']) {
    const r = await gw.handle(new URL(`${MOCK_ORIGIN}${p}`), { method: 'POST', headers: {}, body: '{}' });
    assert.equal(r.status, 404, p);
  }
});

test('tools/list: demo-all-tools returns all 18', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-all-tools');
  const r = await list(gw, 'demo-all-tools', s);
  assert.equal(r.status, 200);
  const tools = r.json.result.tools;
  assert.equal(tools.length, 18);
  assert.ok(tools.every((t) => t._meta.simulated === true && t.inputSchema.type === 'object' && t.description));
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
});

test('tools/list: demo-some-tools lists only the 7 granted tools and leaves the 11 out, as the real gateway does', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-some-tools');
  const tools = (await list(gw, 'demo-some-tools', s)).json.result.tools;
  assert.equal(tools.length, 7);
  assert.ok(tools.every((t) => t._meta.simulated === true && t._meta.permitted === undefined));
  assert.deepEqual(tools.map((t) => t.name), ['list_entitlements', 'who_has_role', 'get_access_grants', 'get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions']);
  assert.ok(!tools.some((t) => t.name === 'open_ticket' || t.name.startsWith('sensitive_')));
  // A tool the list left out is still refused when it is called by name.
  const refused = await call(gw, 'demo-some-tools', s, 'open_ticket', {});
  assert.equal(refused.status, 403);
});

test('demo-blocked is refused with 403 before any list, for a valid key, on every method', async () => {
  const gw = createMockGateway();
  const key = gw.keyFor('demo-blocked');
  const init = await mockPost(gw, 'demo-blocked', { key, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
  assert.equal(init.status, 403);
  assert.equal(init.json.error, 'forbidden');
  assert.equal(init.headers.get('mcp-session-id'), null);
  const l = await mockPost(gw, 'demo-blocked', { key, session: 'x', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.equal(l.status, 403);
  assert.equal(gw.sessionCount(), 0);
  const decisions = JSON.parse(Buffer.from(init.headers.get('x-mock-decisions'), 'base64url').toString());
  assert.deepEqual(decisions.map((d) => [d.id, d.outcome]), [['authenticated', 'pass'], ['door-policy', 'fail'], ['grant', 'skipped']]);
});

test('tools/call: allow is 200 and labelled simulated, for every permitted tool', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-some-tools');
  for (const name of grantedTools(DOORS[1])) {
    const r = await call(gw, 'demo-some-tools', s, name, ARGS[name]);
    assert.equal(r.status, 200, name);
    assert.equal(r.json.result._meta.simulated, true);
    const out = JSON.parse(r.json.result.content[0].text);
    assert.equal(out.simulated, true);
    assert.equal(out.tool, name);
    assert.match(out.note, /SIMULATED/);
  }
});

test('tools/call: a tool outside the grant is 403 for each of the 11, and never reaches the backend', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-some-tools');
  const outside = TOOLS.filter((t) => !isPermitted(DOORS[1], t.name));
  assert.equal(outside.length, 11);
  for (const t of outside) {
    const r = await call(gw, 'demo-some-tools', s, t.name, t.args);
    assert.equal(r.status, 403, t.name);
    assert.equal(r.json.error, 'forbidden');
    const d = JSON.parse(Buffer.from(r.headers.get('x-mock-decisions'), 'base64url').toString());
    assert.equal(d.find((x) => x.id === 'grant').outcome, 'fail');
    assert.ok(!d.some((x) => x.id === 'upstream'), 'no backend decision for a refused call');
  }
});

test('tools/call: open_ticket on demo-all-tools is held, labelled simulated, and says its body is invented', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-all-tools');
  const r = await call(gw, 'demo-all-tools', s, 'open_ticket', { title: 'x', action: 'flag' });
  assert.equal(r.status, 200);
  assert.equal(r.json.result._meta.held, true);
  assert.equal(r.json.result._meta.inventedBody, true);
  const body = JSON.parse(r.json.result.content[0].text);
  assert.equal(body.status, 'confirmation_required');
  assert.match(body.message, /SIMULATED/);
  assert.match(body.note, /invented/);
});

test('tools/call: an armed fault is a 502 once, with a JSON body, and only on the armed door and method', async () => {
  const gw = createMockGateway();
  const s = await openSession(gw, 'demo-all-tools');
  gw.armFault('demo-some-tools', 'tools/call');
  assert.equal((await call(gw, 'demo-all-tools', s, 'who_has_role', ARGS.who_has_role)).status, 200, 'another door is not affected');
  gw.armFault('demo-all-tools', 'tools/call');
  assert.equal((await list(gw, 'demo-all-tools', s)).status, 200, 'another method is not affected');
  const bad = await call(gw, 'demo-all-tools', s, 'who_has_role', ARGS.who_has_role);
  assert.equal(bad.status, 502);
  assert.equal(bad.json.error, 'bad_gateway');
  assert.equal(bad.json.message, UPSTREAM_MESSAGE);
  assert.match(bad.json.message, /SIMULATED/);
  assert.match(bad.headers.get('content-type'), /json/);
  assert.equal((await call(gw, 'demo-all-tools', s, 'who_has_role', ARGS.who_has_role)).status, 200, 'one-shot');
  gw.armFault('demo-all-tools', 'tools/list');
  assert.equal((await list(gw, 'demo-all-tools', s)).status, 502);
  gw.armFault('demo-all-tools', 'tools/list');
  gw.clearFault();
  assert.equal((await list(gw, 'demo-all-tools', s)).status, 200);
});

test('hostile input is bounded: oversized body, hostile tool names, and prototype keys never throw', async () => {
  const gw = createMockGateway();
  const door = 'demo-all-tools';
  const key = gw.keyFor(door);
  const s = await openSession(gw, door);
  const big = await mockPost(gw, door, { key, session: s, raw: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"a":"${'z'.repeat(70 * 1024)}"}}}` });
  assert.equal(big.status, 413);
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a'.repeat(5000), '<script>alert(1)</script>', '../../etc/passwd', '\u0000', 7, { x: 1 }, null]) {
    const r = await call(gw, door, s, name, {});
    assert.equal(r.status, 200, String(name).slice(0, 20));
    assert.equal(r.json.error?.code, -32602, `${String(name).slice(0, 20)} is an invalid-params error, not a crash`);
  }
  const proto = await mockPost(gw, door, { key, session: s, raw: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"who_has_role","arguments":{"__proto__":{"role":"x"}}}}' });
  assert.equal(proto.json.error?.code, -32602, 'a __proto__ key does not satisfy a required argument');
  assert.equal(({}).role, undefined, 'the prototype was not polluted');
});

test('mock tokens are signed with a per-process random key, labelled mock, and verify only on their own gateway', () => {
  const a = createMockGateway();
  const b = createMockGateway();
  const t = a.issueToken({ door: 'demo-all-tools', sub: 'aidemo' });
  assert.match(t, /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/);
  const claims = a.verifyToken(t);
  assert.equal(claims.mock, true);
  assert.equal(claims.sub, 'aidemo');
  assert.equal(claims.aud, 'https://mock-gateway.invalid/demo-all-tools/mcp');
  assert.match(claims.note, /MOCK/);
  assert.equal(b.verifyToken(t), null, 'another process\'s key does not verify it');
  const parts = t.split('.');
  assert.equal(a.verifyToken(`${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`), null);
  assert.equal(a.verifyToken(`${parts[0]}.${Buffer.from('{"sub":"admin","exp":99999999999}').toString('base64url')}.${parts[2]}`), null);
  assert.equal(a.verifyToken('not.a.token'), null);
  assert.notEqual(a.keyFor('demo-all-tools'), b.keyFor('demo-all-tools'), 'mock agent keys differ per process');
  assert.match(a.keyFor('demo-all-tools'), /^mock-agent-key-demo-all-tools-[0-9a-f]{12}$/);
  let clock = 0;
  const timed = createMockGateway({ now: () => clock });
  const shortLived = timed.issueToken({ door: 'demo-all-tools', sub: 'x', ttlSeconds: 1 });
  assert.ok(timed.verifyToken(shortLived));
  clock = 5000;
  assert.equal(timed.verifyToken(shortLived), null, 'an expired token does not verify');
});

test('the signer is HMAC from node:crypto: no EC key generation exists in the server source', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const pattern = new RegExp(['generateKey', 'Pair(Sync)?\\('].join(''));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) assert.ok(!pattern.test(readFileSync(new URL(f, dir), 'utf8')), f);
});
