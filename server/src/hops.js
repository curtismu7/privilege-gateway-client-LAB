// Every run becomes one ordered demo-hop/1 array, built here from the captured wire exchanges and the verdict, then enriched,
// redacted and validated by the vendored hop-detail. Everything the UI shows (movie reel, step detail, decoded tokens, sequence
// view) is a view of this one array.
//
// Actors: browser, lab (this lab's server), privilege (the gateway), mcp (the backend behind a tool), idp and hitl (only for
// the illustrative and held hops). The existing shared lanes are used as they are.
//
// Honesty. Each hop carries `basis`: 'checked' (the lab's own simulated gateway computed it), 'observed' (read from a captured
// exchange) or 'inferred' (concluded from the outcome). Real hops are only ever observed or inferred. Gateway-internal hops
// (token exchange, introspection) cannot be seen from a client: Mock shows them labelled `illustrative`, Real omits them.
//
// Kinds. door-picked, discover, policy-check, tool-call and verdict are in the shared catalog (AI-DEMO-Standalone #488), so every hop
// uses its real kind. The lab sets its own `fact` on every hop, so a reel frame says what happened in this run.
//
// Verdicts. A hop is 'deny' only when a policy refused it (401 and 403 from the gateway, a denied decision, a refused tool). A hop that
// could not complete (a 502, any other failed status, a JSON-RPC error, no answer, a timeout) is 'error' (demo-hop/1, AI-DEMO-Standalone
// #489): the reel says "failed", never "denied", and the lab's own `fact` says which (502 failed, no answer).
import { enrichHop, validateHop } from './vendor/hopDetail.mjs';
import { newTrace, formatTraceparent } from './trace.js';
import { MOCK_ORIGIN } from './mockGateway.js';

export const failed = (rec) => !rec?.response || rec.response.status >= 400 || Boolean(rec.response.body?.error);
export const statusOf = (rec) => (Number.isInteger(rec?.response?.status) ? rec.response.status : null);
const lastOf = (wire, method) => [...wire].reverse().find((w) => w.rpcMethod === method);
const asExchange = (rec) => (rec ? {
  request: { method: rec.http, url: rec.url, headers: rec.request?.headers ?? {}, body: rec.request?.body ?? null },
  response: rec.response ? { status: rec.response.status, headers: rec.response.headers ?? {}, body: rec.response.body ?? null } : { error: rec.error ?? 'no answer' },
} : { request: {}, response: {} });
const failFact = (rec) => (statusOf(rec) === null ? 'no answer' : `${statusOf(rec)} ${statusOf(rec) === 401 ? 'not accepted' : statusOf(rec) === 403 ? 'refused' : 'failed'}`);
// A failed exchange is a refusal ('deny') only when the gateway answered 401 or 403; anything else (no answer, 5xx, any other status, a JSON-RPC
// error) is a failure ('error'). The hop's own `fact` says which (401 not accepted, 403 refused, 502 failed, no answer).
const failureVerdict = (rec) => (statusOf(rec) === 401 || statusOf(rec) === 403 ? 'deny' : 'error');

const skipped = (kind, from, to, label, why) => ({ kind, from, to, label, verdict: 'skip', note: why, request: {}, response: {}, fact: 'not reached' });

function stagesFrom(decisions) {
  if (!Array.isArray(decisions)) return undefined;
  const map = { pass: 'pass', fail: 'fail', skipped: 'skip', info: 'skip' };
  return decisions.map((d) => ({ name: d.label, result: map[d.outcome] ?? 'skip', note: String(d.evidence ?? '').slice(0, 200) }));
}

// result: the shared door's list()/call() result with capture on (its `wire`). facts/verdict: from the run.
export function buildHops({ source, action, door, tool, args, scenario, result, facts, verdict, catalog, gateway = null, incomingTraceparent }) {
  const mock = source === 'mock';
  const wire = Array.isArray(result?.wire) ? result.wire : [];
  const initRec = lastOf(wire, 'initialize');
  const initdRec = lastOf(wire, 'notifications/initialized');
  const primaryRec = lastOf(wire, action === 'call' ? 'tools/call' : 'tools/list');
  const setupFail = [initRec, initdRec].find((r) => r && failed(r)) ?? (!initRec ? { response: null, error: result?.refusal?.message } : null);
  const decisionsOf = (rec) => rec?.mock?.decisions;
  const hops = [];

  // 1. The browser asks this lab to open the door. The key is never in this request: it stays on the server.
  hops.push({
    kind: 'door-picked', from: 'browser', to: 'lab', verdict: 'ok', basis: 'observed',
    label: action === 'call' ? `The page asks the lab to run ${tool} on ${door}` : `The page asks the lab to discover the tools on ${door}`,
    request: { method: 'POST', url: action === 'call' ? '/api/call' : '/api/discover', body: { door, ...(action === 'call' ? { tool, arguments: args } : {}), ...(mock && scenario && scenario !== 'none' ? { scenario } : {}) } },
    response: {}, fact: 'door picked, no key in the page',
    kv: [['door', door], ['key', 'kept on the server, never sent to the page']],
  });

  // 2. discover: initialize + notifications/initialized with the agent key.
  const initEx = asExchange(initRec ?? setupFail);
  const discoverOk = !setupFail;
  const sid = initRec?.response?.headers?.['mcp-session-id'];
  hops.push({
    kind: 'discover', from: 'lab', to: 'privilege', basis: mock ? 'checked' : 'observed',
    verdict: discoverOk ? 'ok' : failureVerdict(setupFail),
    label: `The lab starts an MCP session on ${door} with the agent key`,
    ...initEx,
    fact: discoverOk ? 'session started' : failFact(setupFail),
    kv: [['steps', 'initialize, notifications/initialized'], ...(sid ? [['mcp-session-id', sid]] : [])],
  });

  // 2b. Gateway-internal hops: illustrative in Mock, omitted in Real (a client cannot see them).
  if (mock && gateway && statusOf(initRec) === 200) {
    const sub = facts.mockSub ?? 'aidemo';
    const token = gateway.issueToken({ door, sub });
    const claims = gateway.verifyToken(token);
    hops.push({
      kind: 'token-exchange', from: 'privilege', to: 'idp', verdict: 'ok', basis: 'checked', illustrative: true,
      label: 'Illustrative: the gateway swaps the agent key for a short-lived token. A client cannot see this step.',
      request: { method: 'POST', url: 'https://mock-idp.invalid/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: '(the agent key, kept on the server)', resource: `${MOCK_ORIGIN}/${door}/mcp` } },
      response: { status: 200, body: { access_token: token, token_type: 'Bearer', expires_in: 3600, mock: true } },
      fact: 'illustrative: mock token issued',
      kv: [['label', 'illustrative: not observable from a client'], ['token', 'MOCK, signed with a per-process random key']],
    });
    hops.push({
      kind: 'gateway-check', from: 'privilege', to: 'idp', verdict: 'ok', basis: 'checked', illustrative: true,
      label: 'Illustrative: the gateway introspects that token before it evaluates policy. A client cannot see this step.',
      request: { method: 'POST', url: 'https://mock-idp.invalid/oauth/introspect', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { token } },
      response: { status: 200, body: { active: Boolean(claims), ...(claims ?? {}) } },
      fact: 'illustrative: token active',
      kv: [['label', 'illustrative: not observable from a client']],
    });
  }

  // 3. The tools/list or tools/call exchange.
  const listing = action === 'discover';
  const primaryOk = discoverOk && primaryRec && !failed(primaryRec);
  if (!discoverOk) hops.push(skipped(listing ? 'tools-list' : 'tool-call', 'lab', 'privilege', listing ? 'tools/list' : `tools/call ${tool}`, 'not reached: the session could not be started'));
  else {
    const ex = asExchange(primaryRec);
    const n = verdict.id === 'allowed' && listing ? facts.tools?.total : null;
    hops.push({
      kind: listing ? 'tools-list' : 'tool-call', from: 'lab', to: 'privilege', basis: mock ? 'checked' : 'observed',
      verdict: primaryOk ? (verdict.id === 'held' ? 'held' : 'ok') : failureVerdict(primaryRec),
      label: listing ? `The lab asks ${door} which tools it may use` : `The lab asks ${door} to run ${tool}`,
      ...ex,
      fact: primaryOk ? (verdict.id === 'held' ? 'held, not run' : listing ? `${n ?? 0} tools returned` : 'HTTP 200') : failFact(primaryRec),
      kv: [['method', listing ? 'tools/list' : 'tools/call'], ...(primaryRec?.ms != null ? [['ms', String(primaryRec.ms)]] : [])],
    });
  }

  // 4. The gateway's decision. Mock: the lab's own simulated gateway computed it (checked). Real: read from the status (inferred).
  const decRec = !discoverOk ? (initRec ?? setupFail) : primaryRec;
  const dstatus = statusOf(decRec);
  if (!decRec?.response) hops.push(skipped('policy-check', 'privilege', 'privilege', 'Policy decision', 'not reached: the gateway did not answer'));
  else if (mock) {
    const decisions = decisionsOf(decRec);
    const stages = stagesFrom(decisions);
    const deny = (decisions ?? []).some((d) => d.outcome === 'fail' && d.id !== 'upstream');
    const hold = (decisions ?? []).some((d) => d.outcome === 'info');
    hops.push({
      kind: 'policy-check', from: 'privilege', to: 'privilege', basis: 'checked',
      verdict: deny ? 'deny' : hold ? 'held' : 'ok',
      label: 'The simulated gateway checks the key, the door\'s policy and the grant',
      request: {}, response: {},
      fact: deny ? 'refused by the simulated policy' : hold ? 'held for approval (simulated)' : 'allowed by the simulated policy',
    });
    const h = hops.at(-1);
    h._extra = { stages, decision: { outcome: deny ? 'DENY' : hold ? 'HOLD' : 'PERMIT', by: 'the lab\'s simulated gateway', reasons: (decisions ?? []).map((d) => `${d.label}: ${d.evidence}`) } };
  } else {
    const deny = dstatus === 401 || dstatus === 403;
    // A 2xx is read as an allow only when the run was Allowed: an isError result, a JSON-RPC error or an unusable body over 200 can hide a refusal.
    const allowedRead = dstatus >= 200 && dstatus < 300 && verdict.id === 'allowed';
    hops.push({
      kind: 'policy-check', from: 'privilege', to: 'privilege', basis: 'inferred',
      verdict: deny ? 'deny' : allowedRead ? 'ok' : 'skip',
      label: 'What this lab concludes about the gateway\'s decision, from the status it saw',
      request: {}, response: {},
      fact: deny ? `inferred from ${dstatus}` : allowedRead ? 'inferred from 200' : dstatus >= 200 && dstatus < 300 ? `no decision read (${dstatus} with an error or unusable reply)` : `no decision read (${dstatus})`,
      kv: [['status', `${dstatus} (observed)`], ['reading', 'inferred: the real gateway reports no per-check detail, so this is a conclusion, not a report']],
    });
  }

  // 5. For a call: what happened at the backend leg.
  if (!listing) {
    const o = verdict.id;
    if (o === 'allowed') hops.push({ kind: 'tool-dispatched', from: 'privilege', to: 'mcp', verdict: 'ok', basis: mock ? 'checked' : 'inferred', label: mock ? `The simulated backend runs ${tool}` : `The tool ran (inferred from the gateway's answer; this lab cannot see the backend leg)`, request: { name: tool, arguments: args }, response: primaryRec?.response?.body?.result ?? {}, fact: 'tool ran' });
    else if (o === 'blocked') hops.push({ kind: 'tool-refused', from: 'privilege', to: 'mcp', verdict: 'deny', basis: mock ? 'checked' : 'inferred', label: 'The call was refused before the backend', request: {}, response: {}, fact: 'nothing reached the tool' });
    else if (o === 'held') hops.push({ kind: 'tool-held', from: 'privilege', to: 'hitl', verdict: 'held', basis: 'checked', label: 'SIMULATED: the gateway holds the call for a person to approve. The held body is invented by this lab.', request: {}, response: primaryRec?.response?.body?.result ?? {}, fact: 'held, not sent' });
    else if (o === 'upstream' && discoverOk && !mock && facts.outcome !== 'upstream') hops.push({ ...skipped('tool-dispatched', 'privilege', 'mcp', 'Backend', 'not known: the reply does not say whether the call reached the tool'), fact: 'not known' });
    else if (o === 'upstream' && discoverOk && (mock || facts.outcome === 'upstream')) hops.push({ kind: 'tool-dispatched', from: 'privilege', to: 'mcp', verdict: 'error', basis: mock ? 'checked' : 'inferred', label: 'The backend did not answer', request: {}, response: {}, fact: 'backend failed, nothing returned' });
    else hops.push(skipped('tool-dispatched', 'privilege', 'mcp', 'Backend', 'not reached'));
  }

  // 6. The verdict goes back to the page.
  hops.push({
    kind: 'verdict', from: 'lab', to: 'browser', verdict: 'ok', basis: verdict.basis === 'checked' ? 'checked' : verdict.basis,
    label: `The lab shows the verdict: ${verdict.word}`,
    request: {}, response: { status: 200, body: { verdict: verdict.id, word: verdict.word, sentence: verdict.sentence } },
    fact: verdict.word,
    kv: [[verdict.identity.label, verdict.identity.name ?? 'not named in the settings']],
  });

  // Enrich, redact (Mock keeps MOCK tokens raw for teaching; Real redacts), number, add a traceparent per hop that ran, validate.
  const trace = newTrace(incomingTraceparent);
  const tokens = mock ? 'raw' : 'redact';
  const problems = [];
  // Hops that did not run are listed after every hop that ran (the demo-hop/1 rule); the screens hide them behind a count.
  const ordered = [...hops.filter((h) => h.verdict !== 'skip'), ...hops.filter((h) => h.verdict === 'skip')];
  const out = ordered.map((raw, i) => {
    const { _extra, fact, basis, illustrative, ...h } = raw;
    const base = { ...h, n: i + 1, mock, ...(h.verdict !== 'skip' ? { traceparent: formatTraceparent(trace.traceId, trace.span()) } : {}) };
    const enriched = enrichHop(base, catalog, _extra ?? {}, { tokens });
    // `fact`, `basis` and `illustrative` are the lab's own words and are set after enrichment, so the catalog's generic fact never replaces what happened in this run.
    enriched.fact = fact ?? enriched.fact;
    enriched.basis = basis ?? (h.verdict === 'skip' ? 'inferred' : 'observed');
    if (illustrative) enriched.illustrative = true;
    for (const p of validateHop(enriched, catalog, { tokens })) problems.push(`hop ${i + 1} (${enriched.kind}): ${p}`);
    return enriched;
  });
  return { hops: out, traceId: trace.traceId, problems };
}
