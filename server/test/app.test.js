import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLab, rawRequest } from './helpers.js';

test('GET /api/health answers demo-health/1 with this lab identity and the ready state', async () => {
  const lab = await startLab();
  try {
    const r = await fetch(`${lab.base}/api/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.demo.id, 'privilege-gateway-client');
    assert.match(j.demo.version, /^\d+\.\d+\.\d+$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${lab.base}/api/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
  } finally { await lab.close(); }
});

test('a Host header from outside is refused with JSON (DNS-rebinding defence)', async () => {
  const lab = await startLab();
  try {
    const r = await rawRequest(lab.base, { path: '/api/health', headers: { host: 'attacker.example' } });
    assert.equal(r.status, 403);
    assert.equal(JSON.parse(r.body).error, 'bad_host');
    const ok = await rawRequest(lab.base, { path: '/api/health', headers: { host: 'localhost:7833' } });
    assert.equal(ok.status, 200);
  } finally { await lab.close(); }
});

test('a cross-origin or cross-site write is refused; a same-origin write passes the guard', async () => {
  const lab = await startLab();
  try {
    const headers = { 'content-type': 'application/json' };
    const cross = await fetch(`${lab.base}/api/anything`, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: '{}' });
    assert.equal(cross.status, 403);
    assert.equal((await cross.json()).error, 'cross_origin');
    const site = await fetch(`${lab.base}/api/anything`, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, body: '{}' });
    assert.equal(site.status, 403);
    const same = await fetch(`${lab.base}/api/anything`, { method: 'POST', headers: { ...headers, origin: lab.base }, body: '{}' });
    assert.equal(same.status, 404, 'past the guard, an unknown route is a JSON 404');
    assert.equal((await same.json()).error, 'not_found');
  } finally { await lab.close(); }
});

test('an unreadable body and an unknown API route answer JSON, never an HTML error page (rule 23)', async () => {
  const lab = await startLab();
  try {
    const bad = await fetch(`${lab.base}/api/anything`, { method: 'POST', headers: { 'content-type': 'application/json', origin: lab.base }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.match(bad.headers.get('content-type'), /application\/json/);
    const nf = await fetch(`${lab.base}/api/nope`);
    assert.equal(nf.status, 404);
    assert.match(nf.headers.get('content-type'), /application\/json/);
  } finally { await lab.close(); }
});

test('GET /api/shelf returns only SHELF_URL from the app env, never a file outside the repo', async () => {
  const none = await startLab();
  const set = await startLab({ env: { SHELF_URL: 'https://shelf.example/demo-shelf/' } });
  try {
    assert.deepEqual(await (await fetch(`${none.base}/api/shelf`)).json(), { shelfUrl: null });
    assert.deepEqual(await (await fetch(`${set.base}/api/shelf`)).json(), { shelfUrl: 'https://shelf.example/demo-shelf' });
  } finally { await none.close(); await set.close(); }
});
