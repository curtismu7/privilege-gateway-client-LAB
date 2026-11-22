import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig, loadCustomerConfig, publicConfig, DEFAULTS, CAST_SHORT } from '../src/customer.js';
import { VERTICALS } from '../src/cast.js';
import { startLab } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pgc-customer-'));
const write = (dir, text, name = 'customer.config.json') => { const f = path.join(dir, name); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); return f; };

test('no config file: the defaults, no warnings, the retail cast', () => {
  const r = loadCustomerConfig({ file: path.join(tmp(), 'absent.json'), env: {} });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.config.name, DEFAULTS.name);
  assert.equal(r.config.vertical, 'retail');
  assert.equal(r.config.cast.castBrand, VERTICALS.retail.cast.castBrand);
});

test('a valid config brands the page and renames the cast on top of the chosen vertical', () => {
  const { config, warnings } = validateConfig({ name: 'Acme Gateway Lab', tagline: 'Which tools may our agent use?', vertical: 'finance', cast: { brand: 'Acme Bank', agentId: 'Pay-Agent', approver: 'the duty manager' } });
  assert.deepEqual(warnings, []);
  assert.equal(config.name, 'Acme Gateway Lab');
  assert.equal(config.vertical, 'finance');
  assert.equal(config.cast.castBrand, 'Acme Bank');
  assert.equal(config.cast.castAgentId, 'pay-agent', 'identifiers are lowercased');
  assert.equal(config.cast.castApprover, 'the duty manager');
  assert.equal(config.cast.castSensitive, VERTICALS.finance.cast.castSensitive, 'untouched tokens keep the vertical wording');
  assert.deepEqual(Object.keys(CAST_SHORT).sort(), ['agentId', 'approver', 'brand', 'sensitive', 'ticket']);
});

test('bad fields fall back to their defaults and say why; nothing throws', () => {
  const hostile = {
    name: '<script>alert(1)</script>', tagline: 'x'.repeat(500), vertical: 'banking',
    cast: { brand: 'https://real-customer.example/path', agentId: 'Bad Agent!', approver: 'a‮b', sensitive: '{{castBrand}}', ticket: 42, extra: 'x', host: 'ignored' },
    surprise: true,
  };
  const { config, warnings } = validateConfig(hostile);
  assert.equal(config.name, DEFAULTS.name);
  assert.equal(config.tagline, DEFAULTS.tagline);
  assert.equal(config.vertical, 'retail');
  assert.deepEqual(config.cast, VERTICALS.retail.cast);
  const text = warnings.join('\n');
  for (const field of ['name', 'tagline', 'vertical', 'cast.brand', 'cast.agentId', 'cast.approver', 'cast.sensitive', 'cast.ticket']) assert.match(text, new RegExp(`${field.replace('.', '\\.')}: `), field);
  assert.match(text, /surprise: unknown key ignored/);
  assert.match(text, /cast\.extra: unknown key ignored/);
  assert.match(text, /cast\.host: unknown key ignored/);
  assert.doesNotMatch(text, /real-customer/, 'a rejected value is not echoed back');
});

test('a config that is not an object, is empty text or is not JSON uses the defaults', () => {
  for (const input of [null, [], 'text', 7]) assert.match(validateConfig(input).warnings[0], /must be a JSON object/);
  const dir = tmp();
  assert.match(loadCustomerConfig({ file: write(dir, 'not json{'), env: {} }).warnings[0], /not valid JSON/);
  assert.match(loadCustomerConfig({ file: write(dir, 'x'.repeat(9000)), env: {} }).warnings[0], /larger than/);
});

test('CUSTOMER_CONFIG names the file; a named file that is missing is reported, never silently ignored', () => {
  const dir = tmp();
  const ok = write(dir, { name: 'From env', vertical: 'health' });
  const r = loadCustomerConfig({ env: { CUSTOMER_CONFIG: ok } });
  assert.equal(r.config.name, 'From env');
  assert.equal(r.config.cast.castBrand, VERTICALS.health.cast.castBrand);
  assert.match(loadCustomerConfig({ env: { CUSTOMER_CONFIG: path.join(dir, 'gone.json') } }).warnings[0], /could not be read/);
});

test('the browser gets branding, the vertical list and the filled cast, and nothing else', () => {
  const pub = publicConfig(validateConfig({ vertical: 'health' }));
  assert.deepEqual(Object.keys(pub).sort(), ['cast', 'name', 'tagline', 'verticals', 'vertical', 'warnings'].sort());
  assert.deepEqual(pub.verticals.map((v) => v.id), ['finance', 'health', 'retail']);
});

test('GET /api/config, /api/stories and /api/talk-track serve the same cast as customer.config', async () => {
  const dir = tmp();
  const file = write(dir, { name: 'Branded Lab', cast: { brand: 'Zeta Retail', approver: 'the shift lead' } });
  const lab = await startLab({ env: { CUSTOMER_CONFIG: file, PGC_PRESENTER: '1' } });
  try {
    const cfg = await (await fetch(`${lab.base}/api/config`)).json();
    assert.equal(cfg.customer.name, 'Branded Lab');
    assert.equal(cfg.customer.cast.castBrand, 'Zeta Retail');
    assert.equal(cfg.presenter, true);
    assert.equal(cfg.workspace, 'default');
    const stories = (await (await fetch(`${lab.base}/api/stories`)).json()).stories;
    assert.equal(stories.length, 6);
    const text = JSON.stringify(stories);
    assert.match(text, /Zeta Retail/);
    assert.match(text, /the shift lead/);
    assert.doesNotMatch(text, /\{\{\s*\w+\s*\}\}/);
    assert.ok(!('file' in stories[0]), 'the server path of a story file is not sent');
    const talk = (await (await fetch(`${lab.base}/api/talk-track`)).json()).sections;
    assert.ok(talk.length >= 8);
    assert.match(JSON.stringify(talk), /Zeta Retail/);
  } finally { await lab.close(); }
});

test('presenter mode is off unless PGC_PRESENTER is exactly 1', async () => {
  for (const [value, want] of [[undefined, false], ['', false], ['true', false], ['0', false], ['1', true]]) {
    const lab = await startLab({ env: value === undefined ? {} : { PGC_PRESENTER: value } });
    try { assert.equal((await (await fetch(`${lab.base}/api/config`)).json()).presenter, want, String(value)); } finally { await lab.close(); }
  }
});

test('the vertical picker: ?vertical= fills stories and the talk track from that pack; the configured vertical keeps the customer cast', async () => {
  const dir = tmp();
  const file = write(dir, { vertical: 'finance', cast: { brand: 'Zeta Retail' } });
  const lab = await startLab({ env: { CUSTOMER_CONFIG: file } });
  try {
    const get = async (p) => (await fetch(`${lab.base}${p}`));
    const configured = JSON.stringify((await (await get('/api/stories')).json()).stories);
    assert.match(configured, /Zeta Retail/);
    assert.equal(JSON.stringify((await (await get('/api/stories?vertical=finance')).json()).stories), configured, 'the configured vertical keeps the customer cast');
    for (const id of ['retail', 'health', 'finance']) {
      const body = await (await get(`/api/stories?vertical=${id}`)).json();
      assert.equal(body.vertical, id);
      assert.doesNotMatch(JSON.stringify(body.stories), /\{\{/, id);
      const talk = await (await get(`/api/talk-track?vertical=${id}`)).json();
      assert.equal(talk.vertical, id);
      assert.doesNotMatch(JSON.stringify(talk.sections), /\{\{/, id);
    }
    const health = JSON.stringify((await (await get('/api/stories?vertical=health')).json()).stories);
    assert.doesNotMatch(health, /Zeta Retail/, 'another pack is the pack, not the customer\'s brand');
    assert.notEqual(health, configured);
    const bad = await get('/api/stories?vertical=__proto__');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad_vertical');
    assert.equal((await get('/api/talk-track?vertical=nope')).status, 400);
  } finally { await lab.close(); }
});
