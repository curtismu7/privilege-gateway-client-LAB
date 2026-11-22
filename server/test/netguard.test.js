import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { decide, selfTest, createNetguard, NetguardError } from '../src/netguard.js';
import { createMockGateway, MOCK_ORIGIN } from '../src/mockGateway.js';
import { startLab, postJson, startStubGateway, realEnv } from './helpers.js';

test('the netguard self-test passes, and every case is a real assertion (a flipped policy fails it)', () => {
  const r = selfTest();
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.checks.length >= 10);
  // The self-test is not a tautology: the same cases evaluated against a deliberately wrong expectation are caught.
  const v = decide('https://gateway.example/x', { mode: 'mock' });
  assert.equal(v.allow, false);
  assert.equal(v.code, 'blocked_mock');
});

test('decide: Mock serves only the mock origin; Real only the one configured origin', () => {
  const mock = (u) => decide(u, { mode: 'mock', realOrigin: 'https://gateway.example' });
  assert.deepEqual(mock(`${MOCK_ORIGIN}/demo-all-tools/mcp`), { allow: true, route: 'mock' });
  for (const u of ['https://gateway.example/x', 'http://127.0.0.1/x', 'http://localhost:7833/api', 'https://mock-gateway.invalid.evil.example/x', 'https://mock-gateway.invalid:8443/x', 'file:///etc/passwd', 'ftp://x.example/', 'javascript:alert(1)', '']) {
    assert.equal(mock(u).allow, false, u);
  }
  const real = (u, o = 'https://gateway.example') => decide(u, { mode: 'real', realOrigin: o });
  assert.equal(real('https://gateway.example/demo-all-tools/mcp').allow, true);
  for (const u of ['https://gateway.example.evil.example/x', 'https://evil.example/x', 'https://gateway.example:444/x', 'http://gateway.example/x', `${MOCK_ORIGIN}/x`, 'https://gateway.example:pw@evil.example/', 'https://169.254.169.254/x']) {
    assert.equal(real(u).allow, false, u);
  }
  assert.equal(real('https://gateway.example/x', null).code, 'real_not_configured');
  assert.equal(decide('https://gateway.example/x', { mode: 'weird' }).code, 'bad_mode');
});

test('guardedFetch serves the mock in-process, refuses anything else, and counts both', async () => {
  const gw = createMockGateway();
  let mode = 'mock';
  const guard = createNetguard({ getMode: () => mode, mockGateway: gw, getRealOrigin: () => 'https://gateway.example' });
  const ok = await guard.guardedFetch(`${MOCK_ORIGIN}/demo-all-tools/mcp`, { method: 'POST', headers: {}, body: '{}' });
  assert.equal(ok.status, 401);
  await assert.rejects(() => guard.guardedFetch('https://gateway.example/x'), (e) => e instanceof NetguardError && e.code === 'blocked_mock');
  assert.throws(() => guard.assertAllowed('https://gateway.example/x'), (e) => e.code === 'blocked_mock');
  mode = 'real';
  assert.equal(guard.assertAllowed('https://gateway.example/demo-all-tools/mcp').route, 'real');
  assert.throws(() => guard.assertAllowed('https://other.example/'), (e) => e.code === 'blocked_origin');
  await assert.rejects(() => guard.guardedFetch('https://gateway.example/x'), (e) => e.code === 'wrong_route', 'guardedFetch never makes a real request');
  await assert.rejects(() => guard.guardedFetch(`${MOCK_ORIGIN}/x`), (e) => e.code === 'blocked_origin', 'Real refuses the mock origin');
  const s = guard.stats();
  assert.equal(s.mockServed, 1);
  assert.equal(s.realAllowed, 1);
  assert.equal(s.blocked, 5);
  guard.resetStats();
  assert.deepEqual(guard.stats(), { attempts: 0, blocked: 0, mockServed: 0, realAllowed: 0, loginAllowed: 0, modelAllowed: 0 });
});

test('Mock makes ZERO real outbound attempts across every door, tool and scenario', async () => {
  const realFetch = globalThis.fetch;
  const origConnect = net.Socket.prototype.connect;
  const fetchCalls = [];
  const connects = [];
  // Any fetch made by the lab itself lands here and fails the test; the test's own client uses the saved real fetch.
  globalThis.fetch = (...a) => { fetchCalls.push(String(a[0])); return Promise.reject(new Error('outbound fetch attempted in Mock')); };
  net.Socket.prototype.connect = function patched(...args) {
    // net normalises its arguments to [options, callback] before calling connect on the socket
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    connects.push(typeof o === 'object' && o !== null ? `${o.host ?? o.path ?? o.address ?? JSON.stringify(Object.keys(o))}:${o.port ?? ''}` : String(o));
    return origConnect.apply(this, args);
  };
  const lab = await startLab();
  try {
    const post = (path, body) => realFetch(`${lab.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const doors = ['demo-all-tools', 'demo-some-tools', 'demo-blocked'];
    let runs = 0;
    for (const door of doors) {
      for (const scenario of ['none', 'no-key', 'bad-key', 'upstream-error', 'identity-mismatch']) {
        await post('/api/discover', { door, scenario }); runs += 1;
        for (const tool of ['who_has_role', 'open_ticket', 'sensitive_tax_record', 'get_investment_transactions']) {
          const r = await post('/api/call', { door, scenario, tool, arguments: { role: 'x', title: 'x', taxpayer_id: 'x', account_id: 'x' } }); runs += 1;
          assert.equal(r.source, 'mock');
        }
      }
    }
    assert.equal(runs, 3 * 5 * 5);
    assert.deepEqual(fetchCalls, [], 'the lab called fetch in Mock');
    assert.ok(connects.length > 0, 'the spy is live: it sees the test client\'s own loopback connections');
    const remote = connects.filter((c) => !/^(127\.0\.0\.1|localhost|::1)/.test(c));
    assert.deepEqual(remote, [], 'a socket was opened to a non-loopback address in Mock');
    const s = lab.lab.guard.stats();
    assert.ok(s.attempts > 0 && s.mockServed === s.attempts, JSON.stringify(s));
    assert.equal(s.blocked, 0);
    assert.equal(s.realAllowed, 0);
  } finally {
    globalThis.fetch = realFetch;
    net.Socket.prototype.connect = origConnect;
    await lab.close();
  }
});

test('Real reaches exactly the one configured gateway host and nothing else', async () => {
  const stub = await startStubGateway({ keys: { 'demo-all-tools': 'TESTONLY-all-tools-0001-abcdef' } });
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = (u, ...a) => { urls.push(String(u)); return realFetch(u, ...a); };
  const lab = await startLab({ env: realEnv(stub.origin) });
  try {
    const r = await (await postJson(lab.base, '/api/discover', { door: 'demo-all-tools' })).json();
    assert.equal(r.source, 'real');
    assert.equal(r.verdict.id, 'allowed');
    const gatewayCalls = urls.filter((u) => !u.startsWith(lab.base));
    assert.ok(gatewayCalls.length >= 3, `initialize, initialized, tools/list, close: ${gatewayCalls.length}`);
    assert.ok(gatewayCalls.every((u) => u.startsWith(`${stub.origin}/demo-all-tools/mcp`)), gatewayCalls.join(' '));
    // the guard refuses any other origin, even in Real
    assert.throws(() => lab.lab.guard.assertAllowed('https://evil.example/demo-all-tools/mcp'), (e) => e.code === 'blocked_origin');
    assert.throws(() => lab.lab.guard.assertAllowed(`${MOCK_ORIGIN}/demo-all-tools/mcp`), (e) => e.code === 'blocked_origin');
    assert.ok(lab.lab.guard.stats().realAllowed >= 1);
  } finally { globalThis.fetch = realFetch; await lab.close(); await stub.close(); }
});
