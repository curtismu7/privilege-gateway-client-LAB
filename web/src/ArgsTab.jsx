import React from "react";
import Icon from "./Icon.jsx";
import Json, { DecodedTokens, decodedTokensIn } from "./json/JsonPane.jsx";
import { visible } from "./safeText.js";

// Checks the form can make without asking the gateway: the text is a JSON object and every required argument is filled in.
// Whether the gateway accepts it is the gateway's call (a Bad request verdict), not decided here.
export function validateArgs(text, required = []) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, json: false, msg: "Arguments are not valid JSON yet. Run is unavailable until this is fixed." }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, json: false, msg: "Arguments must be a JSON object, like {\"name\": \"value\"}." };
  const missing = required.filter((k) => value[k] === undefined || value[k] === null || value[k] === "");
  if (missing.length) return { ok: false, json: true, msg: `Missing required: ${missing.join(", ")}. Run is unavailable until filled in.` };
  return { ok: true, json: true, msg: required.length ? `Required: ${required.join(", ")}` : "No required arguments." };
}

function Response({ lab, tool }) {
  const run = lab.lastRun;
  if (lab.busy?.kind === "call" && lab.busy.tool === tool.name) {
    return <div className="pgc-resp" data-testid="response"><h3 tabIndex={-1}>Running…</h3><div className="pgc-skel" aria-hidden="true"><i /><i /></div></div>;
  }
  if (!run || run.action !== "call" || run.tool !== tool.name) return <p className="pgc-note" data-testid="response-none">Run {visible(tool.name)} to see the response here.</p>;
  const v = run.verdict;
  if (v.id === "allowed" && run.result) {
    return (
      <div className="pgc-resp" data-testid="response">
        <div className="pgc-resp__h"><h3 tabIndex={-1}>Response</h3><span className="pgc-badge"><Icon name="check" />{v.word}{v.simulated ? " (simulated)" : ""}</span></div>
        {run.result.isError && <p className="pgc-note pgc-note--hold">The tool marked this result as an error.</p>}
        <Json value={run.result.text} label="Tool response" testId="response-json" />
      </div>
    );
  }
  return (
    <div className="pgc-resp pgc-resp--refusal" data-testid="response" data-verdict={v.id}>
      <div className="pgc-resp__h"><h3 tabIndex={-1}>{v.word}</h3></div>
      <p>{visible(v.sentence)}</p>
      {v.next?.length > 0 && <ol>{v.next.map((n, i) => <li key={i}>{visible(n)}</li>)}</ol>}
    </div>
  );
}

export default function ArgsTab({ lab, tool, onBack }) {
  if (!tool) {
    return (
      <div className="pgc-empty" data-testid="args-empty">
        <Icon name="list" className="pgc-empty__ico" />
        <h3>No tool selected</h3>
        <p>{lab.hasTools ? "Pick a tool on the Tools tab, then come back here to set its arguments." : "Discover the tools first, then pick one."}</p>
        <button type="button" onClick={onBack}>Go to Tools</button>
      </div>
    );
  }
  const text = lab.argsFor(tool.name);
  const chk = validateArgs(text, tool.required);
  const working = Boolean(lab.busy);
  const mock = lab.info.source === "mock";
  const request = (() => { try { return { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: tool.name, arguments: JSON.parse(text) } }; } catch { return null; } })();
  // Tokens a run carries (Mock tokens, labelled mock) are decoded through the shared pane, by field path, never by hand.
  const hops = lab.lastRun?.hops?.map((h) => ({ step: h.n, kind: h.kind, request: h.request, response: h.response })) ?? null;
  return (
    <div data-testid="args-panel">
      <div className="pgc-args-top"><button type="button" onClick={onBack}>← All tools</button></div>
      <h2 className="pgc-tool-h" data-testid="args-tool">{visible(tool.name)}</h2>
      {tool.description && <p className="pgc-desc">{visible(tool.description)}</p>}
      {mock && tool.write && <p className="pgc-note pgc-note--hold"><Icon name="hourglass" /> This changes data. The simulated gateway holds it until a person approves it, so Run ends as Held.</p>}
      <label className="pgc-lbl" htmlFor="pgc-args">Arguments (JSON)</label>
      <textarea id="pgc-args" className="pgc-args" spellCheck={false} value={text} onChange={(e) => lab.setArgs(tool.name, e.target.value)} aria-describedby="pgc-argnote" data-testid="args-text" />
      <p id="pgc-argnote" className={`pgc-note${chk.ok ? "" : " pgc-note--hold"}`} data-testid="args-note">{chk.msg}</p>
      <div className="pgc-run-row">
        {/* ui-pattern: allow P9 the lab's primary action is ink (red is only Sign in, owner rule); the card action, the Tools-tab action and Run are each the one primary of their own region (tab panels are hidden, not removed), which the checker cannot see */}
        <button type="button" className="pgc-go pgc-go-primary" disabled={!chk.ok || working} onClick={() => lab.callTool(tool.name)} data-testid="run">Run</button>
        {chk.json && !chk.ok && mock && (
          <button type="button" disabled={working} onClick={() => lab.callTool(tool.name)} data-testid="run-anyway" title="Send the incomplete arguments anyway, to see how the gateway answers a malformed request">Send anyway</button>
        )}
      </div>
      <details className="pgc-sends">
        <summary>What this sends</summary>
        {request ? <Json value={request} label="Request body" decode={false} /> : <p className="pgc-note">Fix the JSON above to see the request.</p>}
      </details>
      <Response lab={lab} tool={tool} />
      {hops && decodedTokensIn(hops).length > 0 && (
        <section className="pgc-tokens" data-testid="run-tokens">
          <h3>Tokens in this run</h3>
          <p className="pgc-note">{mock ? "MOCK tokens, signed with a random key made when this lab started and valid nowhere else. " : ""}Decoding shows what a token says; it does not check the signature.</p>
          <DecodedTokens value={hops} label="Tokens in this run" />
        </section>
      )}
    </div>
  );
}
