// Real page sign-in: PingOne pi.flow only (rule 16), no redirect login of any kind. This lab's own copy; nothing is imported from
// another repo. The shape follows what the family's pingone-LAB recorded on a real run on 2026-10-30:
//   1. GET  <base>/as/authorize?...&response_mode=pi.flow   PingOne answers 200 with a JSON flow (id, status, _links), not a login page
//   2. POST <base>/flows/<id>  user.lookup (only when the policy is identifier-first), then usernamePassword.check, replaying PingOne's
//      session cookies on every step
//   3. a COMPLETED flow carries no code: GET <base>/as/resume?flowId=<id> hands it back, as JSON (authorizeResponse) or as a redirect
//      that is read and NEVER followed
//   4. POST <base>/as/token  authorization_code + PKCE (a public client: client_id, no secret)
//   5. GET  <base>/as/userinfo  with the access token, for the few claims the page shows (so no token is decoded by hand here)
// <base> is https://auth.pingone.<region>/<environment id>. UNVERIFIED in this lab: steps 4 and 5 against a live tenant (the access token
// is used once and thrown away), and whether a given tenant's policy asks for more than a password (MFA is NOT driven: the run stops with
// a named status). Every request goes through the netguard's assertLoginAllowed first, and tests run against stubbed responses only.
//
// What leaves this module: a few claims (sub, name, username, email). Never a token, a flow id, a cookie, a code or the password.
import crypto from 'node:crypto';
import { ENV_PREFIX } from '../config.js';

export const FLOW_ID = /^[A-Za-z0-9_-]{6,128}$/;
export const USER_LOOKUP = 'application/vnd.pingidentity.user.lookup+json';
export const USERNAME_PASSWORD_CHECK = 'application/vnd.pingidentity.usernamePassword.check+json';
// The statuses at which this lab's form can answer: a username and password, a username first, or a password.
export const CREDENTIAL_STATUSES = new Set(['USERNAME_PASSWORD_REQUIRED', 'SIGN_ON_REQUIRED', 'PASSWORD_REQUIRED']);
export const MAX_FLOW_STEPS = 6;
export const RUN_TTL_MS = 5 * 60 * 1000;
export const MAX_BODY_BYTES = 256 * 1024;
export const TIMEOUT_MS = 8000;
const MAX_COOKIES = 30;
const CONTROL = /[\u0000-\u001f\u007f]/;

// PingOne region -> the top-level domain of its auth host. Aliases are the names people use.
const TLD = { com: 'com', eu: 'eu', ca: 'ca', asia: 'asia', 'com.au': 'com.au', sg: 'sg' };
const REGION_ALIASES = { na: 'com', us: 'com', ap: 'asia', au: 'com.au' };
const ENV_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9._-]{4,128}$/;

export const LOGIN_NAMES = Object.freeze([`${ENV_PREFIX}_PINGONE_ENVIRONMENT_ID`, `${ENV_PREFIX}_PINGONE_REGION`, `${ENV_PREFIX}_USER_CLIENT_ID`, `${ENV_PREFIX}_USER_REDIRECT_URI`]);

export class LoginError extends Error {
  constructor(status, code, message, detail) { super(message); this.status = status; this.code = code; if (detail) this.detail = detail; }
}

// The sign-in settings from this lab's own environment. -> { ok, problems, base, clientId, redirectUri, scope }.
// A problem names a setting, never its value.
export function loginConfig(env = process.env, { port = 7833 } = {}) {
  const get = (n) => String(env[`${ENV_PREFIX}_${n}`] ?? '').trim();
  const problems = [];
  const envId = get('PINGONE_ENVIRONMENT_ID');
  if (!envId) problems.push(`${ENV_PREFIX}_PINGONE_ENVIRONMENT_ID is not set`);
  else if (!ENV_ID.test(envId)) problems.push(`${ENV_PREFIX}_PINGONE_ENVIRONMENT_ID is not an environment id`);
  const regionRaw = get('PINGONE_REGION').toLowerCase() || 'com';
  const region = REGION_ALIASES[regionRaw] ?? regionRaw;
  if (!Object.hasOwn(TLD, region)) problems.push(`${ENV_PREFIX}_PINGONE_REGION must be one of ${Object.keys(TLD).join(', ')}`);
  const clientId = get('USER_CLIENT_ID');
  if (!clientId) problems.push(`${ENV_PREFIX}_USER_CLIENT_ID is not set`);
  else if (!CLIENT_ID.test(clientId)) problems.push(`${ENV_PREFIX}_USER_CLIENT_ID is not a client id`);
  const redirectUri = get('USER_REDIRECT_URI') || `http://127.0.0.1:${port}/callback`;
  try {
    const u = new URL(redirectUri);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) problems.push(`${ENV_PREFIX}_USER_REDIRECT_URI must be https, or http on loopback`);
  } catch { problems.push(`${ENV_PREFIX}_USER_REDIRECT_URI is not a URL`); }
  if (problems.length) return { ok: false, problems, base: null, clientId: null, redirectUri: null, scope: null };
  return { ok: true, problems: [], base: `https://auth.pingone.${TLD[region]}/${envId.toLowerCase()}`, clientId, redirectUri, scope: 'openid profile email' };
}

// PingOne ties a flow to its session cookies, so every step replays the jar and merges what comes back.
export function mergeCookies(jar, setCookies) {
  const next = { ...jar };
  for (const line of setCookies || []) {
    const [pair] = String(line).split(';');
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || value.length > 4096 || CONTROL.test(value)) continue;
    if (!Object.hasOwn(next, name) && Object.keys(next).length >= MAX_COOKIES) continue;
    next[name] = value;
  }
  return next;
}
const cookieHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => `${k}=${v}`).join('; ');

// What the page may render of a flow: its status and the actions on offer. Never the flow id (a bearer handle to the sign-in).
const statusName = (s) => (typeof s === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(s) ? s : 'UNKNOWN');
export const flowView = (flow) => ({
  status: typeof flow?.status === 'string' ? statusName(flow.status) : null,
  actions: Object.keys(flow?._links || {}).filter((n) => n !== 'self' && /^[A-Za-z0-9._-]{1,64}$/.test(n)).slice(0, 20),
});

const pkcePair = () => {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const shortText = (v, max = 128) => (typeof v === 'string' && v && v.length <= max && !CONTROL.test(v) ? v : null);

// The claims the page keeps. Everything else PingOne says is dropped.
export function claimsFrom(info) {
  const sub = shortText(info?.sub);
  if (!sub) return null;
  const out = { sub };
  for (const [from, to] of [['name', 'name'], ['preferred_username', 'username'], ['email', 'email']]) {
    const v = shortText(info?.[from]);
    if (v) out[to] = v;
  }
  return out;
}

// cfg: loginConfig(...) with ok true. fetchImpl: the global fetch in the app, a stub in tests. guard: { assertLoginAllowed(url) }.
export function createPingOneLogin({ cfg, fetchImpl, guard = null, now = Date.now }) {
  if (!cfg?.ok) throw new Error('createPingOneLogin needs a valid login config');

  async function readCapped(res) {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw new LoginError(502, 'reply_too_large', 'PingOne answered with more data than the sign-in accepts.'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // One request. Never follows a redirect. A network failure, a timeout and a netguard refusal each become a named LoginError.
  async function call(target, { method = 'GET', headers = {}, body } = {}) {
    // Every URL is built from cfg.base in this module, and the netguard (below) refuses anything outside the configured environment.
    const url = new URL(target);
    let res;
    try {
      guard?.assertLoginAllowed(url.toString());
      res = await fetchImpl(url.toString(), { method, headers, ...(body !== undefined ? { body } : {}), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (e?.name === 'NetguardError') throw new LoginError(502, 'outbound_refused', String(e.message).slice(0, 200));
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new LoginError(502, timedOut ? 'pingone_timeout' : 'pingone_unreachable', timedOut ? 'PingOne did not answer in time.' : 'PingOne could not be reached.');
    }
    const text = await readCapped(res);
    let json = null;
    if (/json/i.test(String(res.headers.get('content-type') || ''))) { try { json = JSON.parse(text); } catch { json = null; } }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json, location: res.headers.get('location'), setCookies: [...(res.headers.getSetCookie?.() || [])] };
  }

  async function advance(run, flow) {
    run.steps += 1;
    if (run.steps > MAX_FLOW_STEPS) throw new LoginError(502, 'flow_stalled', 'The sign-in took too many steps.');
    run.status = statusName(flow?.status);
    if (flow?.status === 'COMPLETED') return complete(run);
    // MFA, consent, an external IdP and so on: this lab drives a password only, and says which status it stopped at.
    if (CREDENTIAL_STATUSES.has(run.status)) return { state: 'credentials_required', ...flowView(flow) };
    throw new LoginError(502, 'flow_stalled', `PingOne's sign-in policy asked for a step this lab does not drive (${run.status}). Use a user whose policy asks for a password only.`, run.status);
  }

  async function complete(run) {
    const resumed = await call(`${cfg.base}/as/resume?flowId=${encodeURIComponent(run.flowId)}`, { headers: { Accept: 'application/json', ...(Object.keys(run.jar).length ? { Cookie: cookieHeader(run.jar) } : {}) } });
    run.jar = mergeCookies(run.jar, resumed.setCookies);
    if (resumed.status === 404 || resumed.status === 410) throw new LoginError(409, 'flow_gone', 'PingOne no longer knows this sign-in. Start again.');
    let answer = resumed.json?.authorizeResponse ?? null;
    if (!answer && resumed.location) {
      try {
        const loc = new URL(resumed.location, cfg.base);
        answer = Object.fromEntries(['code', 'state', 'error'].filter((k) => loc.searchParams.has(k)).map((k) => [k, loc.searchParams.get(k)]));
      } catch { answer = null; }
    }
    if (!answer) throw new LoginError(502, 'no_code', 'PingOne finished the sign-in but returned no authorization response.');
    if (typeof answer.state === 'string' && answer.state !== run.state) throw new LoginError(502, 'state_mismatch', 'The sign-in answer did not carry this sign-in\'s state.');
    if (answer.error) throw new LoginError(401, 'signin_refused', 'PingOne refused the sign-in.', String(answer.error).slice(0, 64).replace(/[^\w.-]/g, '?'));
    if (typeof answer.code !== 'string' || !answer.code) throw new LoginError(502, 'no_code', 'The completed sign-in carries no authorization code.');
    const tokens = await call(`${cfg.base}/as/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: answer.code, redirect_uri: cfg.redirectUri, code_verifier: run.codes.verifier, client_id: cfg.clientId }).toString(),
    });
    const accessToken = tokens.ok && typeof tokens.json?.access_token === 'string' ? tokens.json.access_token : null;
    if (!accessToken) throw new LoginError(502, 'token_refused', 'The token endpoint did not accept the sign-in.');
    const info = await call(`${cfg.base}/as/userinfo`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    const claims = info.ok ? claimsFrom(info.json) : null;
    if (!claims) throw new LoginError(502, 'userinfo_failed', 'PingOne did not return who signed in.');
    // The access token has done its one job. It is not kept, returned or logged.
    return { state: 'signed_in', claims };
  }

  const stepPost = async (run, contentType, payload) => {
    const r = await call(`${cfg.base}/flows/${run.flowId}`, { method: 'POST', headers: { 'Content-Type': contentType, Accept: 'application/json', Cookie: cookieHeader(run.jar) }, body: JSON.stringify(payload) });
    run.jar = mergeCookies(run.jar, r.setCookies);
    return r;
  };
  const badCredentials = (json) => Array.isArray(json?.details) && json.details.some((d) => d?.code === 'INVALID_CREDENTIALS');

  return {
    // Opens a flow. The run (flow id, PKCE verifier, cookies) stays on the server; the page gets only view().
    async start() {
      const codes = pkcePair();
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');
      const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: cfg.scope, state, nonce, code_challenge: codes.challenge, code_challenge_method: 'S256', response_mode: 'pi.flow' });
      const opened = await call(`${cfg.base}/as/authorize?${q}`, { headers: { Accept: 'application/json' } });
      const flow = opened.json;
      if (!opened.ok || !FLOW_ID.test(String(flow?.id || ''))) throw new LoginError(502, 'piflow_not_opened', `PingOne did not open a pi.flow (HTTP ${opened.status}). The application must allow response mode pi.flow.`);
      const run = { flowId: flow.id, codes, state, nonce, jar: mergeCookies({}, opened.setCookies), status: statusName(flow.status), steps: 1, expiresAt: now() + RUN_TTL_MS };
      return { run, view: { state: CREDENTIAL_STATUSES.has(run.status) ? 'credentials_required' : 'stopped', ...flowView(flow) } };
    },

    // Posts the credentials and follows the flow to the end. -> { state: 'signed_in', claims } | { state: 'credentials_required', refused }
    async submit(run, { username, password } = {}) {
      if (!run?.flowId) throw new LoginError(409, 'no_run', 'Start the sign-in first.');
      if (run.expiresAt <= now()) throw new LoginError(409, 'run_expired', 'The sign-in expired after 5 minutes. Start again.');
      if (!CREDENTIAL_STATUSES.has(run.status)) throw new LoginError(409, 'wrong_status', `The sign-in is at ${run.status}, not waiting for a password.`);
      if (typeof username !== 'string' || !username || username.length > 256 || CONTROL.test(username)) throw new LoginError(400, 'bad_username', 'The username must be 1 to 256 characters.');
      if (typeof password !== 'string' || !password || password.length > 1024) throw new LoginError(400, 'bad_password', 'The password must be 1 to 1024 characters.');
      if (run.status === 'SIGN_ON_REQUIRED') {
        const lookup = await stepPost(run, USER_LOOKUP, { username });
        if (lookup.status === 404 || lookup.status === 410) throw new LoginError(409, 'flow_gone', 'PingOne no longer knows this sign-in. Start again.');
        if (!lookup.ok || !lookup.json) throw new LoginError(502, 'flow_failed', `PingOne did not accept the username (HTTP ${lookup.status}).`);
        run.status = statusName(lookup.json.status);
        if (!CREDENTIAL_STATUSES.has(run.status)) return advance(run, lookup.json);
      }
      const r = await stepPost(run, USERNAME_PASSWORD_CHECK, { username, password });
      if (!r.ok) {
        // A wrong password leaves the flow waiting: the page may try again. Anything else ends the run.
        if (r.status === 400 && badCredentials(r.json)) throw new LoginError(401, 'credentials_refused', 'PingOne refused the username or password.');
        if (r.status === 404 || r.status === 410) throw new LoginError(409, 'flow_gone', 'PingOne no longer knows this sign-in. Start again.');
        throw new LoginError(502, 'flow_failed', `PingOne did not accept the sign-in (HTTP ${r.status}).`);
      }
      if (!r.json) throw new LoginError(502, 'flow_failed', 'PingOne answered with something that is not a sign-in flow.');
      return advance(run, r.json);
    },
  };
}
