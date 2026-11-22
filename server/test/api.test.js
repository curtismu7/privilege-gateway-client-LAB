import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLab, postJson, rawRequest, startStubGateway, realEnv } from './helpers.js';
import { TOOLS } from '../src/doors.js';

// Words that would name a settings file outside this lab (built from parts so this file does not name one itself).
const SHARED_FILE_WORDS = new RegExp(['Development', ['STANDALONE', 'ENV'].join('_'), '~/'].join('|'));
const json = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });

test('GET /api/info (Mock, nothing configured): source mock, realAvailable false, a how-to, the three doors and 18 tools', async () => {
  const lab = await startLab();
  try {
    const { status, body, headers } = await json(await fetch(`${lab.base}/api/info`));
    assert.equal(status, 200);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(body.source, 'mock');
    assert.equal(body.realAvailable, false);
    assert.match(body.realReason, /PGC_GW_URL.*PGC_GW_APPS.*PGC_GW_KEY_<NAME>.*\.env beside docker-compose\.yml/);
    assert.match(body.startNote, /Real is not configured, so this lab started in Mock/);
    assert.deepEqual(body.doors.map((d) => d.id), ['demo-all-tools', 'demo-some-tools', 'demo-blocked']);
    assert.ok(body.doors.every((d) => d.keyed === true && d.description));
    assert.equal(body.catalog.length, 18);
    assert.deepEqual(body.catalog.map((t) => t.name), TOOLS.map((t) => t.name));
    assert.equal(body.gateway.origin, 'https://mock-gateway.invalid');
    assert.equal(body.gateway.simulated, true);
    assert.equal(body.identity.label, 'Identity the gateway evaluated');
    assert.deepEqual(body.scenarios, ['none', 'no-key', 'bad-key', 'upstream-error', 'identity-mismatch']);
  } finally { await lab.close(); }
});

test('the wording for "Real is not configured" names this lab\'s own .env and never the shared settings file', async () => {
  for (const env of [{}, { PGC_GW_URL: 'not a url' }, { PGC_GW_URL: 'http://gateway.example' }, { PGC_GW_URL: 'https://gateway.example' }, { PGC_GW_URL: 'https://gateway.example', PGC_GW_APPS: 'demo-all-tools' }, { PGC_GW_URL: 'https://gateway.example', PGC_GW_APPS: 'Bad Name!', PGC_GW_KEY_X: 'k' }]) {
    const lab = await startLab({ env });
    try {
      const info = await (await fetch(`${lab.base}/api/info`)).json();
      assert.equal(info.realAvailable, false, JSON.stringify(Object.keys(env)));
      assert.doesNotMatch(info.realReason, SHARED_FILE_WORDS);
      assert.match(info.realReason, /\.env beside docker-compose\.yml/);
      const r = await postJson(lab.base, '/api/mode', { source: 'real' });
      const b = await r.json();
      assert.equal(r.status, 409);
      assert.equal(b.error, 'real_not_configured');
      assert.equal(b.message, info.realReason);
    } finally { await lab.close(); }
  }
});

test('POST /api/mode: both directions work, the toggle reloads info, and Real not configured is 409', async () => {
  const stub = await startStubGateway({ keys: {} });
  const lab = await startLab({ env: realEnv(stub.origin) });
  try {
    let info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(info.source, 'real', 'default is Real when it is configured');
    assert.equal(info.realAvailable, true);
    assert.equal(info.realReason, null);
    assert.deepEqual(info.scenarios, ['none'], 'scenarios are Mock-only');
    assert.equal(info.identity.label, 'Identity declared by this lab\'s settings');
    assert.equal(info.gateway.origin, stub.origin);
    let r = await json(await postJson(lab.base, '/api/mode', { source: 'mock' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'mock');
    assert.equal(r.body.gateway.simulated, true);
    assert.equal((await (await fetch(`${lab.base}/api/info`)).json()).source, 'mock', 'the switch is server state');
    r = await json(await postJson(lab.base, '/api/mode', { source: 'real' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'real');
    assert.equal(r.body.realAvailable, true);
    r = await json(await postJson(lab.base, '/api/mode', { source: 'real' }));
    assert.equal(r.status, 200, 'switching to the current mode is fine');
  } finally { await lab.close(); await stub.close(); }
});

test('POST /api/mode takes exactly {source:"mock"|"real"}: anything else is a 400 and changes nothing', async () => {
  const lab = await startLab();
  try {
    const bad = [{}, { source: 'live' }, { source: 'MOCK' }, { source: '' }, { source: 1 }, { source: null }, { source: ['mock'] }, { source: 'mock', confirm: true }, { mode: 'mock' }, [], 'mock', null, { source: 'mock', extra: 1 }, { __proto__: null, source: 'mock', x: 1 }];
    for (const body of bad) {
      const r = await postJson(lab.base, '/api/mode', JSON.stringify(body));
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok((await r.json()).error);
    }
    assert.equal((await postJson(lab.base, '/api/mode', '{"source": "mock"', {})).status, 400, 'malformed JSON');
    const noType = await fetch(`${lab.base}/api/mode`, { method: 'POST', body: 'source=mock' });
    assert.equal(noType.status, 400);
    assert.equal((await (await fetch(`${lab.base}/api/info`)).json()).source, 'mock');
    assert.equal((await postJson(lab.base, '/api/mode', { source: 'mock' })).status, 200);
  } finally { await lab.close(); }
});

test('MODE is honoured but never silently: MODE=real without Real configured starts in Mock and says why', async () => {
  const lab = await startLab({ env: { MODE: 'real' } });
  try {
    const info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(info.source, 'mock');
    assert.match(info.startNote, /MODE=real was asked for, but Real is not configured, so this lab started in Mock/);
    assert.equal(info.realWanted, true, 'the page can show Real was asked for but is unavailable (rule 26)');
  } finally { await lab.close(); }
  const stub = await startStubGateway();
  const labMock = await startLab({ env: realEnv(stub.origin, { MODE: 'mock' }) });
  try {
    const info = await (await fetch(`${labMock.base}/api/info`)).json();
    assert.equal(info.source, 'mock');
    assert.equal(info.realAvailable, true);
    assert.match(info.startNote, /MODE=mock/);
    assert.equal(info.realWanted, false);
  } finally { await labMock.close(); await stub.close(); }
  const labOdd = await startLab({ env: { MODE: 'sideways' } });
  try { assert.match((await (await fetch(`${labOdd.base}/api/info`)).json()).startNote, /was ignored/); } finally { await labOdd.close(); }
});

test('input is validated: unknown door, bad door and tool names, scenarios, arguments, missing tool', async () => {
  const lab = await startLab();
  try {
    const expect = async (path, body, status, error) => {
      const r = await postJson(lab.base, path, typeof body === 'string' ? body : JSON.stringify(body));
      const b = await r.json();
      assert.equal(r.status, status, `${path} ${JSON.stringify(body).slice(0, 80)} -> ${JSON.stringify(b)}`);
      assert.equal(b.error, error);
      assert.equal(typeof b.message, 'string');
    };
    await expect('/api/discover', {}, 404, 'unknown_door');
    await expect('/api/discover', { door: 'demo-nothing' }, 404, 'unknown_door');
    for (const door of ['../etc', 'DEMO-ALL-TOOLS', '__proto__', 'demo-all-tools/../x', ' demo-all-tools', 'a'.repeat(500), 7, null, ['demo-all-tools'], { x: 1 }]) await expect('/api/discover', { door }, 404, 'unknown_door');
    await expect('/api/discover', { door: 'demo-all-tools', scenario: 'chaos' }, 400, 'bad_scenario');
    await expect('/api/discover', { door: 'demo-all-tools', scenario: ['none'] }, 400, 'bad_scenario');
    await expect('/api/call', { door: 'demo-all-tools' }, 400, 'bad_tool');
    for (const tool of ['', 'a b', '<script>', '../x', 'a'.repeat(65), 7, {}, '\u0000x']) await expect('/api/call', { door: 'demo-all-tools', tool }, 400, 'bad_tool');
    await expect('/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: [1] }, 400, 'bad_arguments');
    await expect('/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: 'x' }, 400, 'bad_arguments');
    let deep = { role: 'x' }; for (let i = 0; i < 12; i += 1) deep = { n: deep };
    await expect('/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: deep }, 400, 'bad_arguments');
    await expect('/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: { role: 'x'.repeat(9000) } }, 400, 'bad_arguments');
    await expect('/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: { role: 'x'.repeat(20000) } }, 413, 'bad_request');
  } finally { await lab.close(); }
});

test('a very deep JSON body is bounded and answers JSON, never a stack overflow or HTML', async () => {
  const lab = await startLab();
  try {
    const deep = `${'{"a":'.repeat(3000)}1${'}'.repeat(3000)}`;
    const r = await postJson(lab.base, '/api/call', `{"door":"demo-all-tools","tool":"who_has_role","arguments":${deep}}`);
    assert.ok([400, 413].includes(r.status), String(r.status));
    assert.match(r.headers.get('content-type'), /json/);
    assert.ok((await r.json()).error);
  } finally { await lab.close(); }
});

test('a hostile argument value, tool description and door string stay data: the response is JSON and echoes nothing as markup', async () => {
  const lab = await startLab();
  try {
    const evil = '<img src=x onerror=alert(1)>"\'`${7*7}‮\u0000';
    const r = await (await postJson(lab.base, '/api/call', { door: 'demo-all-tools', tool: 'who_has_role', arguments: { role: evil } })).json();
    assert.equal(r.verdict.id, 'allowed');
    assert.equal(r.hops[0].request.body.arguments.role, evil, 'kept as a string for the UI to render inert');
    const res = await fetch(`${lab.base}/api/info`);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally { await lab.close(); }
});

test('Host check and same-origin writes cover the new routes', async () => {
  const lab = await startLab();
  try {
    const bad = await rawRequest(lab.base, { path: '/api/info', headers: { host: 'attacker.example' } });
    assert.equal(bad.status, 403);
    assert.equal(JSON.parse(bad.body).error, 'bad_host');
    for (const path of ['/api/mode', '/api/discover', '/api/call', '/api/reset']) {
      const cross = await postJson(lab.base, path, { source: 'real', door: 'demo-all-tools' }, { origin: 'https://attacker.example' });
      assert.equal(cross.status, 403, path);
      assert.equal((await cross.json()).error, 'cross_origin');
      const site = await postJson(lab.base, path, {}, { 'sec-fetch-site': 'cross-site' });
      assert.equal(site.status, 403, path);
    }
    assert.equal((await (await fetch(`${lab.base}/api/info`)).json()).source, 'mock', 'a refused cross-origin write changed nothing');
    const same = await postJson(lab.base, '/api/mode', { source: 'mock' }, { origin: lab.base });
    assert.equal(same.status, 200);
  } finally { await lab.close(); }
});

test('GET on a write route and an unknown API route are JSON 404s, never HTML', async () => {
  const lab = await startLab();
  try {
    for (const p of ['/api/mode', '/api/call', '/api/discover', '/api/reset', '/api/nope', '/api/runs/1']) {
      const r = await fetch(`${lab.base}${p}`);
      assert.equal(r.status, 404, p);
      assert.match(r.headers.get('content-type'), /json/);
    }
  } finally { await lab.close(); }
});

test('health reports the new doctor checks and stays demo-health/1', async () => {
  const lab = await startLab();
  try {
    const j = await (await fetch(`${lab.base}/api/health`)).json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    const { runChecks } = await import('../src/checks.js');
    const checks = runChecks({});
    for (const id of ['netguard', 'mock-gateway', 'real']) assert.ok(checks.some((c) => c.id === id), id);
    assert.equal(checks.find((c) => c.id === 'netguard').level, 'pass');
    assert.equal(checks.find((c) => c.id === 'mock-gateway').level, 'pass');
    assert.equal(checks.find((c) => c.id === 'real').level, 'info');
    assert.doesNotMatch(JSON.stringify(runChecks({ PGC_GW_URL: 'https://gateway.example', PGC_GW_APPS: 'demo-all-tools', PGC_GW_KEY_DEMO_ALL_TOOLS: 'SECRETVALUE1234' })), /SECRETVALUE1234|gateway\.example/);
  } finally { await lab.close(); }
});
