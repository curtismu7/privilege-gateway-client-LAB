import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createLab } from '../src/lab.js';
import { PROPOSED_KINDS } from '../src/hops.js';

const vendored = new URL('../src/vendor/hop-catalog.json', import.meta.url);
const patchFile = new URL('../../docs/upstream/hop-catalog.patch', import.meta.url);

// The proposed catalog additions are a ready-to-apply patch against the canonical file (which this lab vendors byte for byte).
function applyPatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgc-patch-'));
  fs.mkdirSync(path.join(dir, 'shared/hop-detail'), { recursive: true });
  const target = path.join(dir, 'shared/hop-detail/hop-catalog.json');
  fs.copyFileSync(vendored, target);
  execFileSync('git', ['apply', '--check', patchFile.pathname], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['apply', patchFile.pathname], { cwd: dir, stdio: 'pipe' });
  const merged = JSON.parse(fs.readFileSync(target, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return merged;
}

test('hop-catalog.patch applies cleanly to the vendored catalog and only adds the proposed kinds', () => {
  const before = JSON.parse(fs.readFileSync(vendored, 'utf8'));
  const after = applyPatch();
  const added = Object.keys(after.kinds).filter((k) => !(k in before.kinds));
  assert.deepEqual(added.sort(), Object.keys(PROPOSED_KINDS).sort());
  for (const k of Object.keys(before.kinds)) assert.deepEqual(after.kinds[k], before.kinds[k], `existing kind ${k} is untouched`);
  for (const k of added) {
    const s = after.kinds[k].spec;
    assert.ok(after.kinds[k].title && after.kinds[k].fact, k);
    assert.ok(s.none ? s.why && s.failure : s.mandate && s.why && s.failure && s.refs.length && s.refs.every((r) => /^https:\/\//.test(r.url)), k);
  }
  assert.doesNotMatch(JSON.stringify(after.kinds[added[0]]), /ping-sandbox|pingone\.com|bxf/i);
});

test('with the proposed kinds merged, every run uses them and still validates; without them, the nearest existing kind is used', async () => {
  const merged = applyPatch();
  const vend = JSON.parse(fs.readFileSync(vendored, 'utf8'));
  const run = async (catalog) => {
    const lab = createLab({ env: {}, catalog });
    return Promise.all([lab.discover({ door: 'demo-all-tools' }), lab.call({ door: 'demo-all-tools', tool: 'open_ticket', args: { title: 'x' } }), lab.discover({ door: 'demo-blocked' })]);
  };
  for (const r of await run(merged)) {
    assert.deepEqual(r.hopProblems, []);
    const kinds = r.hops.map((h) => h.kind);
    assert.ok(kinds.includes('door-picked') && kinds.includes('verdict'), kinds.join());
    assert.ok(kinds.includes('discover'));
    assert.ok(!kinds.includes('website') && !kinds.includes('agent-reply'));
    assert.equal(r.hops.find((h) => h.kind === 'door-picked').title, 'Door picked');
  }
  for (const r of await run(vend)) {
    assert.deepEqual(r.hopProblems, []);
    const kinds = r.hops.map((h) => h.kind);
    assert.ok(kinds.includes('website') && kinds.includes('agent-reply'), kinds.join());
    assert.ok(r.hops.every((h) => typeof h.fact === 'string' && h.fact && !/cookie only|answer shown in the chat/.test(h.fact)), 'a fallback kind never lends its fact to a reel frame');
  }
});
