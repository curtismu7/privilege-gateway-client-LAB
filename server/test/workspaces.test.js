import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaces, workspaceFrom, validWorkspace, WorkspaceError, DEFAULT_WORKSPACE, MAX_WORKSPACES } from '../src/workspaces.js';
import { startLab, startStubGateway, realEnv, TEST_KEYS, postJson } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pgc-ws-'));
const ws = (base, id) => ({ 'x-workspace': id, origin: base });
const call = (base, id, body) => postJson(base, '/api/call', body, ws(base, id));
const SOME = { door: 'demo-some-tools', tool: 'get_investment_balance', arguments: { account_id: 'inv_5520' } };

test('workspace ids: the default, a valid id, and every malformed one is refused (never silently the default)', () => {
  assert.equal(workspaceFrom({ headers: {} }), DEFAULT_WORKSPACE);
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'team-1' } }), 'team-1');
  for (const bad of ['', 'Team', 'a b', '-lead', 'a/b', '..', 'x'.repeat(33), '__proto__', 'a\nb']) {
    assert.throws(() => workspaceFrom({ headers: { 'x-workspace': bad } }), WorkspaceError, JSON.stringify(bad));
    assert.equal(validWorkspace(bad), false);
  }
});

test('the number of workspaces is capped, and the 21st is a named 429', () => {
  const w = createWorkspaces({});
  for (let i = 0; i < MAX_WORKSPACES; i += 1) w.get(`w${i}`);
  assert.throws(() => w.get('one-too-many'), (e) => e instanceof WorkspaceError && e.status === 429 && e.code === 'too_many_workspaces');
  assert.equal(w.get('w0').id, 'w0', 'an existing workspace still answers');
});

test('the cap never locks the default workspace out, and Reset frees a slot', () => {
  const w = createWorkspaces({});
  for (let i = 0; i < MAX_WORKSPACES; i += 1) w.get(`w${i}`);
  assert.throws(() => w.get('one-too-many'), WorkspaceError);
  // The default workspace is always admitted, even when 20 others filled the cap first.
  assert.equal(w.get(DEFAULT_WORKSPACE).id, DEFAULT_WORKSPACE);
  w.get(DEFAULT_WORKSPACE).runs.push({ id: 'r1' });
  // Resetting a workspace gives its slot back: a new id fits again, and the reset one starts empty.
  w.get('w3').runs.push({ id: 'r2' });
  w.reset('w3');
  assert.deepEqual(w.ids().includes('w3'), false, 'the reset workspace no longer holds a slot');
  assert.deepEqual(w.get('w3').runs, [], 'a reset workspace comes back empty');
  assert.throws(() => w.get('fresh-one'), WorkspaceError, 'the cap is 20 others, and w3 took its slot back');
  w.reset('w4');
  assert.equal(w.get('fresh-one').id, 'fresh-one', 'a slot freed by Reset fits a new id');
  // Resetting a workspace that was never created (the cap is full) is fine: nothing to clear, and it does not take a slot.
  const full = createWorkspaces({});
  for (let i = 0; i < MAX_WORKSPACES; i += 1) full.get(`x${i}`);
  assert.doesNotThrow(() => full.reset('never-seen'));
  assert.equal(full.ids().length, MAX_WORKSPACES);
  assert.equal(w.ids().length, MAX_WORKSPACES + 1, 'the default workspace sits beside the 20');
});

test('over the HTTP API: with 20 other workspaces in use, the default workspace still answers and its Reset works', async () => {
  const lab = await startLab();
  try {
    for (let i = 0; i < MAX_WORKSPACES; i += 1) await call(lab.base, `w${i}`, SOME);
    const full = await postJson(lab.base, '/api/call', SOME, { origin: lab.base });
    assert.equal(full.status, 200, 'the default workspace is not locked out');
    const over = await call(lab.base, 'one-too-many', SOME);
    assert.equal(over.status, 429);
    const r = await postJson(lab.base, '/api/reset', {}, ws(lab.base, 'w5'));
    assert.equal(r.status, 200);
    assert.equal((await call(lab.base, 'one-too-many', SOME)).status, 200, 'Reset freed a slot');
  } finally { await lab.close(); }
});

test('runs are kept per workspace: one visitor never sees another\'s history', async () => {
  const lab = await startLab();
  try {
    await call(lab.base, 'team-a', SOME);
    await call(lab.base, 'team-a', SOME);
    await call(lab.base, 'team-b', { ...SOME, tool: 'sensitive_payroll_details', arguments: { employee_id: 'emp_2209' } });
    const get = async (id) => (await (await fetch(`${lab.base}/api/runs`, { headers: { 'x-workspace': id } })).json());
    assert.equal((await get('team-a')).runs.length, 2);
    const b = await get('team-b');
    assert.equal(b.runs.length, 1);
    assert.equal(b.runs[0].verdict.id, 'blocked');
    assert.equal((await get('default')).runs.length, 0);
    assert.equal((await get('team-a')).workspace, 'team-a');
  } finally { await lab.close(); }
});

test('Reset clears one workspace and leaves the others alone', async () => {
  const lab = await startLab();
  try {
    await call(lab.base, 'team-a', SOME);
    await call(lab.base, 'team-b', SOME);
    const r = await postJson(lab.base, '/api/reset', {}, ws(lab.base, 'team-a'));
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.workspace, 'team-a');
    assert.match(r.headers.get('set-cookie'), /^pgc_session_team-a=; .*Max-Age=0/, 'Reset signs this workspace out');
    const runs = async (id) => (await (await fetch(`${lab.base}/api/runs`, { headers: { 'x-workspace': id } })).json()).runs.length;
    assert.equal(await runs('team-a'), 0);
    assert.equal(await runs('team-b'), 1);
  } finally { await lab.close(); }
});

test('a bad X-Workspace header is a JSON 400 on every API route, and a hostile one never reaches a path', async () => {
  const lab = await startLab();
  try {
    for (const route of ['/api/runs', '/api/info', '/api/session', '/api/trace']) {
      const r = await fetch(`${lab.base}${route}`, { headers: { 'x-workspace': '../etc' } });
      assert.equal(r.status, 400, route);
      assert.equal((await r.json()).error, 'bad_workspace');
    }
    assert.equal((await fetch(`${lab.base}/api/health`)).status, 200, 'health has no workspace');
  } finally { await lab.close(); }
});

test('the trace sink is per workspace, in memory without a data directory and writes nothing to disk', async () => {
  const dir = tmp();
  const cwd = process.cwd();
  process.chdir(dir);
  const lab = await startLab();
  try {
    await call(lab.base, 'team-a', SOME);
    const a = await (await fetch(`${lab.base}/api/trace`, { headers: { 'x-workspace': 'team-a' } })).json();
    assert.equal(a.entries.length, 1);
    assert.equal(a.entries[0].workspace, 'team-a');
    assert.ok(a.entries[0].hops.length >= 5);
    assert.ok(a.entries[0].hops.every((h) => h.skipped || /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(h.traceparent)), 'every hop that ran carries a traceparent');
    assert.equal((await (await fetch(`${lab.base}/api/trace`, { headers: { 'x-workspace': 'team-b' } })).json()).entries.length, 0);
    assert.deepEqual(fs.readdirSync(dir), [], 'no data directory configured: nothing is written');
  } finally { await lab.close(); process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with PGC_DATA_DIR each workspace has its own directory, the sink file holds no key, and Reset removes it', async () => {
  const dir = tmp();
  const stub = await startStubGateway({ keys: TEST_KEYS });
  const lab = await startLab({ env: { ...realEnv(stub.origin, { MODE: 'real' }), PGC_DATA_DIR: dir } });
  try {
    const r = await call(lab.base, 'team-a', { door: 'demo-all-tools', tool: 'list_entitlements', arguments: { user: 'aidemo' } });
    assert.equal(r.status, 200);
    const fileA = path.join(dir, 'team-a', 'trace.jsonl');
    assert.ok(fs.existsSync(fileA));
    assert.equal(fs.existsSync(path.join(dir, 'team-b')), false);
    const text = fs.readFileSync(fileA, 'utf8');
    assert.equal(text.trim().split('\n').length, 1);
    for (const key of Object.values(TEST_KEYS)) assert.equal(text.includes(key), false, 'an agent key reached the sink file');
    assert.equal((fs.statSync(fileA).mode & 0o077), 0, 'the sink file is private to the owner');
    await postJson(lab.base, '/api/reset', {}, ws(lab.base, 'team-a'));
    assert.equal(fs.existsSync(path.join(dir, 'team-a')), false, 'Reset removed the workspace directory');
  } finally { await lab.close(); await stub.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a data directory that cannot be written does not break a run', async () => {
  const dir = tmp();
  const blocker = path.join(dir, 'file');
  fs.writeFileSync(blocker, 'x');
  const lab = await startLab({ env: { PGC_DATA_DIR: path.join(blocker, 'nested') } });
  try {
    const r = await call(lab.base, 'team-a', SOME);
    assert.equal(r.status, 200);
    assert.equal((await (await fetch(`${lab.base}/api/trace`, { headers: { 'x-workspace': 'team-a' } })).json()).entries.length, 1, 'the in-memory sink still has it');
  } finally { await lab.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
