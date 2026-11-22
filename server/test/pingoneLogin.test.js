// Real page login (pi.flow) against a STUB of PingOne. No test here ever calls a real PingOne: the stub is the fetch the login is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createPingOneLogin, loginConfig, mergeCookies, flowView, claimsFrom, LOGIN_NAMES, LoginError, MAX_BODY_BYTES } from '../src/auth/pingoneLogin.js';
import { decideLogin, createNetguard, NetguardError } from '../src/netguard.js';
import { createLab } from '../src/lab.js';
import { startLab, startStubGateway, realEnv, TEST_KEYS, postJson } from './helpers.js';

// Fake ids, built at run time so no id-shaped text sits in the source.
const ENV_ID = ['aaaaaaaa', 'bbbb', '4ccc', '8ddd', 'eeeeeeeeeeee'].join('-');
const CLIENT = 'test-client-0001';
const LOGIN_ENV = { PGC_PINGONE_ENVIRONMENT_ID: ENV_ID, PGC_PINGONE_REGION: 'com', PGC_USER_CLIENT_ID: CLIENT };
const FLOW = 'flow-ID_0123456789';
const PASSWORD = 'correct-horse-battery';
const SECRETS = { code: 'CODE-abc123', accessToken: 'AT-mock-token-xyz', idToken: 'IDT.mock.token', cookie1: 'ST-cookie-one', cookie2: 'ST-cookie-two' };
const cfgOf = (env = LOGIN_ENV) => loginConfig(env);

// A stub PingOne. Options change one behaviour at a time. Every request is recorded (with the body parsed where it is JSON or a form).
function stubPingOne(cfg, o = {}) {
  const calls = [];
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
  let authorizeQuery = null;
  let passwordTries = 0;
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const route = u.pathname.slice(new URL(cfg.base).pathname.length);
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    let body = init.body;
    try { if (/json/.test(headers['content-type'] || '')) body = JSON.parse(init.body); else if (/x-www-form/.test(headers['content-type'] || '')) body = Object.fromEntries(new URLSearchParams(init.body)); } catch { /* keep raw */ }
    calls.push({ method: init.method || 'GET', url: String(url), route, headers, body, redirect: init.redirect, hasSignal: Boolean(init.signal) });
    if (o.network) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (o.timeout) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const cookies = (n) => ({ 'set-cookie': `ST=${n}; Path=/; HttpOnly` });
    if (route === '/as/authorize') {
      if (o.authorize) return o.authorize();
      authorizeQuery = Object.fromEntries(u.searchParams);
      return json(200, { id: FLOW, status: o.start ?? 'USERNAME_PASSWORD_REQUIRED', _links: { self: { href: 'x' }, 'usernamePassword.check': { href: 'x' } } }, cookies(SECRETS.cookie1));
    }
    if (route === `/flows/${FLOW}`) {
      if (!String(headers.cookie || '').includes(`ST=${SECRETS.cookie1}`) && !String(headers.cookie || '').includes(`ST=${SECRETS.cookie2}`)) return json(401, { code: 'NO_SESSION' });
      if (/user\.lookup/.test(headers['content-type'])) return json(200, { id: FLOW, status: 'PASSWORD_REQUIRED' }, cookies(SECRETS.cookie2));
      if (!/usernamePassword\.check/.test(headers['content-type'])) return json(415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
      if (o.gone) return json(404, { code: 'NOT_FOUND' });
      passwordTries += 1;
      if (body.password !== PASSWORD) return json(400, { code: 'REQUEST_FAILED', details: [{ code: 'INVALID_CREDENTIALS' }] });
      if (o.after) return json(200, { id: FLOW, status: o.after });
      return json(200, { id: FLOW, status: 'COMPLETED', resumeUrl: `${cfg.base}/as/resume?flowId=${FLOW}` }, cookies(SECRETS.cookie2));
    }
    if (route === '/as/resume') {
      if (o.resume) return o.resume(authorizeQuery);
      if (u.searchParams.get('flowId') !== FLOW || !String(headers.cookie || '').includes(`ST=${SECRETS.cookie2}`)) return json(401, { code: 'NO_SESSION' });
      if (o.redirect) return new Response(null, { status: 302, headers: { location: `${authorizeQuery.redirect_uri}?code=${SECRETS.code}&state=${authorizeQuery.state}` } });
      return json(200, { id: FLOW, status: 'COMPLETED', authorizeResponse: { code: SECRETS.code, state: authorizeQuery.state, ...(o.answer || {}) } });
    }
    if (route === '/as/token') {
      if (o.token) return o.token();
      const challenge = crypto.createHash('sha256').update(String(body.code_verifier)).digest('base64url');
      if (body.grant_type !== 'authorization_code' || body.code !== SECRETS.code || challenge !== authorizeQuery.code_challenge || body.client_id !== CLIENT || 'client_secret' in body) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: SECRETS.accessToken, id_token: SECRETS.idToken, token_type: 'Bearer', expires_in: 3600 });
    }
    if (route === '/as/userinfo') {
      if (o.userinfo) return o.userinfo();
      if (headers.authorization !== `Bearer ${SECRETS.accessToken}`) return json(401, { error: 'invalid_token' });
      return json(200, { sub: 'user-0001', name: 'Demo User', preferred_username: 'demouser', email: 'demouser@example.com', phone_number: '+15550100', address: { street: 'x' } });
    }
    return json(404, { code: 'NOT_FOUND' });
  }
  return { fetchImpl, calls, tries: () => passwordTries, query: () => authorizeQuery };
}
const everything = (...parts) => JSON.stringify(parts);
const leaks = (text) => Object.values({ ...SECRETS, FLOW, PASSWORD }).filter((s) => String(text).includes(s));

test('the login settings come only from names in .env.example, and a problem names a setting, never its value', () => {
  const example = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  for (const n of LOGIN_NAMES) assert.ok(listed.has(n), `${n} is not in .env.example`);
  // Every name any server setting reads is listed there too.
  const read = new Set();
  const spy = new Proxy({}, { get: (_t, k) => { if (typeof k === 'string') read.add(k); return undefined; }, has: (_t, k) => { if (typeof k === 'string') read.add(k); return false; } });
  cfgOf(spy);
  assert.ok([...read].every((k) => listed.has(k)), `unlisted: ${[...read].filter((k) => !listed.has(k))}`);
  const bad = loginConfig({ PGC_PINGONE_ENVIRONMENT_ID: 'SECRET-LOOKING-VALUE', PGC_USER_CLIENT_ID: 'x y', PGC_PINGONE_REGION: 'mars' });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 3);
  assert.doesNotMatch(bad.problems.join(' '), /SECRET-LOOKING-VALUE|x y|mars/);
});

test('loginConfig: the sign-in base follows the region, aliases work, the redirect default is loopback, and a remote http redirect is refused', () => {
  const base = (region) => loginConfig({ ...LOGIN_ENV, PGC_PINGONE_REGION: region });
  assert.equal(cfgOf().ok, true);
  assert.equal(cfgOf().base, `${new URL(cfgOf().base).origin}/${ENV_ID}`);
  assert.equal(new URL(cfgOf().base).hostname, 'auth.pingone.com');
  assert.equal(new URL(base('eu').base).hostname, 'auth.pingone.eu');
  assert.equal(new URL(base('AP').base).hostname, 'auth.pingone.asia');
  assert.equal(new URL(base('au').base).hostname, 'auth.pingone.com.au');
  assert.equal(new URL(base('na').base).hostname, 'auth.pingone.com');
  assert.equal(new URL(loginConfig({ ...LOGIN_ENV, PGC_PINGONE_REGION: undefined }).base).hostname, 'auth.pingone.com', 'default region');
  assert.equal(base('evil.example').ok, false);
  assert.equal(cfgOf().redirectUri, 'http://127.0.0.1:7833/callback');
  assert.equal(loginConfig({ ...LOGIN_ENV, PGC_USER_REDIRECT_URI: 'http://remote.example/cb' }).ok, false);
  assert.equal(loginConfig({ ...LOGIN_ENV, PGC_USER_REDIRECT_URI: 'https://app.example/cb' }).ok, true);
  assert.equal(loginConfig({}).ok, false);
  assert.equal(loginConfig({}).base, null);
  assert.throws(() => createPingOneLogin({ cfg: loginConfig({}), fetchImpl() {} }));
});

test('the happy path: pi.flow only, PKCE, cookies replayed, and what comes out is a few claims and nothing secret', async () => {
  const cfg = cfgOf();
  const p = stubPingOne(cfg);
  const login = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl });
  const { run, view } = await login.start();
  assert.deepEqual(view, { state: 'credentials_required', status: 'USERNAME_PASSWORD_REQUIRED', actions: ['usernamePassword.check'] });
  const q = p.query();
  assert.equal(q.response_mode, 'pi.flow', 'no redirect login of any kind');
  assert.equal(q.response_type, 'code');
  assert.equal(q.code_challenge_method, 'S256');
  assert.ok(q.state.length >= 24 && q.nonce.length >= 24);
  assert.equal(q.client_id, CLIENT);
  assert.equal(q.scope, 'openid profile email');
  const out = await login.submit(run, { username: 'demouser', password: PASSWORD });
  assert.deepEqual(out, { state: 'signed_in', claims: { sub: 'user-0001', name: 'Demo User', username: 'demouser', email: 'demouser@example.com' } });
  assert.deepEqual(p.calls.map((c) => `${c.method} ${c.route.split('?')[0]}`), ['GET /as/authorize', `POST /flows/${FLOW}`, 'GET /as/resume', 'POST /as/token', 'GET /as/userinfo']);
  for (const c of p.calls) {
    assert.equal(c.redirect, 'manual', 'a redirect is never followed');
    assert.equal(c.hasSignal, true, 'every request has a timeout');
    assert.ok(c.url.startsWith(`${cfg.base}/`), c.url);
  }
  assert.match(p.calls[1].headers.cookie, /ST=ST-cookie-one/, 'the flow call replays the cookie PingOne set');
  assert.match(p.calls[2].headers.cookie, /ST=ST-cookie-two/, 'and the rotated one on the next step');
  assert.equal(p.calls[1].body.password, PASSWORD);
  for (const c of p.calls) assert.equal(c.url.includes(PASSWORD), false, 'the password is never in a URL');
  assert.equal(p.calls[3].body.client_id, CLIENT);
  assert.equal('client_secret' in p.calls[3].body, false, 'a public client sends no secret');
  assert.deepEqual(leaks(everything(out, view)), [], 'no password, flow id, cookie, code or token leaves the login');
});

test('identifier-first policies: user.lookup first, then the password', async () => {
  const cfg = cfgOf();
  const p = stubPingOne(cfg, { start: 'SIGN_ON_REQUIRED' });
  const login = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl });
  const { run } = await login.start();
  const out = await login.submit(run, { username: 'demouser', password: PASSWORD });
  assert.equal(out.state, 'signed_in');
  assert.deepEqual(p.calls.filter((c) => c.route.startsWith('/flows/')).map((c) => c.headers['content-type']), ['application/vnd.pingidentity.user.lookup+json', 'application/vnd.pingidentity.usernamePassword.check+json']);
});

test('a wrong password leaves the flow waiting; the next try can succeed', async () => {
  const cfg = cfgOf();
  const p = stubPingOne(cfg);
  const login = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl });
  const { run } = await login.start();
  await assert.rejects(login.submit(run, { username: 'demouser', password: 'wrong' }), (e) => e instanceof LoginError && e.code === 'credentials_refused' && e.status === 401 && !e.message.includes('wrong'));
  assert.equal((await login.submit(run, { username: 'demouser', password: PASSWORD })).state, 'signed_in');
  assert.equal(p.tries(), 2);
});

test('a policy that asks for more than a password stops with a named status; a hostile status is shown as UNKNOWN', async () => {
  const cfg = cfgOf();
  for (const [after, shown] of [['OTP_REQUIRED', 'OTP_REQUIRED'], ['DEVICE_SELECTION_REQUIRED', 'DEVICE_SELECTION_REQUIRED'], ['<img src=x onerror=alert(1)>', 'UNKNOWN']]) {
    const login = createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, { after }).fetchImpl });
    const { run } = await login.start();
    await assert.rejects(login.submit(run, { username: 'demouser', password: PASSWORD }), (e) => e.code === 'flow_stalled' && e.detail === shown && e.status === 502 && !/<|>/.test(e.message), after);
  }
  assert.deepEqual(flowView({ status: '<b>x</b>', _links: { self: {}, 'a b': {}, ok: {}, ['x'.repeat(80)]: {} } }), { status: 'UNKNOWN', actions: ['ok'] });
  assert.deepEqual(flowView(null), { status: null, actions: [] });
});

test('the run guards: no run, expired, wrong status, and bad username or password fields', async () => {
  const cfg = cfgOf();
  let now = 1_000_000;
  const p = stubPingOne(cfg);
  const login = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl, now: () => now });
  await assert.rejects(login.submit(undefined, { username: 'a', password: 'b' }), (e) => e.code === 'no_run' && e.status === 409);
  const { run } = await login.start();
  for (const [creds, code] of [[{ username: '', password: 'x' }, 'bad_username'], [{ username: 'a\nb', password: 'x' }, 'bad_username'], [{ username: 'a'.repeat(257), password: 'x' }, 'bad_username'], [{ username: 5, password: 'x' }, 'bad_username'], [{ username: 'u', password: '' }, 'bad_password'], [{ username: 'u', password: 'p'.repeat(1025) }, 'bad_password'], [{ username: 'u', password: { $ne: 1 } }, 'bad_password'], [undefined, 'bad_username']]) {
    await assert.rejects(login.submit(run, creds), (e) => e.code === code && e.status === 400, JSON.stringify(creds)?.slice(0, 30));
  }
  assert.equal(p.calls.length, 1, 'nothing was sent to PingOne for a bad field');
  run.status = 'OTP_REQUIRED';
  await assert.rejects(login.submit(run, { username: 'u', password: 'p' }), (e) => e.code === 'wrong_status');
  run.status = 'USERNAME_PASSWORD_REQUIRED';
  now += 5 * 60 * 1000 + 1;
  await assert.rejects(login.submit(run, { username: 'u', password: PASSWORD }), (e) => e.code === 'run_expired' && e.status === 409);
});

test('PingOne no longer knows the flow (404): a named answer that says to start again', async () => {
  const cfg = cfgOf();
  const login = createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, { gone: true }).fetchImpl });
  const { run } = await login.start();
  await assert.rejects(login.submit(run, { username: 'u', password: PASSWORD }), (e) => e.code === 'flow_gone' && e.status === 409);
});

test('the code can come back in a redirect that is read and never followed', async () => {
  const cfg = cfgOf();
  const p = stubPingOne(cfg, { redirect: true });
  const login = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl });
  const { run } = await login.start();
  assert.equal((await login.submit(run, { username: 'u', password: PASSWORD })).state, 'signed_in');
  assert.ok(p.calls.every((c) => c.url.startsWith(cfg.base)), 'the redirect target (the redirect URI) was never requested');
});

test('a refused, mismatched or empty authorization answer ends the sign-in with a named error', async () => {
  const cfg = cfgOf();
  const cases = [
    [{ answer: { state: 'someone-elses-state' } }, 'state_mismatch'],
    [{ answer: { error: 'access_denied' } }, 'signin_refused'],
    [{ answer: { code: '' } }, 'no_code'],
    [{ resume: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }, 'no_code'],
    [{ resume: () => new Response(null, { status: 404 }) }, 'flow_gone'],
    [{ token: () => new Response('{"error":"invalid_grant"}', { status: 400, headers: { 'content-type': 'application/json' } }) }, 'token_refused'],
    [{ token: () => new Response('{"token_type":"Bearer"}', { status: 200, headers: { 'content-type': 'application/json' } }) }, 'token_refused'],
    [{ userinfo: () => new Response('{"name":"no sub"}', { status: 200, headers: { 'content-type': 'application/json' } }) }, 'userinfo_failed'],
    [{ userinfo: () => new Response('<html>no</html>', { status: 200, headers: { 'content-type': 'text/html' } }) }, 'userinfo_failed'],
  ];
  for (const [opts, code] of cases) {
    const login = createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, opts).fetchImpl });
    const { run } = await login.start();
    await assert.rejects(login.submit(run, { username: 'u', password: PASSWORD }), (e) => e instanceof LoginError && e.code === code && leaks(e.message).length === 0, code);
  }
});

test('hostile PingOne replies: not JSON, an HTML page, a huge body and a refused authorize are named failures, never a hang or a leak', async () => {
  const cfg = cfgOf();
  const start = (authorize, extra = {}) => createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, { authorize, ...extra }).fetchImpl }).start();
  await assert.rejects(start(() => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })), (e) => e.code === 'piflow_not_opened' && !/html/i.test(e.message));
  await assert.rejects(start(() => new Response('{"id":"x"', { status: 200, headers: { 'content-type': 'application/json' } })), (e) => e.code === 'piflow_not_opened');
  await assert.rejects(start(() => new Response(JSON.stringify({ id: '../../etc', status: 'X' }), { status: 200, headers: { 'content-type': 'application/json' } })), (e) => e.code === 'piflow_not_opened', 'a flow id that is not an id is refused');
  await assert.rejects(start(() => new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400, headers: { 'content-type': 'application/json' } })), (e) => e.code === 'piflow_not_opened' && /400/.test(e.message));
  await assert.rejects(start(() => new Response('x'.repeat(MAX_BODY_BYTES + 10), { status: 200, headers: { 'content-type': 'application/json' } })), (e) => e.code === 'reply_too_large');
  await assert.rejects(start(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/login' } })), (e) => e.code === 'piflow_not_opened');
});

test('an unreachable or slow PingOne is a named JSON error', async () => {
  const cfg = cfgOf();
  await assert.rejects(createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, { network: true }).fetchImpl }).start(), (e) => e.code === 'pingone_unreachable' && e.status === 502 && !/ECONNREFUSED/.test(e.message));
  await assert.rejects(createPingOneLogin({ cfg, fetchImpl: stubPingOne(cfg, { timeout: true }).fetchImpl }).start(), (e) => e.code === 'pingone_timeout' && e.status === 502);
});

test('cookies from PingOne are bounded and sanitised before they are replayed', () => {
  const jar = mergeCookies({}, ['ST=abc; Path=/', 'bad name=1', 'ok2=a\u0001b', `big=${'x'.repeat(5000)}`, '=novalue', 'plain']);
  assert.deepEqual(jar, { ST: 'abc' });
  let many = {};
  for (let i = 0; i < 50; i += 1) many = mergeCookies(many, [`c${i}=v`]);
  assert.equal(Object.keys(many).length, 30);
  assert.equal(mergeCookies(many, ['c0=changed']).c0, 'changed', 'an existing cookie can still rotate');
});

test('claimsFrom keeps four short claims and drops everything else', () => {
  assert.deepEqual(claimsFrom({ sub: 's', name: 'N', preferred_username: 'u', email: 'e@example.com', phone_number: '1', groups: ['g'] }), { sub: 's', name: 'N', username: 'u', email: 'e@example.com' });
  assert.equal(claimsFrom({ name: 'no sub' }), null);
  assert.equal(claimsFrom({ sub: 'a\nb' }), null);
  assert.equal(claimsFrom({ sub: 'x'.repeat(200) }), null);
  assert.deepEqual(claimsFrom({ sub: 's', name: { evil: 1 }, email: 'x'.repeat(200) }), { sub: 's' });
});

// ---- outbound confinement ----------------------------------------------------------------------------------------------------

test('the netguard allows only the configured PingOne environment, and only in Real', () => {
  const base = cfgOf().base;
  const real = { mode: 'real', loginBase: base };
  assert.equal(decideLogin(`${base}/as/authorize?x=1`, real).allow, true);
  for (const [url, opts, code] of [
    [`${base}/as/token`, { mode: 'mock', loginBase: base }, 'blocked_mock'],
    [`${base}/as/token`, { mode: 'real' }, 'login_not_configured'],
    ['https://other.example/x', real, 'blocked_origin'],
    [`${new URL(base).origin}/other-env/as/token`, real, 'blocked_path'],
    [`${base}/../other-env/as/token`, real, 'blocked_path'],
    [`${base.replace('https', 'http')}/as/token`, real, 'blocked_scheme'],
    [(() => { const x = new URL(`${base}/as/token`); x.username = 'u'; x.password = 'p'; return x.href; })(), real, 'blocked_credentials'],
    ['not a url', real, 'bad_url'],
  ]) assert.equal(decideLogin(url, opts).code, code, `${url} -> ${code}`);
});

test('every request stays under the configured environment, and the netguard refuses sign-in in Mock', async () => {
  const cfg = cfgOf();
  const sent = [];
  const guard = createNetguard({ getMode: () => 'real', mockGateway: { handle() { throw new Error('no'); } }, getLoginBase: () => cfg.base });
  // A flow whose resume link points elsewhere is not followed: the login builds every URL itself under cfg.base.
  const p = stubPingOne(cfg, { after: 'COMPLETED' });
  const login = createPingOneLogin({ cfg, fetchImpl: async (u, i) => { sent.push(String(u)); return p.fetchImpl(u, i); }, guard });
  const { run } = await login.start();
  await login.submit(run, { username: 'u', password: PASSWORD }).catch(() => {});
  assert.ok(sent.every((u) => u.startsWith(`${cfg.base}/`)));
  assert.equal(guard.stats().loginAllowed, sent.length);
  // The guard in Mock refuses every sign-in request and counts it.
  const mockGuard = createNetguard({ getMode: () => 'mock', mockGateway: {}, getLoginBase: () => cfg.base });
  assert.throws(() => mockGuard.assertLoginAllowed(`${cfg.base}/as/authorize`), (e) => e instanceof NetguardError && e.code === 'blocked_mock');
  assert.equal(mockGuard.stats().blocked, 1);
  // A netguard refusal inside the login is a named error, not a crash.
  const refusing = createPingOneLogin({ cfg, fetchImpl: p.fetchImpl, guard: mockGuard });
  await assert.rejects(refusing.start(), (e) => e instanceof LoginError && e.code === 'outbound_refused');
});

// ---- through the app ------------------------------------------------------------------------------------------------------------

async function realApp(opts = {}, extraEnv = {}) {
  const gw = await startStubGateway({ keys: TEST_KEYS });
  const cfg = cfgOf();
  const p = stubPingOne(cfg, opts);
  const lab = await startLab({ env: { ...realEnv(gw.origin, { MODE: 'real' }), ...LOGIN_ENV, ...extraEnv }, fetchImpl: p.fetchImpl });
  return { lab, p, cfg, close: async () => { await lab.close(); await gw.close(); } };
}
const post = (base, route, body, headers = {}) => postJson(base, route, body, { origin: base, ...headers });

test('through the app: start, credentials, session cookie, who is signed in; and nothing secret in any response', async () => {
  const app = await realApp();
  try {
    const { base } = app.lab;
    const cfgRes = await (await fetch(`${base}/api/auth/config`)).json();
    assert.deepEqual(cfgRes.real, { flow: 'pi.flow', configured: true, problems: [] });
    const s = await post(base, '/api/auth/live/start', {});
    const startBody = await s.json();
    assert.equal(s.status, 200);
    assert.equal(startBody.status, 'USERNAME_PASSWORD_REQUIRED');
    const bad = await post(base, '/api/auth/live/credentials', { username: 'demouser', password: 'wrong' });
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error, 'credentials_refused');
    const ok = await post(base, '/api/auth/live/credentials', { username: 'demouser', password: PASSWORD });
    const okText = await ok.text();
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(okText).me, { source: 'real-login', sub: 'user-0001', name: 'Demo User', username: 'demouser', email: 'demouser@example.com' });
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /^pgc_session_default=.+; HttpOnly; SameSite=Strict/);
    assert.deepEqual(leaks(okText + setCookie + JSON.stringify(startBody)), [], 'no password, flow id, code, token or PingOne cookie in a response or in our own cookie');
    const me = (await (await fetch(`${base}/api/session`, { headers: { cookie: setCookie.split(';')[0] } })).json()).me;
    assert.equal(me.source, 'real-login');
    // Switching to Mock hides the Real identity (it is not a Mock identity).
    await post(base, '/api/mode', { source: 'mock' });
    assert.equal((await (await fetch(`${base}/api/session`, { headers: { cookie: setCookie.split(';')[0] } })).json()).me, null);
    // The run is gone after a sign-in: a second credentials post has no run.
    await post(base, '/api/mode', { source: 'real' });
    const again = await post(base, '/api/auth/live/credentials', { username: 'demouser', password: PASSWORD });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error, 'no_run');
  } finally { await app.close(); }
});

test('through the app: Mock never signs in against PingOne, and an unconfigured Real says which settings are missing', async () => {
  const gw = await startStubGateway({ keys: TEST_KEYS });
  let outbound = 0;
  const lab = await startLab({ env: { ...realEnv(gw.origin, { MODE: 'mock' }), ...LOGIN_ENV }, fetchImpl: async () => { outbound += 1; throw new Error('must not be called'); } });
  try {
    const r = await post(lab.base, '/api/auth/live/start', {});
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'real_only');
    assert.equal((await post(lab.base, '/api/auth/live/credentials', { username: 'u', password: 'p' })).status, 403);
    assert.equal(outbound, 0, 'zero outbound attempts in Mock');
    assert.equal(lab.lab.guard.stats().loginAllowed, 0);
  } finally { await lab.close(); await gw.close(); }
  const gw2 = await startStubGateway({ keys: TEST_KEYS });
  const lab2 = await startLab({ env: { ...realEnv(gw2.origin, { MODE: 'real' }), PGC_USER_CLIENT_ID: CLIENT } });
  try {
    const r = await post(lab2.base, '/api/auth/live/start', {});
    const body = await r.json();
    assert.equal(r.status, 409);
    assert.equal(body.error, 'login_not_configured');
    assert.match(body.message, /PGC_PINGONE_ENVIRONMENT_ID is not set/);
    assert.doesNotMatch(body.message, new RegExp(CLIENT), 'a setting value is never echoed');
  } finally { await lab2.close(); await gw2.close(); }
});

test('through the app: PingOne failures are JSON with a name, and a wrong password does not end the run but other failures do', async () => {
  const app = await realApp({ network: true });
  try {
    const r = await post(app.lab.base, '/api/auth/live/start', {});
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error, 'pingone_unreachable');
  } finally { await app.close(); }
  const app2 = await realApp({ after: 'OTP_REQUIRED' });
  try {
    await post(app2.lab.base, '/api/auth/live/start', {});
    const r = await post(app2.lab.base, '/api/auth/live/credentials', { username: 'u', password: PASSWORD });
    const body = await r.json();
    assert.equal(r.status, 502);
    assert.equal(body.error, 'flow_stalled');
    assert.equal(body.detail, 'OTP_REQUIRED');
    assert.equal((await post(app2.lab.base, '/api/auth/live/credentials', { username: 'u', password: PASSWORD })).status, 409, 'the stalled run was dropped');
  } finally { await app2.close(); }
});

test('through the app: a cross-site write cannot start a sign-in, and Reset drops a waiting sign-in', async () => {
  const app = await realApp();
  try {
    const { base } = app.lab;
    assert.equal((await postJson(base, '/api/auth/live/start', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal(app.p.calls.length, 0);
    await post(base, '/api/auth/live/start', {});
    await post(base, '/api/reset', {});
    const r = await post(base, '/api/auth/live/credentials', { username: 'demouser', password: PASSWORD });
    assert.equal((await r.json()).error, 'no_run');
  } finally { await app.close(); }
});

test('the lab exposes its page-login settings state without their values', () => {
  const lab = createLab({ env: { ...LOGIN_ENV } });
  assert.equal(lab.login.ok, true);
  assert.equal(JSON.stringify(lab.info()).includes(ENV_ID), false);
  assert.equal(JSON.stringify(lab.info()).includes(CLIENT), false);
});
