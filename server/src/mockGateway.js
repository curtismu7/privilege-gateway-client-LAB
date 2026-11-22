// An in-process stand-in for a Privilege MCP gateway. It opens no socket: netguard hands a request for the mock origin to
// handle(), which returns a fetch Response. Everything it returns is SIMULATED and says so (`_meta.simulated`, the `server`
// header). How a real gateway words a refusal, a held call or a filtered tool list is UNVERIFIED; this is the lab's own
// invented shape, labelled as such. Tokens are signed with a key made at start-up and are valid nowhere else.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DOORS, TOOLS, isPermitted, whyNotPermitted } from './doors.js';

export const MOCK_ORIGIN = 'https://mock-gateway.invalid';
export const MOCK_SERVER = 'mock-privilege-gateway (simulated)';
export const PROTOCOL_VERSION = '2025-06-18';
const MAX_BODY = 64 * 1024;
const PATH = /^\/([a-z0-9][a-z0-9-]{0,62})\/mcp$/;
export const UPSTREAM_MESSAGE = 'SIMULATED upstream failure: upstream connect error or disconnect/reset before headers. reset reason: connection termination: 502 Bad Gateway from api.backend.example:8443 after 30000 ms (attempt 3 of 3). The TLS handshake never completed, so no tool was called. This is a connection problem on the gateway side, not a policy decision. Request id mock-502.';
export const HELD_NOTE = 'SIMULATED hold. The shape of this body is invented by the lab: no real gateway capture of a held call exists yet.';

const b64u = (v) => Buffer.from(v).toString('base64url');
const decision = (id, label, outcome, evidence) => ({ id, label, outcome, evidence });

export function createMockGateway({ doors = DOORS, tools = TOOLS, keys = {}, now = () => Date.now() } = {}) {
  const signingKey = randomBytes(32);
  const doorMap = new Map(doors.map((d) => [d.id, d]));
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  // A mock agent key per door, made at start-up (labelled mock, never a real credential).
  const keyOf = new Map(doors.map((d) => [d.id, keys[d.id] ?? `mock-agent-key-${d.id}-${randomBytes(6).toString('hex')}`]));
  const sessions = new Map(); // session id -> door id
  let fault = null; // { door, method } one-shot simulated upstream failure
  const stats = { requests: 0 };

  function sign(payload) {
    const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'mock-ephemeral' }));
    const body = b64u(JSON.stringify(payload));
    return `${head}.${body}.${createHmac('sha256', signingKey).update(`${head}.${body}`).digest('base64url')}`;
  }
  // A MOCK access token, for the lab's illustrative gateway-internal hops. Labelled in its claims.
  function issueToken({ door, sub, scope = 'tools', ttlSeconds = 3600 }) {
    const iat = Math.floor(now() / 1000);
    return sign({ iss: MOCK_ORIGIN, sub, aud: `${MOCK_ORIGIN}/${door}/mcp`, scope, iat, exp: iat + ttlSeconds, jti: randomBytes(8).toString('hex'), mock: true, note: 'MOCK token signed with a per-process random key; valid nowhere else' });
  }
  function verifyToken(token) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return null;
    const expected = createHmac('sha256', signingKey).update(`${parts[0]}.${parts[1]}`).digest();
    let given;
    try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); return p.exp * 1000 < now() ? null : p; } catch { return null; }
  }

  const reply = (status, body, headers = {}, decisions) => {
    const h = { 'content-type': 'application/json', server: MOCK_SERVER, ...headers };
    if (decisions) h['x-mock-decisions'] = b64u(JSON.stringify(decisions));
    return new Response(status === 202 || status === 204 ? null : JSON.stringify(body), { status, headers: h });
  };
  const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  const SIM = { simulated: true };

  function toolEntry(door, t) {
    const ok = isPermitted(door, t.name);
    const properties = Object.fromEntries(Object.entries(t.args).map(([k, v]) => [k, { type: typeof v === 'number' ? 'number' : 'string' }]));
    return { name: t.name, description: t.description, inputSchema: { type: 'object', properties, required: [...t.required] }, _meta: { simulated: true, permitted: ok, ...(ok ? {} : { reason: whyNotPermitted(t) }) } };
  }

  function bearerOf(headers) {
    const raw = headers.get('authorization');
    const m = /^Bearer (\S+)$/.exec(raw ?? '');
    return m ? m[1] : null;
  }
  function keyOk(doorId, presented) {
    const want = Buffer.from(keyOf.get(doorId));
    const got = Buffer.from(String(presented ?? ''));
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async function handle(url, init = {}) {
    stats.requests += 1;
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const m = PATH.exec(url.pathname);
    if (!m || !doorMap.has(m[1])) return reply(404, { error: 'unknown_door', message: 'No such door on the mock gateway.', _meta: SIM });
    const doorId = m[1];
    const door = doorMap.get(doorId);
    if (method === 'GET') return reply(405, { error: 'method_not_allowed', message: 'This door has no server-initiated stream: use POST.', _meta: SIM }, { allow: 'POST, DELETE' });
    if (method !== 'POST' && method !== 'DELETE') return reply(405, { error: 'method_not_allowed', message: 'Use POST.', _meta: SIM }, { allow: 'POST, DELETE' });

    // 1. The agent key.
    const presented = bearerOf(headers);
    if (!keyOk(doorId, presented)) {
      const none = presented === null;
      return reply(401, { error: 'unauthorized', message: none ? 'No agent key was sent.' : 'The agent key was not accepted.', _meta: SIM },
        { 'www-authenticate': `Bearer realm="${MOCK_ORIGIN}/${doorId}/mcp"${none ? '' : ', error="invalid_token"'}` },
        [decision('authenticated', 'Agent key', 'fail', none ? 'no key was sent' : 'the key does not match the one this door accepts'), decision('grant', 'Grant', 'skipped', 'not reached: the caller was not accepted')]);
    }
    const authOk = decision('authenticated', 'Agent key', 'pass', 'the key matches the one this door accepts');

    // 2. The door's policy: demo-blocked has none, so every caller is refused, before anything is listed.
    if (door.grant === null) {
      return reply(403, { error: 'forbidden', message: `Door ${doorId} has no policy, so every caller is refused.`, _meta: SIM }, {},
        [authOk, decision('door-policy', 'Door has a policy', 'fail', 'no policy is attached to this door'), decision('grant', 'Grant', 'skipped', 'not reached: there is no policy to read a grant from')]);
    }
    const policyOk = decision('door-policy', 'Door has a policy', 'pass', `policy ${door.policy} is attached`);

    if (method === 'DELETE') {
      const sid = headers.get('mcp-session-id');
      return sessions.delete(sid) ? reply(204, null) : reply(404, rpcErr(null, -32001, 'Session not found'));
    }

    // 3. The body.
    const text = typeof init.body === 'string' ? init.body : init.body == null ? '' : Buffer.from(init.body).toString('utf8');
    if (Buffer.byteLength(text) > MAX_BODY) return reply(413, { error: 'payload_too_large', message: `The mock gateway reads at most ${MAX_BODY} bytes.`, _meta: SIM });
    let msg;
    try { msg = JSON.parse(text); } catch { return reply(400, rpcErr(null, -32700, 'Parse error')); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return reply(400, rpcErr(msg?.id, -32600, 'Invalid Request'));
    const id = msg.id;
    const isNotification = id === undefined;

    if (msg.method === 'initialize') {
      const sid = `mock-session-${randomBytes(9).toString('hex')}`;
      sessions.set(sid, doorId);
      return reply(200, { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: MOCK_SERVER, version: '0.1.0' }, _meta: SIM } },
        { 'mcp-session-id': sid }, [authOk, policyOk]);
    }

    // 4. A session, for everything else.
    const sid = headers.get('mcp-session-id');
    if (!sid) return reply(400, rpcErr(id, -32600, 'Missing mcp-session-id: send initialize first'));
    if (sessions.get(sid) !== doorId) return reply(404, rpcErr(id, -32001, 'Session not found'));
    if (msg.method === 'notifications/initialized') return reply(202, null);
    if (isNotification) return reply(202, null);

    if (msg.method === 'tools/list') {
      if (fault?.door === doorId && fault.method === 'tools/list') { fault = null; return upstreamFailure([authOk, policyOk]); }
      return reply(200, { jsonrpc: '2.0', id, result: { tools: tools.map((t) => toolEntry(door, t)), _meta: SIM } }, {},
        [authOk, policyOk, decision('grant', 'Grant', 'pass', `the grant of policy ${door.policy} allows ${tools.filter((t) => isPermitted(door, t.name)).length} of ${tools.length} tools`)]);
    }

    if (msg.method === 'tools/call') return toolsCall({ door, doorId, id, params: msg.params, authOk, policyOk });
    return reply(200, rpcErr(id, -32601, `Method not found: ${String(msg.method).slice(0, 80)}`));
  }

  function upstreamFailure(prior) {
    return reply(502, { error: 'bad_gateway', message: UPSTREAM_MESSAGE, _meta: SIM }, {},
      [...prior, decision('upstream', 'Backend answered', 'fail', 'the backend did not answer (simulated)')]);
  }

  function toolsCall({ door, doorId, id, params, authOk, policyOk }) {
    const name = params?.name;
    if (typeof name !== 'string' || name.length > 64) return reply(200, rpcErr(id, -32602, 'Invalid params: name must be a short string'), {}, [authOk, policyOk]);
    const t = toolMap.get(name);
    if (!t) return reply(200, rpcErr(id, -32602, 'Unknown tool'), {}, [authOk, policyOk, decision('grant', 'Tool in the grant', 'skipped', 'the gateway does not know this tool')]);
    if (!isPermitted(door, name)) {
      return reply(403, { error: 'forbidden', message: `Tool ${name} is not in the grant for door ${doorId}.`, _meta: SIM }, {},
        [authOk, policyOk, decision('grant', 'Tool in the grant', 'fail', `${name} is outside the grant of policy ${door.policy}`)]);
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(200, rpcErr(id, -32602, 'Invalid params: arguments must be an object'), {}, [authOk, policyOk]);
    const missing = t.required.filter((k) => args[k] === undefined || args[k] === '');
    if (missing.length) return reply(200, rpcErr(id, -32602, `Invalid params: missing ${missing.join(', ')}`), {}, [authOk, policyOk]);
    const granted = decision('grant', 'Tool in the grant', 'pass', `${name} is in the grant of policy ${door.policy}`);
    if (t.hitl && door.grant === 'all') {
      return reply(200, { jsonrpc: '2.0', id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ status: 'confirmation_required', policy: t.hitl, message: 'SIMULATED: a person must approve this action before it runs.', note: HELD_NOTE }) }], _meta: { simulated: true, held: true, inventedBody: true } } }, {},
        [authOk, policyOk, granted, decision('obligation', 'Approval needed', 'info', `policy ${t.hitl} holds this tool until a person approves it`)]);
    }
    if (fault?.door === doorId && fault.method === 'tools/call') { fault = null; return upstreamFailure([authOk, policyOk, granted]); }
    const out = { simulated: true, tool: name, note: 'SIMULATED: invented sample data, not a real result.', data: t.sample };
    return reply(200, { jsonrpc: '2.0', id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify(out) }], _meta: SIM } }, {},
      [authOk, policyOk, granted, decision('upstream', 'Backend answered', 'pass', 'the simulated backend returned a sample')]);
  }

  return {
    origin: MOCK_ORIGIN,
    handles: (url) => url.origin === MOCK_ORIGIN,
    handle,
    issueToken, verifyToken,
    keyFor: (doorId) => keyOf.get(doorId) ?? null,
    armFault: (doorId, method) => { fault = { door: doorId, method }; },
    clearFault: () => { fault = null; },
    dropSessions: () => sessions.clear(),
    sessionCount: () => sessions.size,
    reset: () => { sessions.clear(); fault = null; },
    stats: () => ({ ...stats }),
    doors: () => doors.map((d) => d.id),
  };
}

export function decodeDecisions(headerValue) {
  if (!headerValue) return null;
  try { return JSON.parse(Buffer.from(headerValue, 'base64url').toString('utf8')); } catch { return null; }
}
