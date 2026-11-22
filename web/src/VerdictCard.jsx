import React, { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import { basisText } from "./verdictView.js";
import { visible } from "./safeText.js";

// The verdict leads the stage: an icon, the status WORD, one plain sentence, the facts, what to do next and the actions. Colour only supports the
// word (a refusal is amber with a lock, never red). Everything shown arrives as React text through visible(), so hostile text is inert.
export default function VerdictCard({ card, onAction, focusSignal }) {
  const word = useRef(null);
  // After a run finishes, the word takes focus so a screen reader reads the verdict (the live region announces it too).
  useEffect(() => { if (focusSignal && word.current) word.current.focus({ preventScroll: true }); }, [focusSignal]);
  const mism = card.mismatch;
  return (
    <section className="pgc-verdict" data-testid="verdict-card" data-verdict={card.id} data-tone={card.tone} aria-label="Verdict" aria-live="polite">
      <div className="pgc-verdict__main">
        <span className="pgc-verdict__stamp" aria-hidden="true"><Icon name={card.icon} spin={card.spin} className="pgc-verdict__ico" /></span>
        <div className="pgc-verdict__body">
          <h1 className="pgc-verdict__word" tabIndex={-1} ref={word} data-testid="verdict-word">{card.word}</h1>
          <p className="pgc-verdict__sentence" data-testid="verdict-sentence">{visible(card.sentence)}</p>
          {card.simulated && <p className="pgc-verdict__sim" data-testid="verdict-sim">SIMULATED: this decision came from the lab's own in-process gateway.</p>}

          {mism && (
            <div className="pgc-note pgc-note--mismatch" role="note" data-testid="mismatch-note">
              <strong><Icon name="swap" /> SIMULATED scenario: the page login differs from the identity the gateway evaluated</strong>
              <dl className="pgc-kv">
                <dt>Page login</dt><dd>{visible(mism.pageLogin?.name)}</dd>
                <dt>Identity the gateway evaluated</dt><dd>{visible(mism.gateway?.name)}</dd>
              </dl>
              <p>{visible(mism.note)}</p>
            </div>
          )}

          <dl className="pgc-facts" data-testid="verdict-facts">
            {card.facts.map(([k, v, extra], i) => (
              <div key={k + i}>
                <dt>{visible(k)}</dt>
                <dd className={k === "Tool" || k === "Door" ? "pgc-mono" : undefined}>
                  {visible(v)}
                  {extra && <small>{visible(extra)}</small>}
                  {k === "Door" && <button type="button" className="pgc-linkbtn" onClick={() => onAction("door")}>Change door</button>}
                </dd>
              </div>
            ))}
            {card.basis && (
              <div><dt>How this was decided</dt><dd>{basisText(card.basis, card.simulated)}</dd></div>
            )}
          </dl>

          {card.next?.length > 0 && (
            <div className="pgc-next" data-testid="verdict-next">
              <h2>What to do next</h2>
              <ol>{card.next.map((n, i) => <li key={i}>{visible(n)}</li>)}</ol>
            </div>
          )}

          {card.detail && (
            <details className="pgc-errbox" open data-testid="verdict-detail">
              <summary>Message from the gateway</summary>
              <pre>{visible(card.detail)}</pre>
            </details>
          )}

          <div className="pgc-actions">
            {card.actions.map((a) => (
              /* ui-pattern: allow P9 the lab's primary action is ink (red is only Sign in, owner rule); the card action, the Tools-tab action and Run are each the one primary of their own region (tab panels are hidden, not removed), which the checker cannot see */
              <button key={a.id + a.label} type="button" className={a.primary ? "pgc-go pgc-go-primary" : undefined} disabled={a.disabled} onClick={() => onAction(a.id)} data-testid={`action-${a.id}`}>{a.label}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
