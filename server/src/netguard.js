// netguard: the one gate for everything this lab sends toward a network.
//
// Mock: a request is served in-process by the mock gateway when it targets the mock origin, and refused otherwise. No
// socket is opened, so zero outbound attempts happen.
// Real (owner-run): exactly ONE origin may be reached, the gateway the lab's own .env names. https only (plain http only to
// loopback), no link-local or metadata literals, and a request for any other origin is refused. The shared gateway-real
// client makes its own fetch and never follows a redirect; the lab asks assertAllowed(url) before every call it makes.
// A real network call is therefore never made unless this module has said yes to that exact origin.
import { MOCK_ORIGIN } from './mockGateway.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const UNSAFE = new Set(['0.0.0.0', '[::]', 'metadata.google.internal', '100.100.100.200']);

export class NetguardError extends Error {
  constructor(code, message) { super(message); this.name = 'NetguardError'; this.code = code; }
}

const parse = (input) => { try { return new URL(String(input)); } catch { return null; } };
const unsafeLiteral = (h) => UNSAFE.has(h) || /^169\.254\./.test(h) || /^\[fe80:/i.test(h);

// Pure policy. -> { allow, route, code, reason }. `mode`, `realOrigin` are passed in so the self-test can ask about other states.
export function decide(input, { mode, realOrigin = null, mockOrigin = MOCK_ORIGIN } = {}) {
  const url = parse(input);
  if (!url) return { allow: false, code: 'bad_url', reason: 'Not a valid URL.' };
  if (mode === 'mock') {
    if (url.origin === mockOrigin) return { allow: true, route: 'mock' };
    return { allow: false, code: 'blocked_mock', reason: 'Mock mode: only the in-process mock gateway can be reached. Switch to Real to contact a configured gateway.' };
  }
  if (mode !== 'real') return { allow: false, code: 'bad_mode', reason: 'Unknown mode.' };
  if (!realOrigin) return { allow: false, code: 'real_not_configured', reason: 'Real is not configured, so no network origin is allowed.' };
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) return { allow: false, code: 'blocked_scheme', reason: 'Real mode allows https, or http to loopback only.' };
  if (unsafeLiteral(url.hostname)) return { allow: false, code: 'blocked_ssrf', reason: 'Link-local, metadata and unspecified addresses are refused.' };
  if (url.origin !== realOrigin) return { allow: false, code: 'blocked_origin', reason: 'Only the one gateway named in this lab\'s own .env may be reached.' };
  return { allow: true, route: 'real' };
}

// Real page sign-in (pi.flow) talks to PingOne, a second origin that is not the gateway. It has its own allowance, still one origin:
// https, no credentials in the URL, exactly the sign-in base the lab's own .env names (https://auth.pingone.<region>/<environment>),
// and only paths under that environment. Mock never signs in against anything, so Mock allows none.
export function decideLogin(input, { mode, loginBase = null } = {}) {
  const url = parse(input);
  if (!url) return { allow: false, code: 'bad_url', reason: 'Not a valid URL.' };
  if (mode !== 'real') return { allow: false, code: 'blocked_mock', reason: 'Page sign-in contacts PingOne and exists in Real only. Mock uses the persona picker and contacts nothing.' };
  const base = loginBase ? parse(loginBase) : null;
  if (!base) return { allow: false, code: 'login_not_configured', reason: 'Page sign-in is not configured, so no origin is allowed.' };
  if (url.protocol !== 'https:') return { allow: false, code: 'blocked_scheme', reason: 'Page sign-in allows https only.' };
  if (url.username || url.password) return { allow: false, code: 'blocked_credentials', reason: 'A URL carrying credentials is refused.' };
  if (url.origin !== base.origin) return { allow: false, code: 'blocked_origin', reason: 'Only the sign-in origin named in this lab\'s own .env may be reached.' };
  const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
  if (!url.pathname.startsWith(prefix)) return { allow: false, code: 'blocked_path', reason: 'Only paths under the configured PingOne environment may be reached.' };
  return { allow: true, route: 'login' };
}

// Real agent chat talks to the Anthropic API, a third origin. It has its own allowance, still one origin: https, no credentials in
// the URL, exactly MODEL_ORIGIN, and only when the lab is in Real and the owner set the agent's key. Mock never calls a model.
export const MODEL_ORIGIN = 'https://api.anthropic.com';
export function decideModel(input, { mode, configured = false } = {}) {
  const url = parse(input);
  if (!url) return { allow: false, code: 'bad_url', reason: 'Not a valid URL.' };
  if (mode !== 'real') return { allow: false, code: 'blocked_mock', reason: 'The real agent calls a model and exists in Real only. The Mock chat calls no model.' };
  if (!configured) return { allow: false, code: 'agent_not_configured', reason: 'The real agent is not configured, so no model origin is allowed.' };
  if (url.protocol !== 'https:') return { allow: false, code: 'blocked_scheme', reason: 'The agent model allows https only.' };
  if (url.username || url.password) return { allow: false, code: 'blocked_credentials', reason: 'A URL carrying credentials is refused.' };
  if (url.origin !== MODEL_ORIGIN) return { allow: false, code: 'blocked_origin', reason: 'Only the Anthropic API origin may be reached by the agent.' };
  return { allow: true, route: 'model' };
}

// Pure self-test over synthetic inputs: no network call. Used by the doctor, /api/health and the tests.
export function selfTest() {
  const REAL = 'https://gateway.example';
  const cases = [
    ['mock serves the mock gateway', `${MOCK_ORIGIN}/lab-banking-full/mcp`, { mode: 'mock' }, 'allow'],
    ['mock refuses a real-looking origin', 'https://gateway.example/lab-banking-full/mcp', { mode: 'mock', realOrigin: REAL }, 'blocked_mock'],
    ['mock refuses even loopback', 'http://127.0.0.1:9/x', { mode: 'mock' }, 'blocked_mock'],
    ['real refuses everything when not configured', 'https://gateway.example/x', { mode: 'real' }, 'real_not_configured'],
    ['real allows the one configured origin', 'https://gateway.example/lab-banking-full/mcp', { mode: 'real', realOrigin: REAL }, 'allow'],
    ['real refuses another origin', 'https://other.example/x', { mode: 'real', realOrigin: REAL }, 'blocked_origin'],
    ['real refuses a sibling host and a different port', 'https://gateway.example:8443/x', { mode: 'real', realOrigin: REAL }, 'blocked_origin'],
    ['real refuses plain http to a remote host', 'http://gateway.example/x', { mode: 'real', realOrigin: 'http://gateway.example' }, 'blocked_scheme'],
    ['real allows http to a configured loopback gateway', 'http://127.0.0.1:9/x', { mode: 'real', realOrigin: 'http://127.0.0.1:9' }, 'allow'],
    ['real refuses the metadata address', 'https://169.254.169.254/latest', { mode: 'real', realOrigin: 'https://169.254.169.254' }, 'blocked_ssrf'],
    ['real refuses the mock origin', `${MOCK_ORIGIN}/x`, { mode: 'real', realOrigin: REAL }, 'blocked_origin'],
    ['a string that is not a URL is refused', 'not a url', { mode: 'mock' }, 'bad_url'],
  ];
  const LOGIN = 'https://auth.sign-in.example/env-one';
  const withCredentials = (u) => { const x = new URL(u); x.username = 'user'; x.password = 'pw'; return x.href; };
  const loginCases = [
    ['sign-in allows a path under the configured environment', `${LOGIN}/flows/abc`, { mode: 'real', loginBase: LOGIN }, 'allow'],
    ['sign-in refuses every URL in Mock', `${LOGIN}/flows/abc`, { mode: 'mock', loginBase: LOGIN }, 'blocked_mock'],
    ['sign-in refuses another origin', 'https://other.example/env-one/flows/abc', { mode: 'real', loginBase: LOGIN }, 'blocked_origin'],
    ['sign-in refuses another environment on the same host', 'https://auth.sign-in.example/env-two/flows/abc', { mode: 'real', loginBase: LOGIN }, 'blocked_path'],
    ['sign-in refuses a dot-dot escape from the environment', `${LOGIN}/../env-two/flows/abc`, { mode: 'real', loginBase: LOGIN }, 'blocked_path'],
    ['sign-in refuses plain http', 'http://auth.sign-in.example/env-one/flows/abc', { mode: 'real', loginBase: LOGIN }, 'blocked_scheme'],
    ['sign-in refuses a URL carrying credentials', withCredentials(`${LOGIN}/flows/abc`), { mode: 'real', loginBase: LOGIN }, 'blocked_credentials'],
    ['sign-in refuses everything when it is not configured', `${LOGIN}/flows/abc`, { mode: 'real' }, 'login_not_configured'],
  ];
  const run = (fn) => ([name, input, opts, expect]) => {
    const v = fn(input, opts);
    const got = v.allow ? 'allow' : v.code;
    return { name, ok: got === expect, got, expect };
  };
  const modelCases = [
    ['agent model allows the Anthropic API in Real when configured', `${MODEL_ORIGIN}/v1/messages`, { mode: 'real', configured: true }, 'allow'],
    ['agent model refuses every URL in Mock', `${MODEL_ORIGIN}/v1/messages`, { mode: 'mock', configured: true }, 'blocked_mock'],
    ['agent model refuses everything when not configured', `${MODEL_ORIGIN}/v1/messages`, { mode: 'real' }, 'agent_not_configured'],
    ['agent model refuses another origin', 'https://api.anthropic.com.example/v1/messages', { mode: 'real', configured: true }, 'blocked_origin'],
    ['agent model refuses plain http', 'http://api.anthropic.com/v1/messages', { mode: 'real', configured: true }, 'blocked_scheme'],
    ['agent model refuses the gateway origin', 'https://gateway.example/x', { mode: 'real', configured: true }, 'blocked_origin'],
  ];
  const checks = [...cases.map(run(decide)), ...loginCases.map(run(decideLogin)), ...modelCases.map(run(decideModel))];
  return { ok: checks.every((c) => c.ok), checks };
}

// One guard per lab instance. getMode() is read at every call, so a switch needs no restart.
export function createNetguard({ getMode, mockGateway, getRealOrigin = () => null, getLoginBase = () => null, getModelConfigured = () => false }) {
  const stats = { attempts: 0, blocked: 0, mockServed: 0, realAllowed: 0, loginAllowed: 0, modelAllowed: 0 };
  const verdict = (input) => decide(input, { mode: getMode(), realOrigin: getRealOrigin() });

  // Drop-in for fetch(), for the Mock transport. A Real request never goes through here: see assertAllowed.
  async function guardedFetch(input, init = {}) {
    stats.attempts += 1;
    const v = verdict(input);
    if (!v.allow) { stats.blocked += 1; throw new NetguardError(v.code, v.reason); }
    if (v.route !== 'mock') { stats.blocked += 1; throw new NetguardError('wrong_route', 'guardedFetch serves the mock gateway only; a Real call goes through the gateway-real client, after assertAllowed.'); }
    stats.mockServed += 1;
    return mockGateway.handle(new URL(String(input)), init);
  }

  // Called before every Real call. Throws NetguardError unless this exact origin is the configured gateway.
  function assertAllowed(input) {
    stats.attempts += 1;
    const v = verdict(input);
    if (!v.allow) { stats.blocked += 1; throw new NetguardError(v.code, v.reason); }
    if (v.route === 'real') stats.realAllowed += 1;
    return v;
  }

  // Called before every page sign-in request. Throws NetguardError unless the URL is under the configured PingOne environment.
  function assertLoginAllowed(input) {
    stats.attempts += 1;
    const v = decideLogin(input, { mode: getMode(), loginBase: getLoginBase() });
    if (!v.allow) { stats.blocked += 1; throw new NetguardError(v.code, v.reason); }
    stats.loginAllowed += 1;
    return v;
  }

  // Called before every agent model request. Throws NetguardError unless the lab is in Real, the agent is configured and the URL is the Anthropic API.
  function assertModelAllowed(input) {
    stats.attempts += 1;
    const v = decideModel(input, { mode: getMode(), configured: getModelConfigured() });
    if (!v.allow) { stats.blocked += 1; throw new NetguardError(v.code, v.reason); }
    stats.modelAllowed += 1;
    return v;
  }

  return { guardedFetch, assertAllowed, assertLoginAllowed, assertModelAllowed, decide: verdict, selfTest, stats: () => ({ ...stats }), resetStats: () => { for (const k of Object.keys(stats)) stats[k] = 0; } };
}
