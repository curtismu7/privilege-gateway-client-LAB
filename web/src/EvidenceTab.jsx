import React from "react";
import Json from "./json/JsonPane.jsx";
import GatewayTrace from "./gateway-trace/GatewayTrace.jsx";
import { visible } from "./safeText.js";
import { exchangeOf } from "./exchange.js";
import { shownBasis } from "./verdictView.js";

// The decision as data. Every field comes from the server's run record; nothing is worked out here.
export function decisionOf(run) {
  const v = run.verdict;
  return {
    decision: v.word,
    basis: shownBasis(v.basis, run.simulated),
    source: run.source,
    simulated: run.simulated,
    door: run.door,
    stage: run.action === "discover" ? "tools/list" : "tools/call",
    ...(run.tool ? { tool: run.tool } : {}),
    http_status: v.status,
    [run.identity.label]: run.identity.name,
    ...(run.identity.mismatch ? { page_login: run.identity.pageLogin?.name, simulated_scenario: "identity-mismatch" } : {}),
    ...(run.scenario && run.scenario !== "none" ? { scenario: run.scenario } : {}),
  };
}

export default function EvidenceTab({ lab }) {
  const run = lab.lastRun;
  if (!run) {
    return (
      <div className="pgc-empty" data-testid="evidence-empty">
        <h3>Nothing attempted yet</h3>
        <p>Discover the tools or run one. The decision and the exact request and response appear here.</p>
      </div>
    );
  }
  const id = run.identity;
  const exchange = exchangeOf(run);
  return (
    <div data-testid="evidence-panel">
      <h3 className="pgc-sec-h">Identity</h3>
      <dl className="pgc-idtable" data-testid="identity-table">
        <div className="pgc-idtable__src"><dt>{visible(id.label)}</dt><dd>{id.name ? visible(id.name) : "Not named in this lab's settings"}{id.email && <small>{visible(id.email)}</small>}<small>This is the one identity every decision on this page is about.</small></dd></div>
        {id.mismatch && <div><dt>Page login (SIMULATED scenario)</dt><dd>{visible(id.pageLogin?.name)}<small>{visible(id.pageLogin?.email)}</small></dd></div>}
      </dl>
      {id.mismatch && <p className="pgc-note pgc-note--mismatch" role="note">{visible(id.mismatchNote)}</p>}
      <h3 className="pgc-sec-h">Decision</h3>
      <Json value={decisionOf(run)} label="Decision" decode={false} hot={["decision", "basis"]} testId="decision-json" />
      <GatewayTrace exchanges={[exchange]} source={run.source} />
    </div>
  );
}
