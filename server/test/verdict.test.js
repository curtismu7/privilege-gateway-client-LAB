import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor, identityFor, VERDICTS, OUTCOMES } from '../src/verdict.js';
import { MOCK_IDENTITY, MOCK_PAGE_LOGIN } from '../src/doors.js';

const mockId = (mismatch = false) => identityFor({ source: 'mock', mismatch, mockIdentity: MOCK_IDENTITY, pageLogin: MOCK_PAGE_LOGIN });
const realId = (declared = null) => identityFor({ source: 'real', declared, mockIdentity: MOCK_IDENTITY, pageLogin: MOCK_PAGE_LOGIN });
const base = { door: 'demo-some-tools', action: 'call', tool: 'sensitive_tax_record' };
const mock = (o) => verdictFor({ source: 'mock', ...base, ...o }, mockId());
const real = (o, id = realId()) => verdictFor({ source: 'real', ...base, ...o }, id);

test('there are the five verdicts plus Bad request (a user mistake), each with a word and a tone that is never red', () => {
  assert.deepEqual(Object.values(VERDICTS).map((v) => v.word), ['Allowed', 'Blocked by policy', 'Needs sign-in', 'Held', 'Upstream error', 'Bad request']);
  for (const v of Object.values(VERDICTS)) assert.ok(['ok', 'hold', 'slate'].includes(v.tone), v.word);
  assert.equal(VERDICTS.blocked.tone, 'hold', 'a refusal is amber, never red');
});

test('every outcome maps to one verdict in each source (the Mock-only held aside)', () => {
  const expect = { ok: 'allowed', held: 'held', key: 'needs-sign-in', policy: 'blocked', upstream: 'upstream', 'rpc-error': 'upstream', 'tool-error': 'upstream', unusable: 'upstream', 'bad-request': 'bad-request' };
  assert.deepEqual(Object.keys(expect).sort(), [...OUTCOMES].sort());
  for (const [outcome, id] of Object.entries(expect)) {
    assert.equal(mock({ outcome, status: 403, tools: { total: 18, permitted: 7 } }).id, id, `mock ${outcome}`);
    if (outcome !== 'held') assert.equal(real({ outcome, status: 403, tools: { total: 18 } }).id, id, `real ${outcome}`);
  }
});

test('Mock sentences: discovery counts, refusal, no-policy door, key problems, hold, upstream', () => {
  const some = mock({ action: 'discover', outcome: 'ok', tools: { total: 7 } });
  assert.equal(some.sentence, 'The simulated gateway listed 7 tools on demo-some-tools for aidemo. It lists only the tools the grant allows, so a tool that is not in the list is refused with 403 when it is called.');
  assert.equal(some.basis, 'checked');
  const all = mock({ action: 'discover', door: 'demo-all-tools', outcome: 'ok', tools: { total: 18 } });
  assert.match(all.sentence, /^The simulated gateway listed 18 tools on demo-all-tools for aidemo\./);
  const refused = mock({ outcome: 'policy', status: 403, policy: 'demo-some-tools' });
  assert.match(refused.sentence, /sensitive_tax_record is not in the grant for aidemo on demo-some-tools/);
  assert.match(refused.sentence, /403 before it reached the backend/);
  assert.match(refused.sentence, /policy working as designed/);
  const none = mock({ action: 'discover', door: 'demo-blocked', outcome: 'policy', status: 403, policy: null });
  assert.match(none.sentence, /demo-blocked has no policy.*403 before any tool was listed/);
  assert.match(mock({ outcome: 'key', status: 401, scenario: 'no-key' }).sentence, /carried no agent key/);
  assert.match(mock({ outcome: 'key', status: 401, scenario: 'bad-key' }).sentence, /agent key was not accepted/);
  assert.match(mock({ outcome: 'key', status: 401 }).sentence, /No policy was evaluated/);
  const held = mock({ tool: 'open_ticket', outcome: 'held', status: 200 });
  assert.equal(held.id, 'held');
  assert.match(held.sentence, /simulated and its body is invented/);
  const up = mock({ outcome: 'upstream', status: 502, message: 'x'.repeat(2000) });
  assert.match(up.sentence, /not a policy decision\. Nothing was refused/);
  assert.equal(up.detail, `${'x'.repeat(1000)}… (shortened)`, 'the detail is bounded (long enough for a whole simulated gateway error) and the cut says so');
  assert.equal(mock({ outcome: 'upstream', status: 502, message: 'y'.repeat(1000) }).detail, 'y'.repeat(1000), 'exactly the cap is not cut');
});

test('Real never says "checked": it says observed and inferred, and a Real verdict is never simulated', () => {
  for (const outcome of ['ok', 'key', 'policy', 'upstream', 'rpc-error', 'tool-error', 'unusable']) {
    for (const action of ['discover', 'call']) {
      const v = real({ action, outcome, status: outcome === 'key' ? 401 : outcome === 'policy' ? 403 : outcome === 'upstream' ? 502 : 200, tools: { total: 5 } });
      assert.notEqual(v.basis, 'checked', `${action} ${outcome}`);
      assert.equal(v.simulated, false);
      assert.equal(v.source, 'real');
      assert.doesNotMatch(v.sentence, /simulated|checked/i, `${action} ${outcome}: ${v.sentence}`);
    }
  }
  const blocked = real({ outcome: 'policy', status: 403 });
  assert.equal(blocked.basis, 'inferred');
  assert.match(blocked.sentence, /answered 403 \(observed\)/);
  assert.match(blocked.sentence, /inferred from that status; the reply does not say which check refused/);
  const ok = real({ action: 'discover', outcome: 'ok', status: 200, tools: { total: 18 } });
  assert.match(ok.sentence, /listed 18 tools/);
  assert.match(ok.sentence, /does not say whether the list holds only the tools this key may run/);
  assert.doesNotMatch(ok.sentence, /permitted,/, 'Real does not claim a permitted count it cannot know');
  assert.match(real({ outcome: 'key', status: 401 }).sentence, /answered 401 \(observed\).*did not accept the agent key.*does not say which check failed/);
  assert.throws(() => verdictFor({ source: 'real', ...base, outcome: 'held' }, realId()), /held/, 'a Real held outcome has no sentence: it is Mock-only');
});

test('the identity is labelled by source: evaluated (Mock) or declared by settings (Real)', () => {
  const m = mockId();
  assert.equal(m.label, 'Identity the gateway evaluated');
  assert.equal(m.name, 'aidemo');
  assert.equal(m.basis, 'simulated');
  const r = realId('svc-agent');
  assert.equal(r.label, 'Identity declared by this lab\'s settings');
  assert.equal(r.name, 'svc-agent');
  assert.equal(r.basis, 'declared');
  const none = realId(null);
  assert.equal(none.name, null);
  assert.match(none.note, /does not tell this lab who the key belongs to/);
  assert.equal(mock({ outcome: 'ok', action: 'discover', tools: { total: 1, permitted: 1 } }).identity.label, 'Identity the gateway evaluated');
  assert.equal(real({ outcome: 'key', status: 401 }).identity.label, 'Identity declared by this lab\'s settings');
  assert.match(real({ outcome: 'ok', status: 200 }, realId('svc-agent')).identity.name, /svc-agent/);
});

test('the identity-mismatch scenario exists in Mock only and is labelled simulated', () => {
  const m = mockId(true);
  assert.equal(m.mismatch, true);
  assert.equal(m.pageLogin.name, 'demouser');
  assert.equal(m.name, 'aidemo');
  assert.match(m.mismatchNote, /^SIMULATED scenario/);
  const r = identityFor({ source: 'real', mismatch: true, mockIdentity: MOCK_IDENTITY, pageLogin: MOCK_PAGE_LOGIN });
  assert.equal(r.mismatch, undefined, 'Real never carries a mismatch');
  assert.equal(r.pageLogin, undefined);
});

test('the function is pure: same facts, same verdict, and the inputs are not changed', () => {
  const facts = Object.freeze({ source: 'mock', ...base, outcome: 'policy', status: 403, policy: 'demo-some-tools', tools: Object.freeze({ total: 1, permitted: 1 }) });
  const id = Object.freeze(mockId());
  assert.deepEqual(verdictFor(facts, id), verdictFor(facts, id));
  assert.throws(() => verdictFor({ ...facts, outcome: 'nonsense' }, id), /unknown outcome/);
  assert.throws(() => verdictFor({ ...facts, source: 'live' }, id), /source/);
});

test('Real tool-error and rpc-error reach no conclusion about the gateway: inferred, never "allowed" and never "not a policy decision"', () => {
  for (const outcome of ['tool-error', 'rpc-error']) {
    const v = real({ action: 'call', tool: 'who_has_role', outcome, status: 200, message: 'Access denied by policy' });
    assert.equal(v.id, 'upstream');
    assert.equal(v.basis, 'inferred', outcome);
    assert.match(v.sentence, /answered HTTP 200 \(observed\)/);
    assert.match(v.sentence, /does not say whether .*refused.*no gateway decision is read from it/s, outcome);
    assert.doesNotMatch(v.sentence, /gateway allowed|not a policy decision/i, outcome);
    assert.equal(v.detail, 'Access denied by policy');
    assert.doesNotMatch(v.next.join(' '), /is down/);
  }
  // Mock keeps its own wording: its simulated gateway did compute the decision.
  const m = mock({ action: 'call', tool: 'who_has_role', outcome: 'tool-error', status: 200 });
  assert.match(m.sentence, /simulated gateway allowed the call/);
  assert.equal(m.basis, 'observed');
});

test('Bad request: a malformed call is named as such, never as an Upstream error, and says what to fix', () => {
  const v = mock({ outcome: 'bad-request', status: 200, message: 'Invalid params: missing role' });
  assert.equal(v.id, 'bad-request');
  assert.equal(v.word, 'Bad request');
  assert.equal(v.tone, 'slate');
  assert.match(v.sentence, /malformed|could not be read|rejected/i);
  assert.match(v.sentence, /missing role/);
  assert.doesNotMatch(v.sentence, /upstream/i);
  assert.match(v.sentence, /nothing (was )?refused by policy|not a policy decision/i);
  assert.equal(v.basis, 'checked');
  assert.equal(v.detail, 'Invalid params: missing role');
  assert.ok(v.next.length >= 1 && /argument|tool name/i.test(v.next[0]));
});
