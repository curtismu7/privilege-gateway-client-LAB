import React from "react";
import Icon from "../Icon.jsx";
import { ICONS } from "../verdictView.js";
import { visible } from "../safeText.js";

// What the run was, in words, above the evidence: the server's verdict word and sentence with the verdict's icon (a refusal is a lock and the
// words, never red), where Simulate stops, and, for the simulated identity-mismatch scenario, both identities. Props only.
export default function RunNote({ run, stepper }) {
  if (!run) return null;
  const v = run.verdict;
  const mism = run.identity?.mismatch ? run.identity : null;
  const stop = stepper.stopsEarly ? stepper.stopHop : null;
  return (
    <div className="pgc-runnote" data-testid="run-note" data-verdict={v.id}>
      <p className="pgc-runnote__v">
        <Icon name={ICONS[v.id] ?? "alert"} />
        <strong data-testid="run-note-word">{visible(v.word)}</strong>
        <span className="pgc-runnote__s" title={visible(v.sentence)}>{visible(v.sentence)}</span>
      </p>
      {stop && (
        <p className="pgc-runnote__stop" data-testid="run-note-stop">
          Simulate stops at message {stop.n}, {visible(stop.title)}, where this run ended. Next goes on to the rest.
        </p>
      )}
      {mism && (
        <dl className="pgc-kv pgc-runnote__ids" data-testid="run-note-identities">
          <dt>Page login (SIMULATED scenario)</dt><dd>{visible(mism.pageLogin?.name)}</dd>
          <dt>{visible(mism.label)}</dt><dd>{visible(mism.name)}</dd>
        </dl>
      )}
    </div>
  );
}
