import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// Files copied byte for byte from the shared repo (pinned elsewhere). Their comments may name other projects by design.
const VENDORED = [
  /^server\/src\/(health|doctor|trace|shelfLink|gatewayTrace|gatewayReal)\.js$/, /^server\/src\/(vendor|pins)\//,
  /^web\/src\/(standalone-ui\.css|safeText\.js|safeText\.sha256)$/, /^web\/src\/(top-menu|floating-dialog|evidence|gateway-trace|diagram-kit)\//,
  /^web\/src\/components\/(JsonPane|VerifyMark|ShelfLink)/,
  /^scripts\/(check-ui-standard\.sh|check-no-ai-attribution\.sh|check-token-decode\.mjs)$/,
  /^package-lock\.json$/,
];
const isVendored = (r) => VENDORED.some((re) => re.test(r));

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.data', 'coverage'].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const ours = () => walk(root).map(rel).filter((r) => !isVendored(r) && !/^\.env$/.test(r) && /\.(js|mjs|jsx|json|md|yml|html|css|sh|example|sha256)$|^(\.gitignore|\.dockerignore|Dockerfile|LICENSE)$|^\.env\.example$/.test(r));

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.env.example', '.gitignore', '.github/workflows/ci.yml', 'docs/dependencies.md', 'docs/build-log.md',
    'content-pack.json', 'scripts/doctor.mjs', 'scripts/check-ui-standard.sh', 'scripts/check-no-ai-attribution.sh', 'scripts/check-token-decode.mjs', 'scripts/standalone-ui.sha256']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the README states the tier on a Tier: line, says what is simulated and attributes the scaffold honestly', () => {
  const t = read('README.md');
  assert.match(t, /^Tier: Demo$/m);
  assert.match(t, /simulated/i);
  assert.match(t, /scaffold/i);
  assert.match(t, /7833/);
});

test('.gitignore keeps .env, node_modules and dist out of the repo', () => {
  const g = read('.gitignore').split('\n');
  for (const e of ['.env', 'node_modules/', 'dist/']) assert.ok(g.includes(e), e);
});

test('.env.example lists names only: no value except the port, the .example gateway placeholder and the three door names', () => {
  const ok = new Set(['7833', 'https://gateway.example', 'demo-all-tools,demo-some-tools,demo-blocked']);
  const keys = [];
  for (const line of read('.env.example').split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    keys.push(m[1]);
    if (m[2].trim()) assert.ok(ok.has(m[2].trim()), `${m[1]} carries a value`);
  }
  for (const k of ['PORT', 'MODE', 'PGC_GW_URL', 'PGC_GW_APPS', 'PGC_GW_KEY_DEMO_ALL_TOOLS', 'PGC_GW_KEY_DEMO_SOME_TOOLS', 'PGC_GW_KEY_DEMO_BLOCKED', 'PGC_PINGONE_ENVIRONMENT_ID', 'PGC_USER_CLIENT_ID']) assert.ok(keys.includes(k), k);
  for (const l of read('.env.example').split('\n')) assert.doesNotMatch(l, /^[A-Z][A-Z0-9_]+=\S/, `an uncommented value: ${l.split('=')[0]}`);
});

test('no shipped file of ours names an absolute author path, a settings file outside the repo, an AI-DEMO2 path or a real-looking id', () => {
  const hits = [];
  const reserved = /^(localhost|127\.0\.0\.1|(.+\.)?(example|invalid)|169\.254\.169\.254|local\.ping-devops\.com|[\w-]+\.169\.254\.169\.254|local\.ping-devops\.com|modelcontextprotocol\.io|github\.com|raw\.githubusercontent\.com|www\.w3\.org|json-schema\.org|auth\.pingone\.(com|eu|ca|asia|com\.au|sg)?)$/;
  for (const r of ours()) {
    if (r === 'scripts/repo.test.mjs' || r === 'scripts/compose.test.mjs' || r === 'docs/build-log.md') continue;
    const t = read(r);
    if (/\/Users\//.test(t)) hits.push(`${r}: absolute home path`);
    // Comments may say what the lab must never read; code, config and values may not point at it.
    const code = t.split('\n').filter((l) => !/^\s*(\/\/|#|\*)/.test(l)).join('\n');
    if (/~\/Documents|~\/Development\/\.env|STANDALONE_ENV/.test(code) && !/^(CLAUDE\.md|README\.md|docs\/)/.test(r)) hits.push(`${r}: settings file outside the repo`);
    if (/ai[-_]?demo2/i.test(t)) hits.push(`${r}: names AI-DEMO2`);
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t)) hits.push(`${r}: a UUID (tenant or client id shape)`);
    for (const m of t.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) if (!reserved.test(m[1].toLowerCase())) hits.push(`${r}: host ${m[1]}`);
  }
  assert.deepEqual(hits, []);
});

test('no UML look and no mermaid (the one diagram is the ReactFlow call path), no unsafe sink, and never an EC key from generateKeyPair', () => {
  const hits = [];
  for (const r of ours()) {
    if (/^scripts\/(repo|compose)\.test\.mjs$/.test(r) || r === 'docs/build-log.md') continue;
    const t = read(r);
    if (/mermaid/i.test(t) && !/^(README\.md|CLAUDE\.md|docs\/)/.test(r)) hits.push(`${r}: mermaid`);
    if (/generateKeyPair(Sync)?\(\s*['"]ec['"]/.test(t)) hits.push(`${r}: EC key via generateKeyPair`);
    if (/\bdangerouslySetInnerHTML\b|\beval\(|new Function\(/.test(t)) hits.push(`${r}: unsafe sink`);
  }
  assert.deepEqual(hits, []);
});

test('no file of ours carries an AI-attribution credit (owner rule 2026-11-07)', () => {
  const pat = new RegExp(['Generated ', 'with \\[?Claude', '|Co-Authored', '-By:'].join(''), 'i');
  const hits = ours().filter((r) => !/^scripts\/repo\.test\.mjs$/.test(r) && pat.test(read(r)));
  assert.deepEqual(hits, []);
});

test('package.json has the required scripts and pins Node 26 and the two workspaces', () => {
  const p = JSON.parse(read('package.json'));
  for (const s of ['test', 'build', 'start', 'doctor', 'content-pack']) assert.ok(p.scripts[s], s);
  assert.deepEqual(p.workspaces, ['server', 'web']);
  assert.equal(p.engines.node, '>=26');
  assert.equal(p.type, 'module');
  assert.match(JSON.parse(read('server/package.json')).scripts.test, /^node --test test\/\*\.test\.js$/);
});

test('CI is Node 26 only, uses actions v5, scans for secrets and forbidden strings and enforces token decoding', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /node: \[26\]/);
  assert.match(ci, /actions\/checkout@v5/);
  assert.match(ci, /actions\/setup-node@v5/);
  assert.doesNotMatch(ci, /@v4/);
  assert.match(ci, /gitleaks detect/);
  assert.match(ci, /FORBIDDEN_STRINGS/);
  assert.match(ci, /check-no-ai-attribution\.sh/);
  assert.match(ci, /CHECK_TOKEN_DECODE_ENFORCE: "1"/);
  assert.match(ci, /check-ui-standard\.sh/);
});
