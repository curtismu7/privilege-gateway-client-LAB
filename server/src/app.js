// One Express app: loopback Host check, same-origin writes, bounded JSON bodies, /api (health, shelf, info, mode, discover,
// call, runs, reset), and the built web app. Every failure on /api is JSON, never an HTML error page (rule 23).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { mountShelfRoute } from './shelfLink.js';
import { allPassed } from './doctor.js';
import { runChecks } from './checks.js';
import { APP_ID, APP_NAME } from './config.js';
import { createLab, LabError } from './lab.js';
import { readSettings } from './settings.js';
import { loadCustomerConfig, publicConfig, castForVertical } from './customer.js';
import { buildStories } from './stories.js';
import { buildTalkTrack } from './talkTrack.js';
import { VERTICALS } from './cast.js';
import { workspaceFrom, WorkspaceError } from './workspaces.js';
import { PERSONAS, personaById } from './auth/personas.js';
import { createSessions } from './auth/session.js';
import { mockRequestRefusal } from './auth/guards.js';
import { createPingOneLogin, LoginError } from './auth/pingoneLogin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The page's Content-Security-Policy. The Vite build is one external module script and one external stylesheet, loaded from this origin (also behind the
// shared lab-proxy, which serves the same paths); the API is fetched from this origin. Scripts: this origin only (no inline, no eval, no CDN). Styles:
// this origin plus inline, because React sets style attributes and the pop-out window copies inline <style>. img/font data: is the lock icon mask.
// Nothing may frame the page (the lab-proxy fetches it server-side and needs no framing).
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

export function createApp({ webDist = WEB_DIST, env = process.env, fetchImpl = globalThis.fetch, customer = loadCustomerConfig({ env }), lab = createLab({ env, version }), health = createHealth({ demoId: APP_ID, demoName: APP_NAME, version, runChecks: () => runChecks(env), allPassed }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP }); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));
  api.use((req, _res, next) => { req.workspaceId = workspaceFrom(req); next(); });
  const settings = readSettings(env);
  const sessions = createSessions({ secret: settings.sessionSecret, ttlMs: settings.sessionTtlMs });
  const loginRuns = new Map(); // workspace -> the pi.flow run waiting for credentials (server side only)
  const auth = { settings, sessions, loginRuns, fetchImpl };
  // Who is signed in to this workspace, if anyone. A Mock persona counts only in Mock and a Real page login only in Real.
  api.use((req, _res, next) => {
    req.me = meOf(req, lab, auth);
    req.pageLogin = req.me?.source === 'mock-persona' ? { name: req.me.name, email: req.me.email } : null;
    next();
  });
  api.use('/health', health.router);
  mountLabRoutes(api, lab, { settings, customer, auth });
  mountAuthRoutes(api, lab, auth);
  // Only SHELF_URL is passed on: the shared shelf helper would otherwise fall back to a settings file outside this repo (rule: per-lab .env only).
  mountShelfRoute(api, { env: { SHELF_URL: env.SHELF_URL } });
  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'no such API route' }));
  app.use('/api', api);

  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(webDist, 'index.html')) : next()));
  }
  // A thrown error is JSON, never an HTML error page (rule 23).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof LabError || err instanceof WorkspaceError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) });
    const status = err?.status >= 400 && err?.status < 600 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'bad_request', message: status === 500 ? 'internal error' : 'request could not be read' });
  });
  return { app, health, lab };
}

export function startHttpServer({ port, host, app }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host.includes(':') ? `[${host}]` : host}:${port}/` }));
    server.once('error', reject);
  });
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const noStore = (res) => res.set('Cache-Control', 'no-store');

const clearCookie = (sessions, workspace) => sessions.cookie('', 0, workspace);

function mountLabRoutes(api, lab, { settings, customer, auth }) {
  api.get('/info', (_req, res) => { noStore(res); res.json(lab.info()); });
  api.get('/runs', (req, res) => { noStore(res); res.json({ workspace: req.workspaceId, runs: lab.runs(req.workspaceId) }); });
  api.get('/trace', (req, res) => { noStore(res); res.json({ workspace: req.workspaceId, entries: lab.trace(req.workspaceId) }); });
  // Rule 12 and 3: branding and vocabulary from customer.config, the presenter flag, the workspace in use.
  api.get('/config', (req, res) => { noStore(res); res.json({ workspace: req.workspaceId, presenter: settings.presenter, customer: publicConfig(customer) }); });
  // Rule 10: stories and the talk track, written once with {{cast}} tokens, filled with the active cast.
  // ?vertical=retail|health|finance picks a pack; absent = the configured one. Anything else is a named 400, never a silent default.
  const pack = (req) => {
    const p = castForVertical(customer, req.query.vertical);
    if (!p) throw new LabError(400, 'bad_vertical', `vertical must be one of ${Object.keys(VERTICALS).join(', ')}`);
    return p;
  };
  api.get('/stories', (req, res) => { const p = pack(req); noStore(res); res.json({ vertical: p.vertical, stories: buildStories(p.cast) }); });
  api.get('/talk-track', (req, res) => { const p = pack(req); noStore(res); res.json({ vertical: p.vertical, sections: buildTalkTrack(p.cast) }); });

  // Rule 19: exactly {source: "mock"|"real"}; Real not configured is a 409 with the how-to, never a silent Mock.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!isObject(body) || Object.keys(body).length !== 1 || typeof body.source !== 'string') throw new LabError(400, 'bad_request', 'send exactly {"source": "mock"} or {"source": "real"}');
    const r = lab.mode.set(body.source);
    noStore(res);
    if (!r.ok) return res.status(r.status).json({ error: r.error, message: r.message });
    res.json(lab.info());
  });

  api.post('/discover', async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    noStore(res);
    res.json(await lab.discover({ door: b.door, scenario: b.scenario }, { traceparent: req.headers.traceparent, workspace: req.workspaceId, pageLogin: req.pageLogin ?? null }));
  });
  api.post('/call', async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    noStore(res);
    res.json(await lab.call({ door: b.door, scenario: b.scenario, tool: b.tool ?? undefined, args: b.arguments }, { traceparent: req.headers.traceparent, workspace: req.workspaceId, pageLogin: req.pageLogin ?? null }));
  });
  api.post('/reset', (req, res) => { noStore(res); res.set('set-cookie', clearCookie(auth.sessions, req.workspaceId)); auth.loginRuns.delete(req.workspaceId); res.json(lab.reset(req.workspaceId)); });
}

// ---- sign-in (rule 11 and 16) -------------------------------------------------------------------------------------------------
// Mock: a persona picker behind hard guards (IDP=mock AND ALLOW_MOCK_SIGNIN=1; loopback listener, local connection, no proxy header,
// Mock mode). The routes are not mounted at all without the settings. Real: the pi.flow page login, nothing else.
function meOf(req, lab, { settings, sessions }) {
  const s = sessions.read(req.headers.cookie, req.workspaceId);
  if (!s) return null;
  const source = lab.mode.get();
  if (s.persona) {
    const p = personaById(s.persona);
    if (source !== 'mock' || !p) return null;
    return { source: 'mock-persona', id: p.id, name: p.name, email: p.email, role: p.role, expiresAt: new Date(s.expiresAt).toISOString() };
  }
  if (source !== 'real') return null;
  return { source: 'real-login', sub: s.claims.sub, name: s.claims.name ?? null, username: s.claims.username ?? null, email: s.claims.email ?? null };
}

function mountAuthRoutes(api, lab, auth) {
  const { settings, sessions, loginRuns, fetchImpl } = auth;
  const mockRefusal = (req) => mockRequestRefusal(req, settings, lab.mode.get());
  const maxAge = Math.floor(settings.sessionTtlMs / 1000);

  api.get('/auth/config', (req, res) => {
    noStore(res);
    res.json({
      workspace: req.workspaceId, source: lab.mode.get(), idp: settings.idp || null,
      mock: { enabled: settings.mockSignin, available: settings.mockSignin && !mockRefusal(req), refusal: settings.mockSignin ? mockRefusal(req) : 'disabled' },
      real: { flow: 'pi.flow', configured: lab.login.ok, problems: lab.login.problems },
    });
  });
  // "Nobody is signed in" is a normal 200 with me: null, so the browser console stays clean.
  api.get('/session', (req, res) => { noStore(res); res.json({ me: req.me }); });
  api.post('/auth/logout', (req, res) => { noStore(res); loginRuns.delete(req.workspaceId); res.set('set-cookie', clearCookie(sessions, req.workspaceId)); res.json({ ok: true }); });

  if (settings.mockSignin) {
    const guard = (req, res, next) => {
      const why = mockRefusal(req);
      return why ? res.status(403).json({ error: 'mock_signin_refused', reason: why }) : next();
    };
    api.get('/auth/mock/personas', guard, (_req, res) => {
      noStore(res);
      res.json({ personas: Object.values(PERSONAS).map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role })) });
    });
    api.post('/auth/mock/login', guard, (req, res) => {
      const p = personaById(req.body?.persona);
      if (!p) return res.status(404).json({ error: 'not_found', message: 'no such persona' });
      res.set('set-cookie', sessions.cookie(sessions.issuePersona(p.id, req.workspaceId), maxAge, req.workspaceId));
      noStore(res);
      res.json({ ok: true, me: { source: 'mock-persona', id: p.id, name: p.name, email: p.email, role: p.role, expiresAt: new Date(Date.now() + settings.sessionTtlMs).toISOString() } });
    });
  }

  // Real page login (pi.flow). Real mode only, and only when the lab's own settings name the environment and the client.
  let login = null;
  const loginApi = () => { login ??= createPingOneLogin({ cfg: lab.login, fetchImpl, guard: lab.guard }); return login; };
  const liveOk = (res) => {
    if (lab.mode.get() !== 'real') { res.status(403).json({ error: 'real_only', message: 'The pi.flow page login runs in Real. In Mock, use the persona picker.' }); return false; }
    if (!lab.login.ok) { res.status(409).json({ error: 'login_not_configured', message: `Page login is not configured: ${lab.login.problems.join('; ')}. Set them in this lab's own .env (see .env.example), then restart.` }); return false; }
    return true;
  };
  api.post('/auth/live/start', async (req, res) => {
    noStore(res);
    if (!liveOk(res)) return;
    const { run, view } = await loginApi().start();
    loginRuns.set(req.workspaceId, run);
    res.json({ ok: true, ...view });
  });
  api.post('/auth/live/credentials', async (req, res) => {
    noStore(res);
    if (!liveOk(res)) return;
    const run = loginRuns.get(req.workspaceId);
    try {
      const out = await loginApi().submit(run, { username: req.body?.username, password: req.body?.password });
      if (out.state !== 'signed_in') return res.status(200).json({ ok: false, ...out });
      loginRuns.delete(req.workspaceId);
      res.set('set-cookie', sessions.cookie(sessions.issueClaims(out.claims, req.workspaceId), maxAge, req.workspaceId));
      return res.json({ ok: true, me: { source: 'real-login', sub: out.claims.sub, name: out.claims.name ?? null, username: out.claims.username ?? null, email: out.claims.email ?? null } });
    } catch (e) {
      // A wrong password or a malformed field leaves the flow waiting; every other failure ends the run.
      if (!(e instanceof LoginError) || !['credentials_refused', 'bad_username', 'bad_password'].includes(e.code)) loginRuns.delete(req.workspaceId);
      throw e;
    }
  });
}
