import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, bindHost, assertBindAllowed, portProblem, resolvePort, allowedExtraHosts } from '../src/safety.js';
import { runChecks } from '../src/checks.js';

test('loopback names are recognised and everything else is not', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '10.0.0.1', 'attacker.example', '127.0.0.1.attacker.example', '1270.0.0.1', '']) assert.ok(!isLoopbackHost(h), h);
});

test('the bind is loopback unless PGC_BIND is set on purpose', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { PGC_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('the port defaults to 7833 and PORT from the environment is accepted; reserved or invalid ports are refused', () => {
  assert.equal(portProblem(7833), null);
  assert.equal(resolvePort({}), 7833);
  assert.equal(resolvePort({ PORT: '' }), 7833);
  assert.equal(resolvePort({ PORT: '7833' }), 7833);
  // Another free port is how a second copy, or a run while 7833 is held by something else, is started.
  assert.equal(resolvePort({ PORT: '7933' }), 7933);
  assert.equal(portProblem(7832), null);
  for (const p of [8080, 5173, 80, 1023, 65536, 0, NaN, 7933.5, -1]) assert.ok(portProblem(p), String(p));
  assert.throws(() => resolvePort({ PORT: '8080' }), /reserved/);
  assert.throws(() => resolvePort({ PORT: 'abc' }), /integer/);
});

test('the doctor port check follows PORT too', () => {
  assert.equal(runChecks({ PORT: '7933' }).find((c) => c.id === 'port').level, 'pass');
  assert.equal(runChecks({ PORT: '4840' }).find((c) => c.id === 'port').level, 'fail');
});

test('LAB_ALLOWED_HOSTS accepts host names only', () => {
  assert.deepEqual([...allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'a.local.example, b.example' })], ['a.local.example', 'b.example']);
  assert.throws(() => allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'bad host' }));
  assert.throws(() => allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'a.example/../x' }));
});

test('the doctor checks pass on a clean env and fail on a wrong port or a non-loopback bind without opt-in', () => {
  assert.ok(runChecks({}).every((c) => c.level !== 'fail'));
  assert.ok(runChecks({ PORT: '8080' }).some((c) => c.id === 'port' && c.level === 'fail'));
  const ids = runChecks({}).map((c) => c.id);
  assert.deepEqual(ids, ['node', 'bind', 'port', 'netguard', 'mock-gateway', 'real', 'agent', 'stories', 'customer-config', 'talk-track', 'mock-signin', 'page-login', 'tenant']);
  assert.ok(runChecks({ PGC_BIND: '0.0.0.0' }).every((c) => c.level !== 'fail'), 'an explicit opt-in is allowed (the container sets it)');
});

test('the doctor fails on an undefined {{cast}} token and passes when every token is defined', async () => {
  const { runChecks } = await import('../src/checks.js');
  const stories = (scan) => runChecks({}, { scan }).find((c) => c.id === 'stories');
  const bad = stories(() => ({ stories: 6, tokens: ['castBrand'], missing: ['S01 uses {{castNobody}} which retail lacks'] }));
  assert.equal(bad.level, 'fail');
  assert.match(bad.detail, /castNobody/);
  assert.equal(stories(() => ({ stories: 6, tokens: ['castBrand'], missing: [] })).level, 'pass');
  assert.equal(stories(() => ({ stories: 2, tokens: [], missing: [] })).level, 'fail', 'fewer than six stories is not enough');
});
