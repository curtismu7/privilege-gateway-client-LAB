import { createApp, startHttpServer } from '../src/app.js';

// Start the app on an ephemeral loopback port. The returned base URL uses 127.0.0.1, which the Host check allows.
export async function startLab({ env = {}, fetchImpl } = {}) {
  const { app, health, lab } = createApp({ env: { ...env }, ...(fetchImpl ? { fetchImpl } : {}) });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, url, lab, close: () => { health.stop(); return new Promise((r) => server.close(r)); } };
}

// A raw HTTP request with a chosen Host header (fetch forbids setting Host).
import http from 'node:http';
export function rawRequest(base, { method = 'GET', path = '/', headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---- Mock gateway helpers -------------------------------------------------------------------------------------------------
import { MOCK_ORIGIN } from '../src/mockGateway.js';

// One JSON-RPC POST straight at an in-process mock gateway, as a raw client would send it. Returns { status, headers, json, text }.
export async function mockPost(gw, door, { key, session, body, headers = {}, raw } = {}) {
  const h = { 'content-type': 'application/json', accept: 'application/json', ...headers };
  if (key !== undefined && key !== null) h.authorization = `Bearer ${key}`;
  if (session) h['mcp-session-id'] = session;
  const res = await gw.handle(new URL(`${MOCK_ORIGIN}/${door}/mcp`), { method: 'POST', headers: h, body: raw ?? JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

// initialize + notifications/initialized; returns the session id.
export async function openSession(gw, door) {
  const key = gw.keyFor(door);
  const init = await mockPost(gw, door, { key, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } } });
  const session = init.headers.get('mcp-session-id');
  await mockPost(gw, door, { key, session, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  return session;
}

// A loopback HTTP server that plays "the real gateway" for the Real-mode tests: it serves a separate mock gateway instance
// that accepts the given test keys. Options: echoKey (a 403 that echoes the Authorization header back in its body: the
// hostile case for key scrubbing), fail (answer every POST with that status).
import { createMockGateway } from '../src/mockGateway.js';
// callReply: { status, json } answers every tools/call with that body (a gateway that denies with 200, or a tool that errors); sessions and tools/list stay normal.
export async function startStubGateway({ keys = {}, echoKey = false, fail = 0, failMessage = 'stub failed on purpose', callReply = null } = {}) {
  const gw = createMockGateway({ keys });
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      seen.push({ method: req.method, url: req.url });
      if (fail) { res.writeHead(fail, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'stub_failure', message: failMessage })); }
      const body = Buffer.concat(chunks).toString('utf8');
      if (echoKey && /"tools\/call"/.test(body)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'forbidden', message: `refused for ${req.headers.authorization}`, echo: { authorization: req.headers.authorization } }));
      }
      if (callReply && /"tools\/call"/.test(body)) {
        let id = 1; try { id = JSON.parse(body).id ?? 1; } catch { /* keep 1 */ }
        res.writeHead(callReply.status ?? 200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id, ...callReply.json }));
      }
      const out = await gw.handle(new URL(`${MOCK_ORIGIN}${req.url}`), { method: req.method, headers: req.headers, body });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, gw, seen, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// Environment for a Real-configured lab pointed at a stub: one key per door, all test values.
export const TEST_KEYS = { 'demo-all-tools': 'TESTONLY-all-tools-0001-abcdef', 'demo-some-tools': 'TESTONLY-some-tools-0002-abcdef', 'demo-blocked': 'TESTONLY-blocked-0003-abcdef' };
export const realEnv = (origin, extra = {}) => ({
  PGC_GW_URL: origin, PGC_GW_APPS: 'demo-all-tools,demo-some-tools,demo-blocked',
  PGC_GW_KEY_DEMO_ALL_TOOLS: TEST_KEYS['demo-all-tools'], PGC_GW_KEY_DEMO_SOME_TOOLS: TEST_KEYS['demo-some-tools'], PGC_GW_KEY_DEMO_BLOCKED: TEST_KEYS['demo-blocked'],
  ...extra,
});

export const postJson = (base, path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
