import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORIES, scanStories, buildStories, loadStories } from '../src/stories.js';
import { VERTICALS, CAST_KEYS, tokensIn, unfilled, fillDeep, castFor, verticalFrom, DEFAULT_VERTICAL } from '../src/cast.js';
import { loadTalkTrack } from '../src/talkTrack.js';
import { createLab } from '../src/lab.js';
import { sampleArgsFor } from '../src/doors.js';
import { PERSONAS } from '../src/auth/personas.js';

test('three vertical packs define exactly the same cast tokens', () => {
  assert.deepEqual(Object.keys(VERTICALS).sort(), ['finance', 'health', 'retail']);
  for (const v of Object.values(VERTICALS)) assert.deepEqual(Object.keys(v.cast).sort(), [...CAST_KEYS].sort(), v.id);
  // The three packs really differ, so a story reads differently in each vertical.
  assert.equal(new Set(Object.values(VERTICALS).map((v) => v.cast.castBrand)).size, 3);
});

test('six stories cover the three doors, the held call, the upstream error and the identity mismatch', () => {
  assert.deepEqual(STORIES.map((s) => s.id), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
  const by = Object.fromEntries(STORIES.map((s) => [s.id, s]));
  assert.equal(by.S01.door, 'demo-all-tools');
  assert.equal(by.S02.door, 'demo-some-tools');
  assert.equal(by.S03.door, 'demo-blocked');
  assert.equal(by.S04.expect.verdict, 'held');
  assert.equal(by.S05.expect.verdict, 'upstream');
  assert.equal(by.S06.expect.mismatch, true);
  for (const s of STORIES) {
    for (const f of ['title', 'goal', 'obstacle', 'control', 'say']) assert.ok(typeof s[f] === 'string' && s[f].length > 20, `${s.id}.${f}`);
    assert.ok(s.steps.length >= 2, `${s.id} steps`);
    s.steps.forEach((st, i) => { assert.equal(st.n, i + 1); for (const f of ['title', 'tell', 'say', 'why']) assert.ok(st[f], `${s.id} step ${st.n} ${f}`); });
  }
  // The Mock-only outcomes are flagged, because Real never produces them.
  for (const id of ['S04', 'S05', 'S06']) assert.equal(by[id].mockOnly, true, id);
  for (const id of ['S01', 'S02', 'S03']) assert.equal(by[id].mockOnly, false, id);
});

test('every {{cast}} token a story or the talk track uses is defined by every vertical pack', () => {
  const talk = Object.fromEntries(loadTalkTrack().map((s, i) => [`talk[${i}]`, s]));
  const r = scanStories(STORIES, VERTICALS, talk);
  assert.deepEqual(r.missing, []);
  assert.ok(r.tokens.length >= 5, r.tokens.join());
  for (const v of Object.values(VERTICALS)) {
    const filled = JSON.stringify(buildStories(v.cast));
    assert.doesNotMatch(filled, /\{\{\s*\w*\s*\}\}|\{\{|\}\}\s*[A-Za-z]/, `${v.id}: a token was left in the text`);
  }
});

test('the token check fails on an undefined token (the test can fail)', () => {
  const bad = [{ id: 'S99', title: 'A {{castBrand}} story', steps: [{ say: 'Ask {{castNobody}} and {{ castOther }}' }] }];
  const r = scanStories(bad, VERTICALS);
  assert.equal(r.missing.length, 6); // 2 undefined tokens x 3 packs
  assert.match(r.missing[0], /S99 uses \{\{castNobody\}\} which finance lacks/);
  // And a pack that lacks a token the stories use is caught, not skipped.
  const thin = { retail: { id: 'retail', cast: { castBrand: 'x' } } };
  assert.ok(scanStories(STORIES, thin).missing.length > 0);
  assert.deepEqual(unfilled('{{a}} {{b}}', { a: 1 }), ['b']);
  assert.deepEqual([...tokensIn({ a: ['{{x}}', { b: '{{y}} {{x}}' }] })].sort(), ['x', 'y']);
});

test('fillDeep fills tokens, leaves other text and unknown tokens alone, and never re-fills filled text', () => {
  assert.equal(fillDeep('hi {{castBrand}}', { castBrand: 'A' }), 'hi A');
  assert.equal(fillDeep('hi {{castNope}}', { castBrand: 'A' }), 'hi {{castNope}}');
  // A value that itself looks like a token is not expanded a second time.
  assert.equal(fillDeep('{{castBrand}}', { castBrand: '{{castAgentId}}', castAgentId: 'B' }), '{{castAgentId}}');
  // Inherited names (constructor, toString) are not tokens.
  assert.equal(fillDeep('{{constructor}} {{toString}}', {}), '{{constructor}} {{toString}}');
  assert.equal(verticalFrom('__proto__'), DEFAULT_VERTICAL);
  assert.equal(castFor('nonsense').castBrand, VERTICALS[DEFAULT_VERTICAL].cast.castBrand);
});

test('a story file with an out-of-pattern name is not loaded', () => {
  const dir = fs.mkdtempSync(new URL('file:///tmp/').pathname + 'pgc-stories-');
  fs.writeFileSync(`${dir}/S01-ok.json`, '{"id":"S01"}');
  fs.writeFileSync(`${dir}/notes.json`, '{"id":"X"}');
  fs.writeFileSync(`${dir}/S1-short.json`, '{"id":"S1"}');
  assert.deepEqual(loadStories(new URL(`file://${dir}/`)).map((s) => s.id), ['S01']);
  fs.rmSync(dir, { recursive: true });
});

// A story must never claim a verdict the lab does not produce: replay every story and every step that names a run.
test('a story may name the Mock persona it is told as', () => {
  const named = STORIES.filter((s) => s.persona !== undefined);
  assert.deepEqual(named.map((s) => s.id), ['S06']);
  for (const s of named) { assert.ok(PERSONAS[s.persona], `${s.id} persona exists`); }
});

test('every story and every step replays against the lab and produces the verdict it names', async () => {
  let replayed = 0;
  for (const story of STORIES) {
    const lab = createLab({ env: {} });
    const runs = [{ run: story.run, expect: story.expect, where: `${story.id} (story)` }, ...story.steps.filter((s) => s.run).map((s) => ({ run: s.run, expect: s.expect, where: `${story.id} step ${s.n}` }))];
    for (const { run, expect, where } of runs) {
      assert.ok(expect, `${where} names a run but no expectation`);
      const { action, ...input } = run;
      const rec = await lab[action]({ ...input, args: input.tool ? sampleArgsFor(input.tool) : undefined });
      assert.equal(rec.verdict.id, expect.verdict, `${where}: verdict ${rec.verdict.id}`);
      assert.equal(rec.source, 'mock');
      if (expect.total !== undefined) assert.equal(rec.tools.length, expect.total, `${where}: tools`);
      if (expect.permitted !== undefined) assert.equal(rec.tools.filter((t) => t.permitted).length, expect.permitted, `${where}: permitted`);
      if (expect.mismatch) assert.equal(rec.identity.mismatch, true, `${where}: mismatch`);
      replayed += 1;
    }
  }
  assert.ok(replayed >= 14, `replayed ${replayed} runs`);
});
