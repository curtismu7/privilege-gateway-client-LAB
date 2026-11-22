import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTalkTrack, loadTalkTrack, buildTalkTrack, TALK_TRACK_FILE } from '../src/talkTrack.js';
import { STORIES } from '../src/stories.js';
import { VERTICALS, unfilled } from '../src/cast.js';

const sections = loadTalkTrack();
const byId = (id) => sections.find((s) => s.id === id);

test('docs/talk-track.md is the one source and parses into sections', () => {
  assert.ok(fs.existsSync(TALK_TRACK_FILE));
  assert.ok(sections.length >= 9, `${sections.length} sections`);
  assert.ok(sections.every((s) => s.title && s.say.length > 80), 'every section says something substantive');
  assert.equal(new Set(sections.map((s) => s.title)).size, sections.length);
});

test('there is a section for every story and for every door', () => {
  for (const s of STORIES) assert.ok(byId(s.id), `no talk-track section for ${s.id}`);
  for (const door of ['demo-all-tools', 'demo-some-tools', 'demo-blocked']) assert.ok(sections.some((s) => s.say.includes(door)), `no section names ${door}`);
});

test('the talk track is honest: it says what is simulated, what Real can claim and what is unverified', () => {
  const all = sections.map((s) => s.say).join('\n');
  assert.match(all, /simulated/i);
  assert.match(all, /observed/);
  assert.match(all, /inferred/);
  assert.match(all, /unverified/i);
  // The held call and the mismatch say they are Mock only; the held call says nobody has captured a real one.
  assert.match(byId('S04').say, /Mock only/);
  assert.match(byId('S04').say, /invented/);
  assert.match(byId('S06').say, /SIMULATED/);
  assert.match(byId('S02').say, /not shown in red|refusal is the control working/);
  // It never says a real gateway checked something.
  assert.doesNotMatch(all, /real gateway (has )?checked/i);
});

test('every {{cast}} token in it is defined by every vertical pack', () => {
  for (const v of Object.values(VERTICALS)) assert.deepEqual(unfilled(sections, v.cast), [], v.id);
  assert.doesNotMatch(JSON.stringify(buildTalkTrack(VERTICALS.health.cast)), /\{\{\s*\w+\s*\}\}/);
  assert.match(byId('S02').say, /\{\{castSensitive\}\}/, 'the source keeps its tokens');
  assert.match(buildTalkTrack(VERTICALS.health.cast).find((s) => s.id === 'S02').say, /patient records/);
});

test('the parser: comments are dropped, a story heading carries its id, text before the first heading is ignored', () => {
  const md = '# Title\nignored\n<!-- a\ncomment -->\n## S07: A story\nOne.\n\nTwo.\n## General\nThree <!-- gone --> here\n';
  assert.deepEqual(parseTalkTrack(md), [
    { id: 'S07', title: 'A story', paragraphs: ['One.', 'Two.'], say: 'One.\n\nTwo.' },
    { id: null, title: 'General', paragraphs: ['Three  here'], say: 'Three  here' },
  ]);
  assert.deepEqual(parseTalkTrack(''), []);
  assert.deepEqual(loadTalkTrack(new URL('file:///no/such/file.md')), []);
});

test('the image ships the talk track the server reads (Dockerfile copies it, dockerignore lets it through)', () => {
  const root = new URL('../../', import.meta.url);
  assert.match(fs.readFileSync(new URL('Dockerfile', root), 'utf8'), /^COPY docs\/talk-track\.md docs\/talk-track\.md$/m);
  const ignore = fs.readFileSync(new URL('.dockerignore', root), 'utf8').split('\n');
  assert.ok(ignore.includes('!docs/talk-track.md'));
  assert.ok(ignore.indexOf('docs/*') < ignore.indexOf('!docs/talk-track.md'), 'the exception comes after the rule it undoes');
});

// N4 (fix pass): the talk track and the story text are shown as plain text (white-space only), so a Markdown marker would appear as literal
// asterisks on the page. Nothing in them may rely on Markdown rendering.
test('no talk-track paragraph or story text carries a Markdown marker (it would show as literal characters)', () => {
  const MARKER = /\*\*|__|`|^\s*[-*] |^#{1,6} /m;
  const texts = [];
  const walk = (v, where) => { if (typeof v === 'string') texts.push([where, v]); else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'file') walk(x, `${where}.${k}`); };
  for (const s of sections) texts.push([`talk-track ${s.title}`, s.say]);
  for (const s of STORIES) walk(s, `story ${s.id}`);
  for (const [where, t] of texts) assert.ok(!MARKER.test(t), `${where} has a Markdown marker: ${t.match(MARKER)?.[0]}`);
});
