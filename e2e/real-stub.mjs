// A Real-mode lab for the browser proof, with NOTHING real behind it: a loopback STUB gateway (the repo's own test stub) and a STUB PingOne
// (the pi.flow page login's fetch is routed to it, so no packet ever leaves this machine).
//
//   PORT=7934 node e2e/real-stub.mjs            then   REAL_BASE=http://127.0.0.1:7934/ python3 e2e/demo.py
//
// The stub's user password is a test-only value printed below; it is not a credential of anything.
import crypto from 'node:crypto';
import { createApp, startHttpServer } from '../server/src/app.js';
import { startStubGateway, realEnv, TEST_KEYS } from '../server/test/helpers.js';
import { loginConfig } from '../server/src/auth/pingoneLogin.js';

const PORT = Number(process.env.PORT) || 7934;
const WITH_LOGIN = process.env.WITH_LOGIN !== '0';
const ENV_ID = ['aaaaaaaa', 'bbbb', '4ccc', '8ddd', 'eeeeeeeeeeee'].join('-');
const CLIENT = 'stub-client-0001';
const FLOW = 'flow-ID_0123456789';
export const STUB_PASSWORD = 'correct-horse-battery';
const loginEnv = WITH_LOGIN ? { PGC_PINGONE_ENVIRONMENT_ID: ENV_ID, PGC_PINGONE_REGION: 'com', PGC_USER_CLIENT_ID: CLIENT, PGC_USER_REDIRECT_URI: `http://127.0.0.1:${PORT}/callback` } : {};
const cfg = loginConfig(loginEnv, { port: PORT });

function stubPingOne() {
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
  let authorizeQuery = null;
  return async (url, init = {}) => {
    const u = new URL(url);
    if (!cfg.ok || !String(url).startsWith(cfg.base)) return fetch(url, init); // the gateway stub on loopback
    const route = u.pathname.slice(new URL(cfg.base).pathname.length);
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    let body = init.body;
    try { if (/json/.test(headers['content-type'] || '')) body = JSON.parse(init.body); else if (/x-www-form/.test(headers['content-type'] || '')) body = Object.fromEntries(new URLSearchParams(init.body)); } catch { /* raw */ }
    const cookie = (n) => ({ 'set-cookie': `ST=${n}; Path=/; HttpOnly` });
    if (route === '/as/authorize') {
      authorizeQuery = Object.fromEntries(u.searchParams);
      return json(200, { id: FLOW, status: 'USERNAME_PASSWORD_REQUIRED', _links: { self: { href: 'x' }, 'usernamePassword.check': { href: 'x' } } }, cookie('one'));
    }
    if (route === `/flows/${FLOW}`) {
      if (/user\.lookup/.test(headers['content-type'])) return json(200, { id: FLOW, status: 'PASSWORD_REQUIRED' }, cookie('two'));
      if (body?.password !== STUB_PASSWORD) return json(400, { code: 'REQUEST_FAILED', details: [{ code: 'INVALID_CREDENTIALS' }] });
      return json(200, { id: FLOW, status: 'COMPLETED', resumeUrl: `${cfg.base}/as/resume?flowId=${FLOW}` }, cookie('two'));
    }
    if (route === '/as/resume') return json(200, { id: FLOW, status: 'COMPLETED', authorizeResponse: { code: 'CODE-stub', state: authorizeQuery.state } });
    if (route === '/as/token') {
      const challenge = crypto.createHash('sha256').update(String(body.code_verifier)).digest('base64url');
      return challenge === authorizeQuery.code_challenge ? json(200, { access_token: 'AT-stub', id_token: 'IDT.stub.token', token_type: 'Bearer', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
    }
    if (route === '/as/userinfo') return json(200, { sub: 'user-0001', name: 'Demo User', preferred_username: 'demouser', email: 'demouser@example.com' });
    return json(404, { code: 'NOT_FOUND' });
  };
}

// STUB_FAIL=502 makes every answer of the stub gateway that status (a Real upstream failure), for the browser proof of the 'failed' look.
const stub = await startStubGateway({ keys: TEST_KEYS, fail: Number(process.env.STUB_FAIL) || 0 });
const { app, health } = createApp({ env: { ...realEnv(stub.origin, { MODE: process.env.MODE_START || 'real' }), ...loginEnv }, fetchImpl: stubPingOne() });
const { url } = await startHttpServer({ port: PORT, host: '127.0.0.1', app });
console.log(`real-stub lab at ${url} (Real against a loopback STUB gateway${WITH_LOGIN ? ' and a STUB PingOne; the stub user password is "' + STUB_PASSWORD + '"' : ', page login not configured'})`);
process.on('SIGTERM', () => { health.stop(); process.exit(0); });
