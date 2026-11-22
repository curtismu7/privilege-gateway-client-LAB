import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';

const root = new URL('..', import.meta.url);
const entryFile = JSON.parse(fs.readFileSync(new URL('docs/shelf-entry.json', root), 'utf8'));
const entry = entryFile.demos[0];

// The shelf's own tag list, when this lab sits next to demo-shelf-LAB (the meta-repo layout). A lab cloned alone skips that one check.
const tagsFile = new URL('../demo-shelf-LAB/data/tags.json', root);
const shelfTags = fs.existsSync(tagsFile) ? new Set(JSON.parse(fs.readFileSync(tagsFile, 'utf8')).groups.flatMap((g) => g.tags.map((t) => t.id))) : null;

test('the shelf entry is one demo with this lab\'s identity, port 7833, and no Ping product it would have to spawn', () => {
  assert.equal(entryFile.demos.length, 1);
  assert.equal(entry.id, 'privilege-gateway-client');
  assert.equal(entry.kind, 'Demo');
  assert.equal(entry.url, 'http://127.0.0.1:7833');
  assert.equal(entry.healthPath, '/api/health');
  assert.deepEqual(entry.pingProducts, []);
  assert.ok(entry.description.length > 40 && entry.description.length <= 300, `${entry.description.length} characters`);
  assert.equal(entry.where, 'installed');
});

test('catalogId is the owner\'s D144 (the content pack uses the same one; D143 belongs to ciba-approval-sequence-LAB), and no repo is claimed that does not exist yet', () => {
  assert.equal(entry.catalogId, 'D144');
  assert.equal(JSON.parse(fs.readFileSync(new URL('../content-pack.json', import.meta.url), 'utf8')).demo.catalog, entry.catalogId);
  assert.equal('repo' in entry, false);
});

test('composeFile is relative and portable: no absolute path, no "..", a .yml, and it names this lab\'s folder', () => {
  assert.ok(!entry.composeFile.startsWith('/'));
  assert.ok(!entry.composeFile.split('/').includes('..'));
  assert.match(entry.composeFile, /\.ya?ml$/);
  assert.equal(entry.composeFile, 'privilege-gateway-client-LAB/docker-compose.yml');
  assert.doesNotMatch(JSON.stringify(entryFile), /\/Users\/|\/home\/|[A-Za-z]:\\/);
  assert.ok(fs.existsSync(new URL('docker-compose.yml', root)), 'the compose file the entry names exists in this repo');
});

test('tags come only from the shelf\'s tag list, and match the Learning Hub pack', () => {
  assert.ok(entry.tags.length >= 3 && new Set(entry.tags).size === entry.tags.length);
  if (shelfTags) for (const t of entry.tags) assert.ok(shelfTags.has(t), `${t} is not in demo-shelf data/tags.json`);
  assert.deepEqual([...entry.tags].sort(), [...buildPack().demo.tags].sort());
});
