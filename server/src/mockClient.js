// The Mock transport: an MCP-over-HTTP client with the same interface as the shared gateway-real client (ensure, rpc, info,
// close, and the same wire capture), but every request goes through netguard's guardedFetch, which serves the mock origin
// in-process. The shared client calls the global fetch and cannot be given another, so Mock needs its own: this one is the
// reason Mock never touches a socket. It reuses the shared hop's own header redaction and error type, so a Mock capture and
// a Real capture have the same shape.
import { PROTOCOL_VERSION, rpcError, wireRequestHeaders, wireResponseHeaders, sseMessages } from './gatewayReal.js';
import { decodeDecisions } from './mockGateway.js';

const parsedOrText = (raw) => { try { return JSON.parse(raw); } catch { return raw; } };

// noKey: send no Authorization header at all (the Mock "no key" scenario).
export function createMockClientFactory({ fetch: doFetch, noKey = false }) {
  return function createClient({ url, getAuth, clientInfo = { name: 'privilege-gateway-client-lab', version: '0.1.0' }, onWire }) {
    const state = { sessionId: null, protocolVersion: null, initialized: false, pending: null, info: null };
    let msgId = 0;

    async function post(method, params, id) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      const auth = noKey ? null : getAuth?.();
      if (auth) headers[auth[0]] = auth[1];
      if (state.sessionId) headers['Mcp-Session-Id'] = state.sessionId;
      if (method !== 'initialize') headers['MCP-Protocol-Version'] = state.protocolVersion || PROTOCOL_VERSION;
      const envelope = id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
      const rec = onWire ? { http: 'POST', url, rpcMethod: method, request: { headers: wireRequestHeaders(headers, auth?.[0]), body: envelope }, response: null, at: new Date().toISOString() } : null;
      const started = Date.now();
      try {
        let res;
        try { res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(envelope) }); } catch (err) {
          throw rpcError(`MCP HTTP request blocked or unreachable (${err?.code || 'error'})`, 'mcp_unreachable');
        }
        if (rec) {
          rec.response = { status: res.status, headers: wireResponseHeaders(res.headers), body: null };
          rec.mock = { decisions: decodeDecisions(res.headers.get('x-mock-decisions')) };
        }
        const text = await res.text().catch(() => '');
        if (!res.ok) {
          if (rec) rec.response.body = text ? parsedOrText(text) : null;
          throw rpcError(`MCP HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`, 'mcp_http_error', { httpStatus: res.status });
        }
        const sid = res.headers.get('mcp-session-id');
        if (sid) state.sessionId = sid;
        let json;
        if (id !== undefined && text.trim()) {
          if (/text\/event-stream/i.test(res.headers.get('content-type') || '')) { const m = sseMessages(text); json = m.find((x) => x?.id === id) ?? m.at(-1); }
          else { try { json = JSON.parse(text); } catch { throw rpcError('reply is not JSON', 'mcp_bad_reply'); } }
        }
        if (rec) rec.response.body = json ?? null;
        if (json?.error) throw rpcError(json.error.message || 'MCP JSON-RPC error', 'mcp_rpc_error', { mcpCode: json.error.code });
        return json?.result;
      } catch (err) {
        if (rec && !rec.response) rec.error = String(err?.message || 'failed').slice(0, 300);
        throw err;
      } finally {
        if (rec) { rec.ms = Date.now() - started; try { onWire(rec); } catch { /* a capture hook never breaks the call */ } }
      }
    }

    async function handshake() {
      const result = await post('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo }, ++msgId);
      state.protocolVersion = result?.protocolVersion || PROTOCOL_VERSION;
      state.info = { protocolVersion: state.protocolVersion, serverInfo: result?.serverInfo || null, capabilities: result?.capabilities || {} };
      await post('notifications/initialized', {});
      state.initialized = true;
    }
    const ensure = () => {
      if (state.initialized) return Promise.resolve();
      state.pending ||= handshake().finally(() => { state.pending = null; });
      return state.pending;
    };

    return {
      ensure,
      async rpc(method, params = {}) {
        await ensure();
        try { return await post(method, params, ++msgId); } catch (err) {
          // "Session not found" mid-session: start a new session once, as the MCP spec says.
          if (err.httpStatus === 404 && state.sessionId) {
            state.initialized = false; state.sessionId = null;
            await ensure();
            return post(method, params, ++msgId);
          }
          throw err;
        }
      },
      info: () => state.info,
      async close() {
        if (!state.sessionId) return;
        const headers = { 'Mcp-Session-Id': state.sessionId };
        const auth = noKey ? null : getAuth?.();
        if (auth) headers[auth[0]] = auth[1];
        const rec = onWire ? { http: 'DELETE', url, rpcMethod: 'session close', request: { headers: wireRequestHeaders(headers, auth?.[0]), body: null }, response: null, at: new Date().toISOString() } : null;
        const started = Date.now();
        const res = await doFetch(url, { method: 'DELETE', headers }).catch(() => null);
        if (rec) { rec.response = res ? { status: res.status, headers: wireResponseHeaders(res.headers), body: null } : null; if (!res) rec.error = 'no answer'; rec.ms = Date.now() - started; try { onWire(rec); } catch { /* ignore */ } }
        state.sessionId = null; state.initialized = false;
      },
    };
  };
}
