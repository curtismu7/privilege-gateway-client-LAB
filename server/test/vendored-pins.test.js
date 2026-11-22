// Every server file vendored from AI-DEMO-Standalone matches its pin file byte for byte (rules 14, 15, 24, 25). The canonical copy changes
// first; re-vendor with cp from origin/main and re-pin, never edit the copy here. One pin file per unit under src/pins/ (gateway-trace's
// one canonical pin lives beside its web files, because that is how the shared folder ships it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
const pins = (file) => readFileSync(join(root, file), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.trim().split(/\s+/));

const UNITS = [
  ['health', ['health.js']],
  ['doctor', ['doctor.js']],
  ['trace', ['trace.js']],
  ['shelf-link-server', ['shelfLink.js']],
  ['gateway-real', ['gatewayReal.js']],
  ['hop-detail', ['vendor/hop-catalog.json', 'vendor/hopDetail.mjs', 'vendor/hopDetail.test.mjs', 'vendor/README.md']],
];

// Problems with one unit under a repo root (an empty list means the pin file lists exactly the unit's files and every hash matches).
function unitProblems(base, unit, files) {
  const read = (p) => readFileSync(join(base, p));
  const hashOf = (p) => createHash('sha256').update(read(p)).digest('hex');
  const problems = [];
  const p = readFileSync(join(base, `server/src/pins/${unit}.sha256`), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.trim().split(/\s+/));
  if (JSON.stringify(p.map(([, f]) => f).sort()) !== JSON.stringify([...files].sort())) problems.push(`${unit}: pin file does not list exactly ${files.join(', ')}`);
  for (const [hash, file] of p) if (hashOf(`server/src/${file}`) !== hash) problems.push(`${file} differs from ${unit}.sha256`);
  return problems;
}

for (const [unit, files] of UNITS) {
  test(`server/src ${unit} matches server/src/pins/${unit}.sha256 and every file of the unit is pinned`, () => {
    assert.deepEqual(unitProblems(root, unit, files), [], 'hand-edited, or re-vendored without re-pinning');
  });
}

test('server/src/gatewayTrace.js matches the canonical gateway-trace.sha256 (listed there as plain gatewayTrace.js)', () => {
  const p = pins('web/src/gateway-trace/gateway-trace.sha256');
  assert.deepEqual(p.map(([, f]) => f).sort(), ['GatewayTrace.jsx', 'gateway-trace.css', 'gateway-trace.test.jsx', 'gatewayTrace.js']);
  const hash = p.find(([, f]) => f === 'gatewayTrace.js')[0];
  assert.equal(sha('server/src/gatewayTrace.js'), hash, 'gatewayTrace.js differs from gateway-trace.sha256');
});

test('the pin check catches a hand-edited vendored file and a file missing from its pin (mutation on a temp copy)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pgc-pin-'));
  try {
    cpSync(join(root, 'server', 'src'), join(tmp, 'server', 'src'), { recursive: true });
    assert.deepEqual(unitProblems(tmp, 'trace', ['trace.js']), [], 'the untouched copy is clean');
    writeFileSync(join(tmp, 'server/src/trace.js'), `${readFileSync(join(tmp, 'server/src/trace.js'), 'utf8')}\n// edit`);
    assert.match(unitProblems(tmp, 'trace', ['trace.js']).join('|'), /differs from trace\.sha256/);
    assert.match(unitProblems(tmp, 'trace', ['trace.js', 'other.js']).join('|'), /does not list exactly/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('trace.js is the W3C traceparent helper and gatewayTrace.js is a different file (rule 25 naming)', async () => {
  const t = await import('../src/trace.js');
  assert.equal(typeof t.newTrace, 'function');
  const g = await import('../src/gatewayTrace.js');
  assert.equal(typeof g.mockTrace, 'function');
  assert.equal(typeof g.traceFromDoor, 'function');
});

// A pin only proves a copy matches ITSELF. This proves each vendored file is the canonical one: when the lab sits inside the AI-DEMO-Standalone
// checkout (standalone/<lab>), compare byte for byte with origin/main (or the checked-out shared/ when that ref is missing). A lab cloned alone skips it.
const SHARED = join(root, '..', '..', 'shared');
const CANONICAL = [
  ['web/src/components/JsonPane.jsx', 'json/JsonPane.jsx'],
  ['web/src/components/JsonPane.css', 'json/JsonPane.css'],
  ['web/src/components/ShelfLink.jsx', 'shelf-link/ShelfLink.jsx'],
  ['web/src/components/VerifyMark.jsx', 'verify-mark/VerifyMark.jsx'],
  ['web/src/components/VerifyMark.css', 'verify-mark/VerifyMark.css'],
  ['web/src/safeText.js', 'evidence/safeText.js'],
  ['web/src/standalone-ui.css', 'standalone-ui.css'],
  ['server/src/health.js', 'health/health.js'],
  ['server/src/doctor.js', 'doctor/doctor.js'],
  ['server/src/trace.js', 'trace/trace.js'],
  ['server/src/shelfLink.js', 'shelf-link/shelf.js'],
  ['server/src/gatewayReal.js', 'gateway-real/gatewayClient.js'],
  ['server/src/gatewayTrace.js', 'gateway-trace/gatewayTrace.js'],
  ['server/src/vendor/hopDetail.mjs', 'hop-detail/hopDetail.mjs'],
  ['server/src/vendor/hop-catalog.json', 'hop-detail/hop-catalog.json'],
  ['server/src/vendor/hopDetail.test.mjs', 'hop-detail/hopDetail.test.mjs'],
  ['server/src/vendor/README.md', 'hop-detail/README.md'],
];
// Whole folders: every file the lab carries there that is not a pin or a lab-owned doc.
for (const d of ['top-menu', 'evidence', 'floating-dialog', 'gateway-trace', 'signin-dialog']) {
  for (const f of readdirSync(join(root, 'web/src', d))) if (!f.endsWith('.sha256')) CANONICAL.push([`web/src/${d}/${f}`, `${d}/${f}`]);
}

function canonicalBytes(rel) {
  try {
    return execFileSync('git', ['-C', SHARED, 'show', `origin/main:shared/${rel}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch { /* no origin/main here: use the checked-out file */ }
  return existsSync(join(SHARED, rel)) ? readFileSync(join(SHARED, rel)) : null;
}

test('every vendored file is byte-identical to canonical origin/main shared/ (skips when the lab is not inside the AI-DEMO-Standalone checkout)', { skip: !existsSync(SHARED) && 'no ../../shared next to this lab' }, () => {
  const drift = [];
  for (const [local, canon] of CANONICAL) {
    const want = canonicalBytes(canon);
    if (!want) { drift.push(`${local}: no canonical shared/${canon}`); continue; }
    if (!readFileSync(join(root, local)).equals(want)) drift.push(`${local} differs from shared/${canon}`);
  }
  assert.deepEqual(drift, [], 're-vendor from origin/main with cp and re-pin; never edit the copy');
});
