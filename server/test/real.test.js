import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLab, postJson, startStubGateway, realEnv, TEST_KEYS } from './helpers.js';
import { assertTrace } from '../src/gatewayTrace.js';
import { mockPost } from './helpers.js';

// "The real gateway" in these tests is a loopback stub that accepts the TESTONLY keys. Nothing here touches a network.
const ALL = 'lab-banking-full';
let stub; let lab;
const start = async (stubOpts = {}, envExtra = {}, keyOverride = {}) => {
  stub = await startStubGateway({ keys: { ...TEST_KEYS, ...keyOverride }, ...stubOpts });
  lab = await startLab({ env: realEnv(stub.origin, envExtra) });
};
const stop = async () => { await lab?.close(); await stub?.close(); lab = null; stub = null; };
const run = async (path, body) => { const r = await postJson(lab.base, path, body); return { status: r.status, body: await r.json() }; };

test('Real discovery: Allowed on what the gateway answered (observed), with no permitted marks and no illustrative hops', async () => {
  await start();
  try {
    const { status, body: r } = await run('/api/discover', { door: ALL });
    assert.equal(status, 200);
    assert.equal(r.source, 'real');
    assert.equal(r.simulated, false);
    assert.equal(r.verdict.id, 'allowed');
    assert.equal(r.verdict.basis, 'inferred');
    assert.match(r.verdict.sentence, /answered HTTP 200 \(observed\) and listed 18 tools/);
    assert.equal(r.tools.length, 18);
    assert.ok(r.tools.every((t) => t.permitted === undefined), 'Real does not claim which tools are permitted');
    assert.ok(r.tools.every((t) => !('reason' in t)));
    assert.equal(r.identity.label, 'Identity declared by this lab\'s settings');
    assert.equal(r.identity.name, null);
    assert.deepEqual(r.hopProblems, []);
    assert.equal(r.hops.filter((h) => h.illustrative).length, 0, 'gateway-internal hops are omitted in Real');
    assert.ok(!r.hops.some((h) => h.kind === 'token-exchange' || h.kind === 'gateway-check'));
    assert.ok(r.hops.every((h) => h.mock === false));
    assert.ok(r.hops.every((h) => h.basis === 'observed' || h.basis === 'inferred'), 'Real hops are observed or inferred, never checked');
    const decision = r.hops.find((h) => h.kind === 'policy-check');
    assert.equal(decision.basis, 'inferred');
    assert.equal(decision.stages, undefined, 'no per-check detail is invented in Real');
    assert.equal(decision.decision, undefined);
    assert.match(decision.kv.find(([k]) => k === 'reading')[1], /^inferred:/);
    assert.ok(stub.seen.some((s) => s.method === 'POST' && s.url === `/${ALL}/mcp`));
  } finally { await stop(); }
});

test('Real traces say only observed or inferred, pass assertTrace, and never hold a full token', async () => {
  await start();
  try {
    for (const [path, body] of [['/api/discover', { door: ALL }], ['/api/discover', { door: 'lab-banking-blocked' }], ['/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } }], ['/api/call', { door: 'lab-banking-limited', tool: 'sensitive_holdings', arguments: { account_id: 'x' } }]]) {
      const { body: r } = await run(path, body);
      assert.equal(r.trace.source, 'real');
      assert.deepEqual(assertTrace(r.trace), [], `${path} ${JSON.stringify(body)}`);
      assert.ok(r.trace.decisions.length >= 1);
      assert.ok(r.trace.decisions.every((d) => d.basis === 'inferred' || d.basis === 'observed'), JSON.stringify(r.trace.decisions));
      assert.deepEqual(r.traceProblems, []);
      assert.deepEqual(r.hopProblems, []);
    }
  } finally { await stop(); }
});

test('Real verdicts: 403 at the door and 403 on a tool are Blocked by policy, said as inferred; a good call is Allowed', async () => {
  await start();
  try {
    const blocked = (await run('/api/discover', { door: 'lab-banking-blocked' })).body;
    assert.equal(blocked.verdict.id, 'blocked');
    assert.equal(blocked.verdict.status, 403);
    assert.equal(blocked.verdict.basis, 'inferred');
    assert.match(blocked.verdict.sentence, /answered 403 \(observed\).*inferred from that status/);
    assert.doesNotMatch(blocked.verdict.sentence, /no policy|simulated|checked/i, 'Real never asserts why the gateway refused');
    const tool = (await run('/api/call', { door: 'lab-banking-limited', tool: 'sensitive_tax_record', arguments: { taxpayer_id: 'x' } })).body;
    assert.equal(tool.verdict.id, 'blocked');
    assert.ok(tool.hops.some((h) => h.kind === 'tool-refused' && h.basis === 'inferred'));
    const ok = (await run('/api/call', { door: 'lab-banking-limited', tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(ok.verdict.id, 'allowed');
    assert.match(ok.verdict.sentence, /inferred from that answer/);
    assert.ok(ok.hops.some((h) => h.kind === 'tool-dispatched' && h.basis === 'inferred'));
    assert.equal(ok.result.isError, false);
  } finally { await stop(); }
});

test('Real: a wrong key is Needs sign-in (401, observed); the gateway\'s reply names no check and neither do we', async () => {
  await start({}, {}, { [ALL]: 'TESTONLY-a-different-key-than-the-labs' });
  try {
    for (const [path, body] of [['/api/discover', { door: ALL }], ['/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } }]]) {
      const r = (await run(path, body)).body;
      assert.equal(r.verdict.id, 'needs-sign-in');
      assert.equal(r.verdict.status, 401);
      assert.match(r.verdict.sentence, /answered 401 \(observed\).*does not say which check failed/);
      assert.deepEqual(r.hopProblems, []);
      assert.equal(r.hops.at(-2).verdict === 'skip' || r.hops.some((h) => h.verdict === 'skip'), true);
      const leg = r.hops.find((h) => h.kind === 'discover');
      assert.equal(leg.verdict, 'deny', 'a key that was not accepted is a refusal, not a failure');
      assert.equal(leg.fact, '401 not accepted');
      assert.ok(!r.hops.some((h) => h.verdict === 'error'));
    }
  } finally { await stop(); }
});

test('Real: an unreachable gateway is Upstream error as JSON, with the cause named, not a hang or an HTML page', async () => {
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((r) => dead.close(r));
  lab = await startLab({ env: realEnv(origin) });
  try {
    const t0 = Date.now();
    const res = await postJson(lab.base, '/api/discover', { door: ALL });
    assert.ok(Date.now() - t0 < 5000, 'refused connections answer quickly');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /json/);
    const r = await res.json();
    assert.equal(r.verdict.id, 'upstream');
    assert.equal(r.verdict.word, 'Upstream error');
    assert.match(r.verdict.detail, /unreachable|ECONNREFUSED/i);
    assert.match(r.verdict.sentence, /could not be reached/);
    assert.equal(r.trace.response, null);
    const noAnswer = r.hops.find((h) => h.kind === 'discover');
    assert.equal(noAnswer.verdict, 'error', 'no answer is a failure, not a refusal');
    assert.equal(noAnswer.fact, 'no answer');
    assert.ok(!r.hops.some((h) => h.verdict === 'deny'));
    assert.equal(r.trace.decisions[0].outcome, 'fail');
    assert.deepEqual(assertTrace(r.trace), []);
    assert.deepEqual(r.hopProblems, []);
  } finally { await lab.close(); lab = null; }
});

test('Real: an upstream 502 and 503 from the gateway are Upstream error, observed', async () => {
  for (const fail of [502, 503, 504]) {
    await start({ fail });
    try {
      const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
      assert.equal(r.verdict.id, 'upstream', String(fail));
      assert.equal(r.verdict.status, fail);
      assert.match(r.verdict.sentence, new RegExp(`answered HTTP ${fail} \\(observed\\)`));
      assert.equal(r.verdict.basis, 'observed');
      const leg = r.hops.find((h) => h.kind === 'discover');
      assert.equal(leg.verdict, 'error', `${fail} is a failed hop, not a refusal`);
      assert.equal(leg.fact, `${fail} failed`);
      assert.ok(!r.hops.some((h) => h.verdict === 'deny'), 'nothing was refused');
      assert.deepEqual(r.hopProblems, []);
    } finally { await stop(); }
  }
});

// N2 (fix pass): a long upstream message is shown whole inside the lab's cap, and a cut is always marked. The shared client keeps only the first
// 300 characters of an HTTP error body in its message; the lab reads the fuller text from the captured wire body.
const LONG_END = 'END-OF-THE-LONG-UPSTREAM-MESSAGE';
test('Real: a 700-character upstream message is shown in full in the verdict detail, with no silent cut', async () => {
  const message = `${'upstream said no. '.repeat(38)}${LONG_END}`;
  assert.ok(message.length > 600 && message.length < 1000);
  await start({ fail: 502, failMessage: message });
  try {
    const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(r.verdict.id, 'upstream');
    assert.ok(r.verdict.detail.includes(LONG_END), `the end of the message is there: ...${r.verdict.detail.slice(-60)}`);
    assert.ok(!/shortened/.test(r.verdict.detail), 'nothing was cut, so nothing says so');
  } finally { await stop(); }
});

test('Real: a message beyond the lab cap is cut visibly (ellipsis and the word shortened), never silently', async () => {
  await start({ fail: 502, failMessage: `${'x '.repeat(3000)}${LONG_END}` });
  try {
    const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(r.verdict.id, 'upstream');
    assert.ok(!r.verdict.detail.includes(LONG_END));
    assert.match(r.verdict.detail, /… \(shortened\)$/);
    assert.ok(r.verdict.detail.length <= 1100, 'bounded');
  } finally { await stop(); }
});

test('Real: a short upstream message is untouched', async () => {
  await start({ fail: 502, failMessage: 'stub failed on purpose' });
  try {
    const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.match(r.verdict.detail, /stub failed on purpose/);
    assert.ok(!/shortened/.test(r.verdict.detail));
  } finally { await stop(); }
});

test('Real: a long tool result (over the shared client\'s 800 characters) is shown in full, and one beyond the lab cap is cut visibly', async () => {
  const text = `${'result line. '.repeat(200)}${LONG_END}`;
  await start({ callReply: { status: 200, json: { result: { isError: false, content: [{ type: 'text', text }] } } } });
  try {
    const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(r.verdict.id, 'allowed');
    assert.equal(r.result.text, text, 'the whole result, not its first 800 characters');
  } finally { await stop(); }
  const huge = `${'z'.repeat(30000)}${LONG_END}`;
  await start({ callReply: { status: 200, json: { result: { isError: false, content: [{ type: 'text', text: huge }] } } } });
  try {
    const r = (await run('/api/call', { door: ALL, tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.ok(!r.result.text.includes(LONG_END));
    assert.match(r.result.text, /… \(shortened\)$/);
    assert.ok(r.result.text.length <= 20100);
  } finally { await stop(); }
});

test('Real: a door with no key is a 409 that names the setting; scenarios are refused; an unlisted door is 404', async () => {
  stub = await startStubGateway({ keys: TEST_KEYS });
  const env = realEnv(stub.origin);
  delete env.PGC_GW_KEY_LAB_BANKING_BLOCKED;
  lab = await startLab({ env });
  try {
    const info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.deepEqual(info.doors.map((d) => [d.id, d.keyed]), [[ALL, true], ['lab-banking-limited', true], ['lab-banking-blocked', false]]);
    const r = await postJson(lab.base, '/api/discover', { door: 'lab-banking-blocked' });
    assert.equal(r.status, 409, 'another door\'s key must never be sent to this door');
    const b = await r.json();
    assert.equal(b.error, 'no_key_for_door');
    assert.match(b.message, /PGC_GW_KEY_LAB_BANKING_BLOCKED/);
    assert.ok(!stub.seen.some((s) => s.url.includes('lab-banking-blocked')), 'nothing was sent to the keyless door');
    const sc = await postJson(lab.base, '/api/discover', { door: ALL, scenario: 'no-key' });
    assert.equal(sc.status, 400);
    assert.equal((await sc.json()).error, 'mock_only');
    assert.equal((await postJson(lab.base, '/api/discover', { door: 'demo-other' })).status, 404);
  } finally { await stop(); }
});

test('Real: an identity declared in settings is shown as declared; a hostile value is ignored', async () => {
  await start({}, { PGC_GW_IDENTITY: 'svc-agent@example.com' });
  try {
    const r = (await run('/api/discover', { door: ALL })).body;
    assert.equal(r.identity.name, 'svc-agent@example.com');
    assert.equal(r.identity.basis, 'declared');
  } finally { await stop(); }
  await start({}, { PGC_GW_IDENTITY: '<script>x</script>' });
  try { assert.equal((await run('/api/discover', { door: ALL })).body.identity.name, null); } finally { await stop(); }
});

test('Real: a switch to Mock and back keeps working, and the mock path stays offline', async () => {
  await start();
  try {
    assert.equal((await run('/api/discover', { door: ALL })).body.source, 'real');
    assert.equal((await run('/api/mode', { source: 'mock' })).status, 200);
    const seenBefore = stub.seen.length;
    const m = (await run('/api/discover', { door: ALL })).body;
    assert.equal(m.source, 'mock');
    assert.equal(stub.seen.length, seenBefore, 'Mock sent nothing to the configured gateway');
    assert.equal((await run('/api/mode', { source: 'real' })).status, 200);
    assert.equal((await run('/api/discover', { door: ALL })).body.source, 'real');
  } finally { await stop(); }
});

test('a Real key never appears in any response, trace, hop, log line or error, even when the gateway echoes it', async () => {
  const keys = Object.values(TEST_KEYS);
  const logged = [];
  const orig = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) { orig[m] = console[m]; console[m] = (...a) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }; }
  const captured = [];
  try {
    await start({ echoKey: true });
    const grab = async (path, body) => { const r = body === undefined ? await fetch(`${lab.base}${path}`) : await postJson(lab.base, path, body); const t = await r.text(); captured.push(t); return t; };
    for (const door of ['lab-banking-full', 'lab-banking-limited', 'lab-banking-blocked']) {
      await grab('/api/discover', { door });
      for (const tool of ['who_has_role', 'sensitive_holdings', 'open_ticket']) await grab('/api/call', { door, tool, arguments: { role: 'x', account_id: 'x', title: 'x' } });
    }
    await grab('/api/info'); await grab('/api/runs'); await grab('/api/health'); await grab('/api/reset', {}); await grab('/api/mode', { source: 'mock' }); await grab('/api/mode', { source: 'real' });
    await grab('/api/discover', { door: 'bad door' });
    // the hostile case really happened: the stub echoed the Authorization header into a 403 body
    assert.ok(stub.seen.length > 0);
    const combined = captured.join('\n');
    assert.match(combined, /\[?<redacted>|redacted/, 'the echoed key was scrubbed, not just absent');
    for (const k of keys) {
      assert.ok(!combined.includes(k), `a key reached a response: ${k.slice(0, 12)}...`);
      assert.ok(!logged.join('\n').includes(k), 'a key reached a log line');
      assert.ok(!combined.includes(Buffer.from(k).toString('base64')), 'a base64 form of a key reached a response');
    }
    assert.match(combined, /Bearer <agent key, \d+ characters, kept on the server>/);
  } finally {
    for (const m of Object.keys(orig)) console[m] = orig[m];
    await stop();
  }
});

test('hostile gateway replies stay data: HTML, a huge body, invalid JSON and a redirect never break the run', async () => {
  const evil = http.createServer((req, res) => {
    const mode = req.url.split('/')[1];
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (mode === 'lab-banking-full') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><script>alert(1)</script>not json</html>'); }
      if (mode === 'lab-banking-limited') { res.writeHead(302, { location: 'https://evil.example/steal' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(`{"jsonrpc":"2.0","id":1,"result":{"padding":"${'x'.repeat(5 * 1024 * 1024)}"}}`);
    });
  });
  await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  lab = await startLab({ env: realEnv(`http://127.0.0.1:${evil.address().port}`) });
  const realFetch = globalThis.fetch; const urls = [];
  globalThis.fetch = (u, ...a) => { urls.push(String(u)); return realFetch(u, ...a); };
  try {
    for (const door of ['lab-banking-full', 'lab-banking-limited', 'lab-banking-blocked']) {
      const res = await postJson(lab.base, '/api/discover', { door });
      assert.equal(res.status, 200, door);
      assert.match(res.headers.get('content-type'), /json/);
      const r = await res.json();
      assert.equal(r.verdict.id, 'upstream', `${door}: ${r.verdict.sentence}`);
      assert.deepEqual(r.hopProblems, [], door);
    }
    assert.ok(!urls.some((u) => u.includes('evil.example')), 'a redirect is never followed');
  } finally { globalThis.fetch = realFetch; await lab.close(); lab = null; await new Promise((r) => { evil.closeAllConnections?.(); evil.close(r); }); }
});

// A real gateway may deny a call with HTTP 200 and an MCP isError result, or with a JSON-RPC error. This lab cannot tell that from a tool that
// failed on its own, so Real must not say "the gateway allowed the call" (or "a protocol error, not a policy decision"). It reads no decision.
const DENY_SHAPES = [
  ['an isError tool result', { status: 200, json: { result: { isError: true, content: [{ type: 'text', text: 'Access denied by policy' }] } } }],
  ['a JSON-RPC error over HTTP 200', { status: 200, json: { error: { code: -32001, message: 'Access denied by policy' } } }],
];
for (const [name, callReply] of DENY_SHAPES) {
  test(`Real: ${name} on a call is Upstream error that reads no gateway decision, and no hop claims one`, async () => {
    await start({ callReply });
    try {
      const r = (await run('/api/call', { door: 'lab-banking-limited', tool: 'who_has_role', arguments: { role: 'x' } })).body;
      assert.equal(r.source, 'real');
      assert.equal(r.verdict.id, 'upstream');
      assert.equal(r.verdict.basis, 'inferred', 'nothing was reported by the gateway, so the reading is not observed');
      assert.doesNotMatch(r.verdict.sentence, /gateway allowed|not a policy decision/i, r.verdict.sentence);
      assert.match(r.verdict.sentence, /does not say whether .*refused.*no gateway decision is read/is);
      assert.match(r.verdict.detail, /Access denied by policy/);
      assert.doesNotMatch(r.verdict.next.join(' '), /is down/);
      const policy = r.hops.find((h) => h.kind === 'policy-check');
      assert.equal(policy.verdict, 'skip', 'no allow is inferred from the 200');
      assert.doesNotMatch(String(policy.fact), /inferred from 200/);
      assert.ok(!r.hops.some((h) => h.kind === 'tool-dispatched' && h.verdict !== 'skip'), 'the backend leg is not claimed either way');
      assert.ok(r.hops.every((h) => h.basis === 'observed' || h.basis === 'inferred'));
      assert.deepEqual(r.hopProblems, []);
    } finally { await stop(); }
  });
}

test('Real: an isError result on a call still shows the tool text as detail, and a good call after it is Allowed again', async () => {
  await start({ callReply: { status: 200, json: { result: { isError: true, content: [{ type: 'text', text: 'boom' }] } } } });
  try {
    const bad = (await run('/api/call', { door: 'lab-banking-limited', tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(bad.verdict.detail, 'boom');
    assert.equal(bad.result, null);
    const disc = (await run('/api/discover', { door: 'lab-banking-limited' })).body;
    assert.equal(disc.verdict.id, 'allowed');
  } finally { await stop(); }
});

test('Real never reports a held call: a body that looks like the Mock hold is just an answer (Allowed, inferred), not a Held verdict', async () => {
  await start({ callReply: { status: 200, json: { result: { isError: false, content: [{ type: 'text', text: '{}' }], _meta: { held: true } } } } });
  try {
    const r = (await run('/api/call', { door: 'lab-banking-limited', tool: 'who_has_role', arguments: { role: 'x' } })).body;
    assert.equal(r.verdict.id, 'allowed');
    assert.equal(r.verdict.basis, 'inferred');
    assert.ok(!r.hops.some((h) => h.kind === 'tool-held'));
  } finally { await stop(); }
});
