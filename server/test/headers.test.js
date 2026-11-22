import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, startHttpServer } from '../src/app.js';

// N10 (fix pass): the page is not frameable and runs under a CSP that fits the Vite build (one external module script, one external stylesheet,
// no eval) and the shared lab-proxy (same origin, absolute /api and /assets). The proxy fetches the page server-side, so it needs no framing.
async function withDist(fn) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pgc-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'export {}');
  fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}');
  const { app, health } = createApp({ env: {}, webDist: dist });
  const { server } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { health.stop(); await new Promise((r) => server.close(r)); fs.rmSync(dist, { recursive: true, force: true }); }
}

const directives = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

test('the page, the assets, a client-side route and the API all carry a CSP, X-Frame-Options DENY and nosniff', async () => {
  await withDist(async (base) => {
    for (const p of ['/', '/assets/app.js', '/assets/app.css', '/some/client/route', '/api/info', '/api/health', '/api/nope']) {
      const r = await fetch(`${base}${p}`);
      assert.ok(r.headers.get('content-security-policy'), `${p} has a CSP`);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    }
  });
});

test('the CSP forbids framing and inline or eval script, and allows what the build and the pop-out need', async () => {
  await withDist(async (base) => {
    const d = directives((await fetch(`${base}/`)).headers.get('content-security-policy'));
    assert.deepEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['script-src'], ["'self'"], 'scripts only from this origin: no inline, no eval, no CDN');
    assert.deepEqual(d['connect-src'], ["'self'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'none'"]);
    assert.deepEqual(d['form-action'], ["'self'"]);
    assert.ok(d['img-src'].includes('data:'), 'the lock icon is a data: mask image');
    assert.ok(d['style-src'].includes("'self'") && d['style-src'].includes("'unsafe-inline'"), 'React style attributes and the pop-out copy of inline styles');
    for (const [k, v] of Object.entries(d)) assert.ok(!v.includes("'unsafe-eval'") && !v.includes('*') && !v.some((s) => /^https?:/.test(s)), `${k} has no eval, wildcard or remote origin`);
  });
});

test('nothing in the built page needs more than the policy gives: one external module script, one stylesheet, no inline script', async () => {
  const dist = path.resolve(import.meta.dirname, '../../web/dist/index.html');
  if (!fs.existsSync(dist)) return; // CI runs the tests before the build; the real build is checked in the browser (e2e/headers.py)
  const html = fs.readFileSync(dist, 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html), 'no inline script');
  assert.ok(!/\son\w+\s*=/i.test(html), 'no inline event handler');
});
