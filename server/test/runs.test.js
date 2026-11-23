import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLab, postJson } from './helpers.js';
import { assertTrace } from '../src/gatewayTrace.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import { TOOLS, DOORS, isPermitted } from '../src/doors.js';

const TP = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
let lab;
const run = async (path, body, headers) => { const r = await postJson(lab.base, path, body, headers); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
const discover = (door, extra = {}) => run('/api/discover', { door, ...extra });
const call = (door, tool, args, extra = {}) => run('/api/call', { door, tool, arguments: args ?? TOOLS.find((t) => t.name === tool)?.args ?? {}, ...extra });
const kinds = (r) => r.hops.map((h) => `${h.kind}:${h.verdict}`);

test('setup', async () => { lab = await startLab(); });

function assertHopsAreSound(r) {
  assert.deepEqual(r.hopProblems, [], `hops are valid demo-hop/1: ${r.hopProblems.join('; ')}`);
  assert.deepEqual(r.traceProblems, [], 'the gateway trace passes assertTrace');
  assert.deepEqual(assertTrace(r.trace), []);
  r.hops.forEach((h, i) => {
    assert.equal(h.n, i + 1, 'hops are numbered in order');
    assert.deepEqual(validateHop(h, null, { tokens: r.source === 'mock' ? 'raw' : 'redact' }).filter((p) => !/catalog/.test(p)), [], `hop ${h.n}`);
    assert.ok(['browser', 'lab', 'privilege', 'mcp', 'idp', 'hitl'].includes(h.from) && ['browser', 'lab', 'privilege', 'mcp', 'idp', 'hitl'].includes(h.to), `${h.from}->${h.to}`);
    assert.ok(['checked', 'observed', 'inferred'].includes(h.basis), `hop ${h.n} basis ${h.basis}`);
    if (h.verdict === 'skip') assert.equal(h.traceparent, undefined, 'a hop that did not run has no traceparent');
    else assert.match(h.traceparent, TP, `hop ${h.n} carries a W3C traceparent`);
  });
  const ran = r.hops.filter((h) => h.verdict !== 'skip');
  assert.equal(new Set(ran.map((h) => h.traceparent.split('-')[1])).size, 1, 'one trace id for the whole run');
  assert.equal(new Set(ran.map((h) => h.traceparent.split('-')[2])).size, ran.length, 'a new span id per hop');
  const firstSkip = r.hops.findIndex((h) => h.verdict === 'skip');
  if (firstSkip >= 0) assert.ok(r.hops.slice(firstSkip).every((h) => h.verdict === 'skip'), 'skipped hops come after every hop that ran');
  assert.equal(r.hops.some((h) => h.kind === 'verdict'), true);
}

test('lab-banking-full: Allowed, 18 tools listed, one ordered hop array through the actors', async () => {
  const r = await discover('lab-banking-full');
  assert.equal(r.source, 'mock');
  assert.equal(r.simulated, true);
  assert.equal(r.verdict.id, 'allowed');
  assert.equal(r.verdict.word, 'Allowed');
  assert.equal(r.tools.length, 18);
  assert.ok(r.tools.every((t) => t.permitted === undefined), 'a listed tool carries no permitted mark');
  assert.deepEqual(r.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.ok(r.tools.every((t) => t.description && typeof t.args === 'object'));
  assert.deepEqual(kinds(r), ['door-picked:ok', 'discover:ok', 'token-exchange:ok', 'gateway-check:ok', 'tools-list:ok', 'policy-check:ok', 'verdict:ok']);
  assert.deepEqual(r.hops.map((h) => `${h.from}>${h.to}`), ['browser>lab', 'lab>privilege', 'privilege>idp', 'privilege>idp', 'lab>privilege', 'privilege>privilege', 'lab>browser']);
  assertHopsAreSound(r);
  assert.equal(r.trace.source, 'mock');
  assert.ok(r.trace.decisions.length >= 3 && r.trace.decisions.every((d) => d.basis === 'checked'));
});

test('gateway-internal hops are labelled illustrative in Mock, carry a labelled mock token, and are the only hops that do', async () => {
  const r = await discover('lab-banking-full');
  const ill = r.hops.filter((h) => h.illustrative);
  assert.deepEqual(ill.map((h) => h.kind), ['token-exchange', 'gateway-check']);
  assert.ok(ill.every((h) => /^Illustrative:/.test(h.narrative) && /illustrative/.test(h.fact)));
  const token = ill[0].response.body.access_token;
  assert.match(token, /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, 'Mock shows its MOCK token raw (rule 4)');
  assert.equal(ill[0].response.body.mock, true);
  assert.equal(ill[1].request.body.token, token, 'introspection looks at the token that was issued');
  assert.equal(ill[1].response.body.active, true);
  assert.equal(ill[1].response.body.mock, true);
  assert.equal(r.hops.filter((h) => !h.illustrative && /Illustrative/.test(h.narrative)).length, 0);
});

test('lab-banking-limited: Allowed with only the 7 granted tools listed, like the real gateway', async () => {
  const r = await discover('lab-banking-limited');
  assert.equal(r.verdict.id, 'allowed');
  assert.equal(r.tools.length, 7);
  assert.deepEqual(r.tools.map((t) => t.name), ['list_entitlements', 'who_has_role', 'get_access_grants', 'get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions']);
  assert.ok(!r.tools.some((t) => t.name === 'open_ticket' || t.name.startsWith('sensitive_')), 'refused tools are not listed');
  assert.match(r.verdict.sentence, /listed 7 tools/);
  assertHopsAreSound(r);
});

test('lab-banking-blocked: Blocked by policy before any tool is listed; nothing after the refusal ran', async () => {
  const r = await discover('lab-banking-blocked');
  assert.equal(r.verdict.id, 'blocked');
  assert.equal(r.verdict.word, 'Blocked by policy');
  assert.equal(r.verdict.status, 403);
  assert.equal(r.tools, null);
  assert.match(r.verdict.sentence, /has no policy/);
  assert.deepEqual(kinds(r), ['door-picked:ok', 'discover:deny', 'policy-check:deny', 'verdict:ok', 'tools-list:skip']);
  assert.equal(r.hops.find((h) => h.kind === 'tools-list').note, 'not reached: the session could not be started');
  assert.equal(r.hops.filter((h) => h.illustrative).length, 0, 'no gateway-internal hops when the door refused');
  assertHopsAreSound(r);
  assert.equal(r.trace.response.status, 403);
});

test('a call outside the grant is Blocked by policy with a 403 and a tool-refused hop', async () => {
  for (const tool of TOOLS.filter((t) => !isPermitted(DOORS[1], t.name)).map((t) => t.name)) {
    const r = await call('lab-banking-limited', tool);
    assert.equal(r.verdict.id, 'blocked', tool);
    assert.equal(r.verdict.status, 403);
    assert.match(r.verdict.sentence, new RegExp(`${tool} is not in the grant for aidemo`));
    assert.ok(kinds(r).includes('tool-refused:deny'), tool);
    assert.equal(r.result, null);
    assertHopsAreSound(r);
  }
});

test('a call inside the grant is Allowed, labelled simulated, with the tool-dispatched hop', async () => {
  const r = await call('lab-banking-limited', 'get_investment_transactions');
  assert.equal(r.verdict.id, 'allowed');
  assert.match(r.verdict.sentence, /simulated backend returned a sample/);
  assert.deepEqual(kinds(r), ['door-picked:ok', 'discover:ok', 'token-exchange:ok', 'gateway-check:ok', 'tool-call:ok', 'policy-check:ok', 'tool-dispatched:ok', 'verdict:ok']);
  assert.equal(JSON.parse(r.result.text).simulated, true);
  assert.equal(r.hops.find((h) => h.kind === 'door-picked').request.body.tool, 'get_investment_transactions');
  assertHopsAreSound(r);
});

test('user mistakes are a Bad request, never an Upstream error: missing or empty required arguments, an unknown tool name', async () => {
  for (const door of ['lab-banking-full', 'lab-banking-limited']) {
    const missing = await call(door, 'who_has_role', {});
    const empty = await call(door, 'who_has_role', { role: '' });
    const unknown = await call(door, 'no_such_tool', {});
    for (const r of [missing, empty, unknown]) {
      assert.equal(r.verdict.id, 'bad-request', `${door}: ${r.tool}`);
      assert.equal(r.verdict.word, 'Bad request');
      assert.notEqual(r.verdict.id, 'upstream');
      assert.equal(r.verdict.status, 200);
      assert.match(r.verdict.detail, /Invalid params|Unknown tool/);
      assertHopsAreSound(r);
      assert.ok(!r.hops.some((h) => h.kind === 'tool-dispatched' && h.verdict === 'ok'), 'nothing ran at the backend');
    }
    assert.match(missing.verdict.detail, /missing role/);
  }
  // A real policy refusal and an upstream failure stay what they were.
  assert.equal((await call('lab-banking-limited', 'sensitive_tax_record')).verdict.id, 'blocked');
  assert.equal((await call('lab-banking-full', 'who_has_role', undefined, { scenario: 'upstream-error' })).verdict.id, 'upstream');
});

test('open_ticket on lab-banking-full is Held (simulated, body invented); on lab-banking-limited it is Blocked', async () => {
  const r = await call('lab-banking-full', 'open_ticket');
  assert.equal(r.verdict.id, 'held');
  assert.equal(r.verdict.word, 'Held');
  assert.match(r.verdict.sentence, /simulated and its body is invented/);
  assert.deepEqual(kinds(r).slice(-3), ['policy-check:held', 'tool-held:held', 'verdict:ok']);
  assert.equal(r.hops.find((h) => h.kind === 'tool-held').to, 'hitl');
  assert.match(r.hops.find((h) => h.kind === 'tool-held').narrative, /SIMULATED.*invented/);
  assert.equal(r.result, null, 'a held call has no result');
  assertHopsAreSound(r);
  assert.equal((await call('lab-banking-limited', 'open_ticket')).verdict.id, 'blocked');
});

test('scenario upstream-error: the long simulated message is shown to its last sentence, not cut at 300 characters', async () => {
  const r = await call('lab-banking-full', 'who_has_role', { role: 'x' }, { scenario: 'upstream-error' });
  assert.equal(r.verdict.id, 'upstream');
  assert.match(r.verdict.detail, /Request id mock-502\./, 'the end of the simulated message is there');
  assert.ok(!/shortened/.test(r.verdict.detail));
});

test('scenario upstream-error: the failed hops are verdict error (fact "502 failed"), never deny; a refusal keeps deny', async () => {
  const d = await discover('lab-banking-full', { scenario: 'upstream-error' });
  const failedDiscover = d.hops.find((h) => h.verdict === 'error');
  assert.ok(failedDiscover, 'a failed hop is error');
  assert.equal(failedDiscover.fact, '502 failed');
  assert.ok(!d.hops.some((h) => h.verdict === 'deny'), 'a failure is never a refusal');
  assert.deepEqual(d.hopProblems, []);
  const c = await call('lab-banking-full', 'who_has_role', { role: 'x' }, { scenario: 'upstream-error' });
  assert.ok(kinds(c).includes('tool-call:error'), kinds(c).join());
  assert.ok(kinds(c).includes('tool-dispatched:error'), kinds(c).join());
  assert.equal(c.hops.find((h) => h.kind === 'tool-call').fact, '502 failed');
  assert.equal(c.hops.find((h) => h.kind === 'tool-dispatched').fact, 'backend failed, nothing returned');
  assert.ok(!c.hops.some((h) => h.verdict === 'deny'));
  assert.deepEqual(c.hopProblems, []);
  // a refusal (403) and a key that was not accepted (401) stay deny, and say refused / not accepted
  const refused = await call('lab-banking-limited', 'sensitive_tax_record');
  assert.ok(!refused.hops.some((h) => h.verdict === 'error'));
  assert.equal(refused.hops.find((h) => h.kind === 'tool-refused').verdict, 'deny');
  const noKey = await discover('lab-banking-full', { scenario: 'no-key' });
  assert.equal(noKey.hops.find((h) => h.kind === 'discover').verdict, 'deny');
  assert.equal(noKey.hops.find((h) => h.kind === 'discover').fact, '401 not accepted');
});

test('scenario upstream-error: Upstream error (502), JSON detail, not a policy decision, never a hang', async () => {
  for (const [path, body] of [['/api/discover', { door: 'lab-banking-full', scenario: 'upstream-error' }], ['/api/call', { door: 'lab-banking-full', tool: 'who_has_role', arguments: { role: 'x' }, scenario: 'upstream-error' }]]) {
    const r = await run(path, body);
    assert.equal(r.verdict.id, 'upstream');
    assert.equal(r.verdict.word, 'Upstream error');
    assert.equal(r.verdict.status, 502);
    assert.match(r.verdict.detail, /SIMULATED upstream failure/);
    assert.match(r.verdict.sentence, /not a policy decision/);
    assertHopsAreSound(r);
  }
  // one-shot and scoped: the next plain run is fine
  assert.equal((await discover('lab-banking-full')).verdict.id, 'allowed');
  const noFault = await call('lab-banking-limited', 'sensitive_holdings', { account_id: 'x' }, { scenario: 'upstream-error' });
  assert.equal(noFault.verdict.id, 'blocked', 'a refused call never reaches the backend, so the fault is not consumed as a 502');
  assert.equal((await call('lab-banking-full', 'who_has_role', { role: 'x' })).verdict.id, 'allowed', 'and it does not linger');
});

test('scenarios no-key and bad-key: Needs sign-in (401), the handshake stops, no gateway-internal hops', async () => {
  for (const scenario of ['no-key', 'bad-key']) {
    for (const [path, body] of [['/api/discover', { door: 'lab-banking-full' }], ['/api/call', { door: 'lab-banking-full', tool: 'who_has_role', arguments: { role: 'x' } }]]) {
      const r = await run(path, { ...body, scenario });
      assert.equal(r.verdict.id, 'needs-sign-in', `${scenario} ${path}`);
      assert.equal(r.verdict.word, 'Needs sign-in');
      assert.equal(r.verdict.status, 401);
      assert.match(r.verdict.sentence, scenario === 'no-key' ? /carried no agent key/ : /agent key was not accepted/);
      assert.equal(r.hops.filter((h) => h.illustrative).length, 0);
      assert.equal(r.hops.find((h) => h.kind === 'discover').response.headers['www-authenticate'].startsWith('Bearer realm='), true);
      assertHopsAreSound(r);
    }
  }
  const noKeyReq = (await run('/api/discover', { door: 'lab-banking-full', scenario: 'no-key' })).trace.request;
  assert.equal(noKeyReq.headers.authorization, undefined, 'no-key really sends no Authorization header');
});

test('scenario identity-mismatch is Mock-only, labelled simulated, and the decision stays for the gateway identity', async () => {
  const r = await discover('lab-banking-blocked', { scenario: 'identity-mismatch' });
  assert.equal(r.verdict.id, 'blocked');
  assert.equal(r.identity.label, 'Identity the gateway evaluated');
  assert.equal(r.identity.name, 'aidemo');
  assert.equal(r.identity.mismatch, true);
  assert.equal(r.identity.pageLogin.name, 'demouser');
  assert.match(r.identity.mismatchNote, /^SIMULATED/);
  assert.equal((await discover('lab-banking-blocked')).identity.mismatch, undefined, 'the plain run has no mismatch');
});

test('the mock agent key never appears in a Mock response (it stays on the server)', async () => {
  const keys = DOORS.map((d) => lab.lab.mockGateway.keyFor(d.id));
  const out = JSON.stringify([await discover('lab-banking-full'), await call('lab-banking-full', 'who_has_role'), await discover('lab-banking-blocked'), await (await fetch(`${lab.base}/api/info`)).json(), await (await fetch(`${lab.base}/api/runs`)).json()]);
  for (const k of keys) assert.ok(!out.includes(k), 'a mock key leaked');
  assert.match(out, /Bearer <agent key, \d+ characters, kept on the server>/);
});

test('an incoming traceparent continues its trace', async () => {
  const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const r = await run('/api/discover', { door: 'lab-banking-full' }, { traceparent: incoming });
  assert.ok(r.hops.filter((h) => h.verdict !== 'skip').every((h) => h.traceparent.split('-')[1] === '4bf92f3577b34da6a3ce929d0e0e4736'));
  assert.equal(r.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
});

test('runs and reset: the run log lists verdicts newest first, and Reset clears state but keeps the mode', async () => {
  await discover('lab-banking-full');
  await call('lab-banking-limited', 'sensitive_holdings');
  const runs = (await (await fetch(`${lab.base}/api/runs`)).json()).runs;
  assert.ok(runs.length >= 2);
  assert.deepEqual([runs[0].action, runs[0].door, runs[0].verdict.id], ['call', 'lab-banking-limited', 'blocked']);
  assert.ok(runs.length <= 20);
  lab.lab.mockGateway.armFault('lab-banking-full', 'tools/list');
  const reset = await (await postJson(lab.base, '/api/reset', {})).json();
  assert.equal(reset.ok, true);
  assert.equal(reset.mode, 'mock');
  assert.deepEqual((await (await fetch(`${lab.base}/api/runs`)).json()).runs, []);
  assert.equal((await discover('lab-banking-full')).verdict.id, 'allowed', 'Reset cleared the armed fault');
  assert.equal(lab.lab.guard.stats().blocked, 0);
});

test('the run log is bounded at 20', async () => {
  for (let i = 0; i < 25; i += 1) await discover('lab-banking-blocked');
  assert.equal((await (await fetch(`${lab.base}/api/runs`)).json()).runs.length, 20);
});

test('teardown', async () => { await lab.close(); });
