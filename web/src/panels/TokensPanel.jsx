import React, { useEffect, useMemo, useRef } from "react";
import { Tag } from "../evidence/Tag.jsx";
import { actorOf, laneVar, stepKey, txt, verdictWord } from "../evidence/lanes.js";
import { Json, TokenParts } from "../json/JsonPane.jsx";
import Icon from "../Icon.jsx";
import StepperBar from "./StepperBar.jsx";
import RunNote from "./RunNote.jsx";
import { buildTokenFlow, CHANGE_WORD, summaryOf } from "./tokenFlow.js";

// Token sequence: per hop, the tokens in play, decoded by the vendored JsonPane (Header, Payload, Signature as sent, never styled as verified), and
// what changed from the token before as words AND an icon (Added, Removed, Changed, Same). Mock tokens are labelled MOCK. The messages of the
// hop follow the one walkthrough. All data comes by props: this body is also drawn in a second window when the panel is popped out.
const ICON = { added: "plus", removed: "minus", changed: "pencil", same: "equals" };
const STATE = { added: "ok", removed: "warn", changed: "warn", same: "info" };
const short = (v) => { const s = txt(v); return s.length > 140 ? `${s.slice(0, 140)}…` : s; };

function ChangeList({ change }) {
  if (change.kind === "first") return null;
  const moved = change.claims.filter((c) => c.status !== "same");
  const kept = change.claims.filter((c) => c.status === "same").map((c) => c.claim);
  return (
    <div className="pgc-tok__diff" data-testid="token-change">
      {moved.length > 0 && (
        <ul className="pgc-chg">
          {moved.map((c) => (
            <li key={c.claim} data-status={c.status}>
              <Tag state={STATE[c.status]}><Icon name={ICON[c.status]} />{CHANGE_WORD[c.status]}</Tag>
              <code className="pgc-mono">{txt(c.claim)}</code>
              {c.status === "changed" && <span className="pgc-chg__v">{short(c.before)} to {short(c.after)}</span>}
              {c.status === "added" && <span className="pgc-chg__v">{short(c.after)}</span>}
              {c.status === "removed" && <span className="pgc-chg__v">was {short(c.before)}</span>}
            </li>
          ))}
        </ul>
      )}
      {kept.length > 0 && (
        <p className="pgc-chg__same"><Tag state="info"><Icon name="equals" />Same</Tag> {kept.map((k) => txt(k)).join(", ")}</p>
      )}
    </div>
  );
}

function TokenCard({ tok, mock, hopN }) {
  const c = tok.change;
  const kindWord = c.kind === "first" ? "First" : c.kind === "same" ? CHANGE_WORD.same : CHANGE_WORD.changed;
  const label = `Message ${hopN} ${tok.name}`;
  return (
    <article className="pgc-tok" data-testid="token-card" data-change={c.kind}>
      <header className="pgc-tok__h">
        <code className="pgc-mono">{txt(tok.name)}</code>
        {mock && <Tag state="info" title="A mock token: signed with a key that exists only in this lab's process, valid nowhere else">MOCK</Tag>}
        {tok.claimsOnly && <Tag state="info" title="An introspection answer: the claims the receiver learned, not a token">claims only</Tag>}
        <Tag state={c.kind === "changed" ? "warn" : "info"} testId="token-change-word">{c.kind === "first" ? null : <Icon name={c.kind === "same" ? "equals" : "pencil"} />}{kindWord}</Tag>
        <span className="pgc-tok__sum">{summaryOf(c)}</span>
      </header>
      <ChangeList change={c} />
      {tok.claimsOnly
        ? <Json value={tok.claims} label={`${label} claims`} decode={false} />
        : <TokenParts header={tok.header} claims={tok.claims} raw={tok.raw} label={label} />}
    </article>
  );
}

function HopRow({ item, selected, onSelect, mock, refs, onKey, tabbable }) {
  const { hop, tokens } = item;
  const on = hop.n === selected;
  const from = actorOf(hop.from), to = actorOf(hop.to);
  const refsList = Array.isArray(hop.spec?.refs) ? hop.spec.refs.filter((r) => r?.label) : [];
  const first = tokens[0];
  return (
    <li className="pgc-hop" data-on={on ? "true" : undefined} data-testid={`tokhop-${hop.n}`} style={{ "--lane": laneVar(hop.to) }}>
      <button type="button" className="pgc-hop__head" ref={(el) => { refs.current[hop.n] = el; }} aria-current={on ? "step" : undefined} aria-expanded={on}
        tabIndex={tabbable ? 0 : -1} onClick={() => onSelect(hop.n)} onKeyDown={(e) => onKey(e, hop.n)}
        aria-label={`Message ${hop.n}, ${txt(hop.title)}, ${from.label} to ${to.label}, ${tokens.length ? `${tokens.length} ${tokens.length === 1 ? "token" : "tokens"}` : "no token"}`}>
        <span className="pgc-hop__n">{hop.n}</span>
        <span className="pgc-hop__t"><b>{txt(hop.title)}</b> <span className="ev-muted">{from.label} to {to.label}</span></span>
        {hop.illustrative && <Tag state="info" title="Illustrative: a gateway-internal step a client cannot see. Real mode leaves it out.">illustrative</Tag>}
        {hop.verdict && hop.verdict !== "ok" && <Tag state={hop.verdict === "deny" ? "warn" : hop.verdict === "held" ? "warn" : hop.verdict === "error" ? "bad" : "info"}>{verdictWord(hop.verdict)}</Tag>}
        <span className="pgc-hop__tok">{tokens.length ? `${tokens.length} ${tokens.length === 1 ? "token" : "tokens"}: ${first ? summaryOf(first.change) : ""}` : "no token on this hop"}</span>
      </button>
      {refsList.length > 0 && (
        <ul className="pgc-refs" aria-label={`Specifications for message ${hop.n}`}>
          {refsList.map((r) => <li key={`${r.label}-${r.url}`} className="ev-pill" title={txt(r.title || "")}>{txt(r.label)}</li>)}
        </ul>
      )}
      {on && (
        <div className="pgc-hop__body" data-testid="tokhop-body">
          <p className="pgc-hop__nar">{txt(hop.narrative || hop.label || hop.title)}</p>
          {tokens.length === 0
            ? <p className="ev-muted" data-testid="tokhop-none">No token travels on this hop. The agent key stays on the server and is never shown.</p>
            : tokens.map((t) => <TokenCard key={`${t.name}-${(t.raw ?? t.name).slice(-10)}`} tok={t} mock={mock || hop.mock} hopN={hop.n} />)}
        </div>
      )}
    </li>
  );
}

export default function TokensPanel({ run, stepper, live }) {
  const hops = run?.hops ?? [];
  const flow = useMemo(() => buildTokenFlow(hops), [hops]);
  const refs = useRef({});
  const ns = flow.map((f) => f.hop.n);
  const tabN = ns.includes(stepper.selected) ? stepper.selected : ns[0];
  const onKey = (e, n) => {
    if (e.key === "Enter" || e.key === " ") return; // the button's own click
    const next = stepKey(e, n, ns, stepper.select);
    if (next != null && next !== n) refs.current[next]?.focus();
  };
  // The hop that follows the walkthrough is brought to the top of the panel (below the sticky controls), so its tokens are in view.
  useEffect(() => {
    const li = refs.current[stepper.selected]?.closest("li");
    const body = li?.closest(".fd-body");
    if (!li || !body) return;
    const bar = body.querySelector(".pgc-stepbar");
    const off = li.getBoundingClientRect().top - body.getBoundingClientRect().top - (bar?.offsetHeight ?? 0) - 14;
    if (Math.abs(off) > 1) body.scrollTop += off;
  }, [stepper.selected]);
  const real = run?.source === "real";
  const anyToken = flow.some((f) => f.tokens.length);
  return (
    <div className="pgc-pane" data-testid="panel-tokens-body">
      <StepperBar stepper={stepper} live={live} />
      <RunNote run={run} stepper={stepper} />
      {hops.length === 0
        ? <p className="pgc-emptynote" data-testid="tokens-none">No run yet. Get the tools or run one, and the tokens of its hops are listed here.</p>
        : (<>
          <p className="pgc-tokintro" data-testid="tokens-intro">
            {real
              ? <>Real: this lab only holds an agent key for the door, and it is never shown. {anyToken ? "Any token the gateway returned is shown decoded." : "No token came back on this run, so there is nothing to decode."}</>
              : <><Tag state="info">MOCK</Tag> The tokens here were issued by this lab's own simulated gateway, with a key that exists only in this process. </>}
            {" "}Decoding is not verifying: the signature is shown as sent, and the receiving server is the one that checks it.
          </p>
          <ol className="pgc-tflow" aria-label="Tokens by message">
            {flow.map((item) => (
              <HopRow key={item.hop.n} item={item} selected={stepper.selected} onSelect={stepper.select} mock={!real && Boolean(run.simulated)} refs={refs} onKey={onKey} tabbable={item.hop.n === tabN} />
            ))}
          </ol>
        </>)}
    </div>
  );
}
