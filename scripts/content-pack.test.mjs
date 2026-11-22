import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

const root = new URL('..', import.meta.url);
const committed = JSON.parse(fs.readFileSync(new URL('content-pack.json', root), 'utf8'));

test('the pack validates against the schema and its cross-references hold', () => {
  assert.deepEqual(validatePack(buildPack()), []);
});

test('the committed content-pack.json is exactly what the builder makes (no drift)', () => {
  assert.deepEqual(committed, buildPack());
});

test('a broken pack is caught: unknown term and unknown story', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope'];
  pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/);
  assert.match(errors, /unknown story ghost/);
});

test('the pack carries this lab identity and only reserved or standards links', () => {
  const pack = buildPack();
  assert.equal(pack.id, 'privilege-gateway-client');
  assert.equal(pack.demo.baseUrl, 'http://localhost:7833');
  const urls = JSON.stringify(pack).match(/https?:\/\/[^"\s]+/g) || [];
  for (const u of urls) assert.match(u, /^(http:\/\/localhost[:/]|https:\/\/modelcontextprotocol\.io\/)/, u);
});

test('the pack carries the six stories with a pointer to each story file, and a try-it card for each', () => {
  const pack = buildPack();
  assert.deepEqual(pack.stories.map((s) => s.id), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
  for (const st of pack.stories) {
    assert.ok(fs.existsSync(new URL(st.file, root)), `${st.id}: ${st.file} does not exist`);
    assert.doesNotMatch(JSON.stringify(st), /\{\{/, `${st.id}: an unfilled token`);
    assert.ok(pack.cards.some((c) => c.story === st.id && c.group === 'try-it'), `${st.id}: no try-it card`);
  }
  assert.ok(pack.documents.every((d) => fs.existsSync(new URL(d.path, root))), 'every document the pack names exists');
});

test('the pack validates through the same script the Learning Hub check uses, on the committed file', async () => {
  const { validatePack } = await import('./validate-content-pack.mjs');
  assert.deepEqual(validatePack(committed), []);
});
