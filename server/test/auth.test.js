import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localRequestRefusal, mockRequestRefusal, proxyHeaderPresent } from '../src/auth/guards.js';
import { createSessions, cookieValue } from '../src/auth/session.js';
import { PERSONAS, personaById } from '../src/auth/personas.js';
import { readSettings } from '../src/settings.js';
import { runChecks } from '../src/checks.js';
import { startLab, startStubGateway, realEnv, TEST_KEYS, postJson, rawRequest } from './helpers.js';

const MOCK_ON = { IDP: 'mock', ALLOW_MOCK_SIGNIN: '1' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pgc-auth-'));
const req = (over = {}) => ({ headers: { host: '127.0.0.1:7833' }, socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, ...over });
const cfg = (over = {}) => ({ host: '127.0.0.1', publish: '', allowedHosts: [], mockSignin: true, ...over });
const login = (base, persona, headers = {}) => postJson(base, '/api/auth/mock/login', { persona }, { origin: base, ...headers });
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const session = async (base, cookie, ws) => (await (await fetch(`${base}/api/session`, { headers: { cookie, ...(ws ? { 'x-workspace': ws } : {}) } })).json()).me;

test('rule 11: Mock sign-in needs BOTH IDP=mock AND ALLOW_MOCK_SIGNIN=1 (the literal "1")', () => {
  assert.equal(readSettings({}).mockSignin, false);
  for (const env of [{ IDP: 'mock' }, { ALLOW_MOCK_SIGNIN: '1' }, { IDP: 'pingone', ALLOW_MOCK_SIGNIN: '1' }, { IDP: 'mock', ALLOW_MOCK_SIGNIN: 'true' }, { IDP: 'mock', ALLOW_MOCK_SIGNIN: '0' }, { IDP: 'mock', ALLOW_MOCK_SIGNIN: ' 1' }, { NODE_ENV: 'development', ALLOW_MOCK_SIGNIN: '1' }]) {
    assert.equal(readSettings(env).mockSignin, false, JSON.stringify(env));
  }
  assert.equal(readSettings(MOCK_ON).mockSignin, true);
  assert.equal(readSettings({ IDP: 'MOCK', ALLOW_MOCK_SIGNIN: '1' }).mockSignin, true);
  // NODE_ENV is not a guard in either direction: the Docker image sets it.
  assert.equal(readSettings({ ...MOCK_ON, NODE_ENV: 'production' }).mockSignin, true);
});

test('without both settings the persona routes are not mounted at all', async () => {
  for (const env of [{}, { IDP: 'mock' }, { ALLOW_MOCK_SIGNIN: '1' }]) {
    const lab = await startLab({ env });
    try {
      assert.equal((await fetch(`${lab.base}/api/auth/mock/personas`)).status, 404, JSON.stringify(env));
      assert.equal((await login(lab.base, 'aidemo')).status, 404);
      const cfgRes = await (await fetch(`${lab.base}/api/auth/config`)).json();
      assert.equal(cfgRes.mock.enabled, false);
      assert.equal(cfgRes.mock.available, false);
    } finally { await lab.close(); }
  }
});

test('the guard refuses a non-loopback listener, a non-local connection, a proxy header and a foreign Host, and says which', () => {
  assert.equal(localRequestRefusal(req(), cfg()), null);
  assert.equal(localRequestRefusal(req(), cfg({ host: '0.0.0.0' })), 'non_loopback_listener');
  assert.equal(localRequestRefusal(req({ socket: { localAddress: '10.0.0.5', remoteAddress: '10.0.0.9' } }), cfg()), 'non_loopback_connection');
  assert.equal(localRequestRefusal(req({ socket: { localAddress: '127.0.0.1', remoteAddress: '203.0.113.9' } }), cfg()), 'non_loopback_connection');
  for (const h of ['x-forwarded-for', 'X-Forwarded-Host', 'forwarded', 'via', 'true-client-ip', 'cf-connecting-ip', 'x-real-ip', 'X-Client-IP', 'fastly-client-ip', 'x-cluster-client-ip']) {
    assert.equal(localRequestRefusal(req({ headers: { host: '127.0.0.1:7833', [h]: 'x' } }), cfg()), 'proxy_header', h);
  }
  assert.equal(localRequestRefusal(req({ headers: { host: 'evil.example' } }), cfg()), 'non_loopback_host');
  assert.equal(proxyHeaderPresent({ accept: '*/*' }), false);
  // Mock only: in Real the persona picker is refused, and with the setting off it is "disabled".
  assert.equal(mockRequestRefusal(req(), cfg(), 'real'), 'real_mode');
  assert.equal(mockRequestRefusal(req(), cfg({ mockSignin: false })), 'disabled');
});

test('the shared lab-proxy case: forwarded headers are tolerated only when the Host is a LAB_ALLOWED_HOSTS name', () => {
  const proxied = (host) => req({ headers: { host, 'x-forwarded-host': 'lab.proxy.example', 'x-forwarded-proto': 'https' } });
  assert.equal(localRequestRefusal(proxied('127.0.0.1:7833'), cfg({ allowedHosts: ['lab.example'] })), 'proxy_header', 'loopback Host does not count');
  assert.equal(localRequestRefusal(proxied('lab.example'), cfg({ allowedHosts: ['lab.example'] })), null);
  assert.equal(localRequestRefusal(proxied('other.example'), cfg({ allowedHosts: ['lab.example'] })), 'proxy_header');
});

test('Docker: a non-loopback bind is allowed only with the loopback publish marker (LAB_PUBLISH=loopback)', () => {
  const dockerReq = req({ socket: { localAddress: '172.18.0.2', remoteAddress: '172.18.0.1' } });
  assert.equal(localRequestRefusal(dockerReq, cfg({ host: '0.0.0.0' })), 'non_loopback_listener');
  assert.equal(localRequestRefusal(dockerReq, cfg({ host: '0.0.0.0', publish: 'loopback' })), null);
  assert.equal(readSettings({ PGC_BIND: '0.0.0.0', LAB_PUBLISH: 'loopback' }).publish, 'loopback');
  assert.equal(readSettings({ PGC_BIND: '0.0.0.0', LAB_PUBLISH: 'yes' }).publish, '');
});

test('the doctor fails when Mock sign-in is on and the listener is not loopback', () => {
  const bad = runChecks({ ...MOCK_ON, PGC_BIND: '0.0.0.0' }).find((c) => c.id === 'mock-signin');
  assert.equal(bad.level, 'fail');
  const dockerOk = runChecks({ ...MOCK_ON, PGC_BIND: '0.0.0.0', LAB_PUBLISH: 'loopback' }).find((c) => c.id === 'mock-signin');
  assert.equal(dockerOk.level, 'pass');
});

test('the seeded personas are aidemo, demouser and demoAdmin; none is special (owner 2026-11-22: demoAdmin is a normal user)', () => {
  assert.deepEqual(Object.keys(PERSONAS), ['aidemo', 'demouser', 'demoAdmin']);
  for (const p of Object.values(PERSONAS)) assert.deepEqual(Object.keys(p).sort(), ['email', 'id', 'name', 'role'], `${p.id} carries no admin flag or any other extra field`);
  assert.equal(PERSONAS.demoAdmin.role, PERSONAS.demouser.role, 'demoAdmin is described exactly like demouser');
  assert.equal(personaById('__proto__'), null);
  assert.equal(personaById('constructor'), null);
  assert.equal(personaById(7), null);
});

test('Mock sign-in over HTTP: pick a persona, see it in the session, sign out, and the cookie is HttpOnly and SameSite=Strict', async () => {
  const lab = await startLab({ env: MOCK_ON });
  try {
    const list = await (await fetch(`${lab.base}/api/auth/mock/personas`)).json();
    assert.deepEqual(list.personas.map((p) => p.id), ['aidemo', 'demouser', 'demoAdmin'], 'all three personas are offered, with no switch file');
    for (const p of list.personas) assert.deepEqual(Object.keys(p).sort(), ['email', 'id', 'name', 'role'], `${p.id} has no admin mark`);
    assert.equal(await session(lab.base, ''), null, 'nobody is signed in: a normal 200 with me null');
    const r = await login(lab.base, 'demouser');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /^pgc_session_default=.+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+$/);
    const cookie = cookieOf(r);
    const me = await session(lab.base, cookie);
    assert.equal(me.name, 'demouser');
    assert.equal(me.source, 'mock-persona');
    assert.ok(!('isAdmin' in me), 'the session has no admin field at all');
    const out = await postJson(lab.base, '/api/auth/logout', {}, { origin: lab.base });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await (await fetch(`${lab.base}/api/auth/config`)).json()).mock.available, true);
  } finally { await lab.close(); }
});

test('the Mock session reports when it ends (Mock only, from the same signed cookie); the TTL is the configured one', async () => {
  const lab = await startLab({ env: { ...MOCK_ON, PGC_SESSION_TTL_MS: '600000' } });
  try {
    const before = Date.now();
    const cookie = cookieOf(await login(lab.base, 'aidemo'));
    const me = await session(lab.base, cookie);
    const ends = Date.parse(me.expiresAt);
    assert.ok(Number.isFinite(ends), 'expiresAt is an ISO time');
    assert.ok(ends >= before + 590000 && ends <= Date.now() + 600000, `ends about ten minutes from sign-in: ${me.expiresAt}`);
  } finally { await lab.close(); }
});

test('Mock sign-in is refused behind a proxy and for a persona that does not exist', async () => {
  const lab = await startLab({ env: MOCK_ON });
  try {
    for (const h of ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'via', 'cf-ray']) {
      const r = await login(lab.base, 'aidemo', { [h]: 'x' });
      assert.equal(r.status, 403, h);
      const body = await r.json();
      // X-Forwarded-Host also changes what the same-origin write check compares, so that header is refused one layer earlier.
      if (h === 'x-forwarded-host') assert.equal(body.error, 'cross_origin');
      else assert.deepEqual(body, { error: 'mock_signin_refused', reason: 'proxy_header' });
      assert.equal((await fetch(`${lab.base}/api/auth/mock/personas`, { headers: { [h]: 'x' } })).status, 403);
    }
    for (const p of ['nobody', '__proto__', 'constructor', 7, null, undefined]) assert.equal((await login(lab.base, p)).status, 404, String(p));
    assert.equal((await postJson(lab.base, '/api/auth/mock/login', 'not json', { origin: lab.base })).status, 400);
    // A foreign Host never reaches the guard: the Host check answers first.
    const host = await rawRequest(lab.base, { method: 'GET', path: '/api/auth/mock/personas', headers: { host: 'evil.example' } });
    assert.equal(host.status, 403);
    assert.equal(JSON.parse(host.body).error, 'bad_host');
    // A cross-site write is refused before anything is signed in.
    const cross = await postJson(lab.base, '/api/auth/mock/login', { persona: 'aidemo' }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
    assert.equal((await cross.json()).error, 'cross_origin');
    const evil = await postJson(lab.base, '/api/auth/mock/login', { persona: 'aidemo' }, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
  } finally { await lab.close(); }
});

test('with a non-loopback bind and no loopback publish marker, every persona request is refused', async () => {
  const lab = await startLab({ env: { ...MOCK_ON, PGC_BIND: '0.0.0.0' } });
  try {
    const r = await fetch(`${lab.base}/api/auth/mock/personas`);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).reason, 'non_loopback_listener');
    const info = await (await fetch(`${lab.base}/api/auth/config`)).json();
    assert.equal(info.mock.available, false);
    assert.equal(info.mock.refusal, 'non_loopback_listener');
  } finally { await lab.close(); }
});

test('demoAdmin is a normal user: same session shape and same answers as demouser, and no switch file changes anything', async () => {
  const dir = tmp();
  const lab = await startLab({ env: { ...MOCK_ON, PGC_DATA_DIR: dir } });
  const run = (cookie, body) => postJson(lab.base, '/api/call', body, { origin: lab.base, cookie }).then((r) => r.json());
  try {
    const asUser = cookieOf(await login(lab.base, 'demouser'));
    const asAdmin = cookieOf(await login(lab.base, 'demoAdmin'));
    const u = await session(lab.base, asUser);
    const a = await session(lab.base, asAdmin);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(u).sort(), 'the same fields');
    assert.ok(!('isAdmin' in a) && !('admin' in a));
    assert.equal(a.name, 'demoAdmin');
    assert.equal(a.role, u.role);
    assert.equal(a.source, 'mock-persona');
    // The old local switch file does nothing now: before and after it is created the answers are the same.
    fs.writeFileSync(path.join(dir, 'ALLOW_ADMIN_PERSONA'), '');
    assert.deepEqual(Object.keys(await session(lab.base, asAdmin)).sort(), Object.keys(u).sort());
    assert.deepEqual((await (await fetch(`${lab.base}/api/auth/mock/personas`)).json()).personas.map((p) => p.id), ['aidemo', 'demouser', 'demoAdmin']);
    // No extra privileges: every door, tool, scenario and verdict is exactly what demouser gets (a refusal stays a refusal).
    for (const body of [
      { door: 'demo-all-tools', tool: 'list_entitlements', arguments: { user: 'aidemo' } },
      { door: 'demo-some-tools', tool: 'sensitive_payroll_details', arguments: {} },
      { door: 'demo-blocked', tool: 'list_entitlements', arguments: {} },
      { door: 'demo-some-tools', tool: 'list_entitlements', arguments: { user: 'aidemo' }, scenario: 'no-key' },
    ]) {
      const ru = await run(asUser, body); const ra = await run(asAdmin, body);
      assert.deepEqual(ra.verdict, ru.verdict, JSON.stringify(body));
      assert.equal(ra.identity.name, 'aidemo', 'the gateway still evaluates the key\'s identity, never the page login');
    }
    // An extra "admin" field in the login body is ignored: there is nothing to become.
    assert.equal((await postJson(lab.base, '/api/auth/mock/login', { persona: 'demoAdmin', admin: true }, { origin: lab.base })).status, 200);
  } finally { await lab.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a session belongs to one workspace, and a tampered or foreign cookie signs nobody in', async () => {
  const lab = await startLab({ env: { ...MOCK_ON, PGC_SESSION_SECRET: 'test-only-secret' } });
  try {
    const a = await login(lab.base, 'demouser', { 'x-workspace': 'team-a' });
    const cookie = cookieOf(a);
    assert.match(cookie, /^pgc_session_team-a=/);
    assert.equal((await session(lab.base, cookie, 'team-a')).name, 'demouser');
    assert.equal(await session(lab.base, cookie, 'team-b'), null, 'another workspace does not see it');
    assert.equal(await session(lab.base, cookie), null, 'nor does the default workspace');
    // The same value presented under another workspace's cookie name fails the signature's workspace binding.
    assert.equal(await session(lab.base, cookie.replace('team-a', 'team-b'), 'team-b'), null);
    // Flip a byte of the body, or swap the signature: not signed in.
    const [name, value] = cookie.split('=');
    const [body, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'demoAdmin', w: 'team-a', e: Date.now() + 1e6 })).toString('base64url');
    for (const bad of [`${forged}.${sig}`, `${body}x.${sig}`, `${body}.${sig}x`, `${body}.`, `.${sig}`, body, `${body}.${sig}.extra`]) assert.equal(await session(lab.base, `${name}=${bad}`, 'team-a'), null, bad.slice(0, 20));
  } finally { await lab.close(); }
});

test('sessions expire, and a session signed with another secret is refused', () => {
  let now = 1_000_000;
  const a = createSessions({ secret: 'one', ttlMs: 1000, now: () => now });
  const b = createSessions({ secret: 'two', ttlMs: 1000, now: () => now });
  const cookie = `pgc_session_w=${a.issuePersona('aidemo', 'w')}`;
  assert.deepEqual(a.read(cookie, 'w'), { persona: 'aidemo', expiresAt: 1_001_000 }, 'the persona and when the session ends');
  assert.equal(b.read(cookie, 'w'), null);
  now += 1001;
  assert.equal(a.read(cookie, 'w'), null, 'expired');
  const claims = createSessions({ secret: 'one', ttlMs: 1000, now: () => 0 });
  assert.deepEqual(claims.read(`pgc_session_w=${claims.issueClaims({ sub: 's1', name: 'N' }, 'w')}`, 'w'), { claims: { sub: 's1', name: 'N' } });
  assert.equal(cookieValue('xpgc_session_w=1; pgc_session_w=2', 'pgc_session_w'), '2', 'whole-name compare');
  assert.equal(cookieValue('pgc_session_w=', 'pgc_session_w'), null);
});

test('a Mock persona does not carry into Real, and the picker is refused in Real', async () => {
  const stub = await startStubGateway({ keys: TEST_KEYS });
  const lab = await startLab({ env: { ...realEnv(stub.origin, { MODE: 'mock' }), ...MOCK_ON } });
  try {
    const cookie = cookieOf(await login(lab.base, 'demouser'));
    assert.equal((await session(lab.base, cookie)).name, 'demouser');
    const sw = await postJson(lab.base, '/api/mode', { source: 'real' }, { origin: lab.base });
    assert.equal(sw.status, 200);
    assert.equal(await session(lab.base, cookie), null, 'a Mock persona is not a Real identity');
    const r = await fetch(`${lab.base}/api/auth/mock/personas`);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).reason, 'real_mode');
  } finally { await lab.close(); await stub.close(); }
});

test('the identity-mismatch scenario shows the signed-in persona as the page login, except when it is the gateway identity', async () => {
  const lab = await startLab({ env: MOCK_ON });
  const mismatch = (cookie) => postJson(lab.base, '/api/call', { door: 'demo-all-tools', tool: 'list_entitlements', arguments: { user: 'aidemo' }, scenario: 'identity-mismatch' }, { origin: lab.base, cookie });
  try {
    const none = await (await mismatch('')).json();
    assert.equal(none.identity.pageLogin.name, 'demouser', 'nobody signed in: the scenario\'s own page-login user');
    const admin = await (await mismatch(cookieOf(await login(lab.base, 'demoAdmin')))).json();
    assert.equal(admin.identity.pageLogin.name, 'demoAdmin');
    assert.equal(admin.identity.mismatch, true);
    assert.equal(admin.identity.name, 'aidemo', 'the gateway still evaluates the key\'s identity');
    const owner = await (await mismatch(cookieOf(await login(lab.base, 'aidemo')))).json();
    assert.equal(owner.identity.pageLogin.name, 'demouser', 'a person cannot mismatch themselves');
  } finally { await lab.close(); }
});
