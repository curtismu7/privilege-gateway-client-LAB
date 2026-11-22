// The verdict model: a pure function that turns the facts of one run into one of five verdicts, each with a word and a plain
// sentence. No I/O, no clock, no globals, so a test can pin every sentence.
//
// The five words (the screen shows the word, never colour alone). `tone` names the chip colour family and is never red for a
// refusal: ok = green, hold = amber (a refusal or a hold: the control working), slate = neutral grey (no decision was made).
//   Allowed | Blocked by policy | Needs sign-in | Held | Upstream error
// plus Bad request (a user mistake: missing or empty required arguments, an unknown tool name). It is not a gateway decision and not a
// connection problem, so it is never shown as either.
//
// Honesty in Real: the lab saw a status and a body, nothing more. A Real verdict says "observed" for what it read and
// "inferred" for what it concluded from that; it never says the gateway "checked" something. Mock may say "checked" because
// the lab's own simulated gateway computed it. A held call is a Mock-only outcome (no real held-call capture exists yet).

export const VERDICTS = Object.freeze({
  allowed: { word: 'Allowed', tone: 'ok' },
  blocked: { word: 'Blocked by policy', tone: 'hold' },
  'needs-sign-in': { word: 'Needs sign-in', tone: 'slate' },
  held: { word: 'Held', tone: 'hold' },
  upstream: { word: 'Upstream error', tone: 'slate' },
  'bad-request': { word: 'Bad request', tone: 'slate' },
});

export const OUTCOMES = Object.freeze(['ok', 'held', 'key', 'policy', 'upstream', 'rpc-error', 'tool-error', 'unusable', 'bad-request']);

// Who the verdict is about. Mock: the identity the simulated gateway evaluated. Real: only what this lab's settings declare,
// because a real 401/403 carries no identity and a key says nothing about who holds it.
export function identityFor({ source, declared = null, mismatch = false, mockIdentity, pageLogin }) {
  if (source === 'mock') {
    return {
      label: 'Identity the gateway evaluated', name: mockIdentity.name, email: mockIdentity.email, basis: 'simulated',
      ...(mismatch ? { pageLogin: { name: pageLogin.name, email: pageLogin.email }, mismatch: true, mismatchNote: 'SIMULATED scenario: the page login differs from the identity the gateway evaluated. The decision applies to the gateway identity, not to the page login.' } : {}),
    };
  }
  return { label: 'Identity declared by this lab\'s settings', name: declared, email: null, basis: 'declared', note: declared ? null : 'No identity is declared in the settings. The gateway does not tell this lab who the key belongs to.' };
}

// A cut is never silent: past the cap the text ends with an ellipsis and the word shortened (the full body stays in the Evidence tab's trace).
const clip = (s, n = 1000) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}… (shortened)` : t; };
const who = (identity) => identity?.name || 'the caller';

// facts: { source, action: 'discover'|'call', door, tool?, outcome, status?, message?, tools?: { total, permitted|null }, policy?, scenario?, keyKind? }
export function verdictFor(facts, identity) {
  const { source, action, door, outcome } = facts;
  if (!OUTCOMES.includes(outcome)) throw new Error(`verdictFor: unknown outcome ${String(outcome).slice(0, 20)}`);
  if (source !== 'mock' && source !== 'real') throw new Error('verdictFor: source must be mock or real');
  if (outcome === 'held' && source === 'real') throw new Error('verdictFor: held is Mock-only; no real held-call capture exists, so Real never claims one');
  const mock = source === 'mock';
  const what = action === 'call' ? `the call to ${facts.tool}` : 'tool discovery';
  const st = Number.isInteger(facts.status) ? `HTTP ${facts.status}` : 'no HTTP status';
  const seen = mock ? '' : ' (observed)';
  let id; let sentence; let basis; let next = [];

  if (outcome === 'ok' && action === 'discover') {
    id = 'allowed';
    const t = facts.tools || { total: 0, permitted: null };
    if (mock && Number.isInteger(t.permitted)) {
      sentence = t.permitted === t.total
        ? `${t.total} tools are in the grant of ${who(identity)} on ${door}, and all ${t.total} are permitted.`
        : `${t.total} tools were discovered on ${door}: ${t.permitted} permitted, ${t.total - t.permitted} not permitted for ${who(identity)}.`;
      basis = 'checked';
      next = t.permitted < t.total ? [`Run a permitted tool, or run a not-permitted one to watch the gateway refuse it.`] : ['Pick a tool, set its arguments, then run it.'];
    } else {
      sentence = `The gateway answered ${st}${seen} and listed ${t.total} tool${t.total === 1 ? '' : 's'} on ${door}. Which of them this key may run is only known when one is called, because the list does not say.`;
      basis = 'inferred';
      next = ['Run a tool to learn what the gateway allows.'];
    }
  } else if (outcome === 'ok') {
    id = 'allowed';
    sentence = mock
      ? `${who(identity)} ran ${facts.tool} on ${door}. Policy ${facts.policy ?? door} allowed it, and the simulated backend returned a sample result.`
      : `The gateway answered ${st}${seen} and the tool returned a result. That the call was allowed is inferred from that answer.`;
    basis = mock ? 'checked' : 'inferred';
  } else if (outcome === 'held') {
    // Mock only: a real held call has never been captured, so Real never produces this verdict.
    id = 'held';
    sentence = `The simulated gateway held ${facts.tool} on ${door} until a person approves it. Nothing ran. This hold is simulated and its body is invented by this lab.`;
    basis = 'checked';
    next = ['In a real deployment a person approves the request in the Privilege console, then the caller retries.'];
  } else if (outcome === 'key') {
    id = 'needs-sign-in';
    sentence = mock
      ? `The simulated gateway refused ${what} on ${door} with 401 because ${facts.scenario === 'no-key' ? 'the request carried no agent key' : 'the agent key was not accepted'}. No policy was evaluated.`
      : `The gateway answered 401${seen}: it did not accept the agent key this lab sent for ${door}. No grant was reached. The reply does not say which check failed.`;
    basis = mock ? 'checked' : 'inferred';
    next = mock ? ['Run it again without the no-key or bad-key scenario.'] : ['Check the key for this door in this lab\'s own .env, then restart the lab.'];
  } else if (outcome === 'policy') {
    id = 'blocked';
    const noPolicy = mock && facts.policy === null;
    sentence = mock
      ? (noPolicy
        ? `${door} has no policy, so the simulated gateway refused ${who(identity)} with 403 before any tool was listed. This is the policy working as designed.`
        : `${facts.tool ? `${facts.tool} is listed but is not in the grant` : 'The caller is not in the grant'} for ${who(identity)} on ${door}. The simulated gateway refused it with 403 before it reached the backend. This is the policy working as designed.`)
      : `The gateway answered 403${seen} for ${what} on ${door}. That the key's grant does not allow it is inferred from that status; the reply does not say which check refused.`;
    basis = mock ? 'checked' : 'inferred';
    next = noPolicy || !mock ? ['Ask a policy admin to add this caller to a policy for this door, or pick another door.'] : ['Choose one of the permitted tools, or ask a policy admin to add this tool to the grant.'];
  } else if (outcome === 'bad-request') {
    id = 'bad-request';
    basis = mock ? 'checked' : 'inferred';
    const msg = clip(facts.message);
    sentence = `The ${mock ? 'simulated ' : ''}gateway rejected ${what} on ${door} as malformed${msg ? `: ${msg}` : ''}. This is not a policy decision and not a connection problem: nothing was refused by policy and nothing ran.`;
    next = ['Fix the arguments (every required one must be filled in) or the tool name, then run it again.'];
    return { id, ...VERDICTS[id], sentence, basis, identity, source, simulated: mock, door, tool: facts.tool ?? null, status: facts.status ?? null, detail: msg || null, next };
  } else {
    id = 'upstream';
    basis = 'observed';
    const msg = clip(facts.message);
    if (outcome === 'upstream') {
      sentence = mock
        ? `The simulated gateway could not finish ${what} on ${door}: its upstream did not answer${Number.isInteger(facts.status) ? ` (${st})` : ''}. This is a connection problem, not a policy decision. Nothing was refused.`
        : `${Number.isInteger(facts.status) ? `The gateway answered ${st} (observed)` : 'The gateway could not be reached'} for ${what} on ${door}. This is a connection problem, not a policy decision: nothing was refused.`;
    } else if (outcome === 'tool-error') {
      // Real: an MCP isError result over HTTP 200 is how many gateways deny a call AND how a failing tool reports. The reply cannot tell them apart.
      sentence = mock
        ? 'The tool ran but reported an error. The simulated gateway allowed the call; the failure came back from the tool.'
        : `The gateway answered ${st}${seen} and the tool result is marked as an error (observed). The reply does not say whether the gateway refused the call or the tool itself failed, so no gateway decision is read from it.`;
    } else if (outcome === 'rpc-error') {
      sentence = mock
        ? `The simulated gateway answered ${st} with a JSON-RPC error for ${what} on ${door}. It is a protocol error, not a policy decision.`
        : `The gateway answered ${st}${seen} with a JSON-RPC error for ${what} on ${door}. The reply does not say whether a policy refused the call or the request itself was faulty, so no gateway decision is read from it.`;
    } else {
      sentence = `The gateway answered ${st}${seen}, but the reply was not a usable JSON-RPC answer (empty, not JSON, or too large), so no decision can be read from it.`;
    }
    const ambiguous = !mock && (outcome === 'tool-error' || outcome === 'rpc-error');
    // The 'observed' basis is for what the lab read; here the lab concludes that no decision can be read, which is a conclusion.
    if (ambiguous) basis = 'inferred';
    next = ambiguous
      ? ['Read the message in the detail. If it names a policy or a missing permission, ask a policy admin to check the grant for this door; otherwise check the tool and its arguments.']
      : ['Try again. If it keeps failing, the gateway or its upstream is down or unreachable from this machine.'];
    return { id, ...VERDICTS[id], sentence, basis, identity, source, simulated: mock, door, tool: facts.tool ?? null, status: facts.status ?? null, detail: msg || null, next };
  }
  return { id, ...VERDICTS[id], sentence, basis, identity, source, simulated: mock, door, tool: facts.tool ?? null, status: facts.status ?? null, detail: null, next };
}
