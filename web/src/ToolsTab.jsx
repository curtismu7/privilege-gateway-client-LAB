import React, { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { visible } from "./safeText.js";

// A name that may be long: break after each underscore so it wraps instead of widening the grid.
const Wrapped = ({ text }) => {
  const parts = visible(text).split("_");
  return parts.map((p, i) => <React.Fragment key={i}>{p}{i < parts.length - 1 ? <>_<wbr /></> : null}</React.Fragment>);
};

function Empty({ icon, tone = "", title, children }) {
  return (
    <div className={`pgc-empty ${tone}`.trim()} data-testid="tools-empty">
      <Icon name={icon} className="pgc-empty__ico" />
      <div role="heading" aria-level="3" className="pgc-empty__title">{title}</div>
      {children}
    </div>
  );
}

// What the tool list says when there is no list. The reason is the discovery verdict the server gave, in words.
function EmptyState({ lab, onDiscover }) {
  const { discovery, busy, info, door } = lab;
  const name = lab.identity?.name;
  if (busy?.kind === "discover") {
    return (
      <div data-testid="tools-loading">
        <p className="pgc-note">Discovering tools… Asking {visible(door)} which tools it offers.</p>
        <div className="pgc-skel" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      </div>
    );
  }
  const v = discovery?.verdict;
  if (!v) {
    return (
      <Empty icon="list" title="No tools discovered yet">
        <p>Ask the gateway which tools {name ? <b>{visible(name)}</b> : "this key"} may use on this door.</p>
        {/* ui-pattern: allow P9 the lab's primary action is ink (red is only Sign in, owner rule); the card action, the Tools-tab action and Run are each the one primary of their own region (tab panels are hidden, not removed), which the checker cannot see */}
        <button type="button" className="pgc-go pgc-go-primary" onClick={onDiscover} data-testid="get-tools">Get MCP tools</button>
      </Empty>
    );
  }
  if (v.id === "blocked") {
    return (
      <Empty icon="lock" tone="pgc-empty--hold" title="No tools: blocked by policy">
        <p>The gateway refused discovery before any tool was listed. Nothing is wrong with the connection.</p>
        <div className="pgc-next"><h4>What would change this</h4><ul><li>{v.next?.[0] ? visible(v.next[0]) : "Ask a policy admin to add this caller to a policy for this door."}</li><li>Or switch door.</li></ul></div>
      </Empty>
    );
  }
  if (v.id === "upstream") return <Empty icon="unplug" title="No tools: the gateway could not be reached"><p>Nothing was refused. Try again from the card above.</p></Empty>;
  if (v.id === "needs-sign-in") return <Empty icon="key" title="No tools: the gateway did not accept the key"><p>No policy was reached. See the card above.</p></Empty>;
  if (v.id === "allowed") return <Empty icon="list" title="The gateway listed no tools on this door"><p>The call worked and the list is empty. Nothing to run on {visible(door)}.</p></Empty>;
  return <Empty icon="alert" title="No tools: the gateway answered with an error"><p>{visible(v.sentence)}</p></Empty>;
}

export default function ToolsTab({ lab, onPick, filterRef, onDiscover }) {
  const [filter, setFilter] = useState("");
  const tools = lab.hasTools ? lab.discovery.tools : null;
  const mock = lab.info.source === "mock";
  const rows = useMemo(() => (tools ?? []).filter((t) => String(t.name).toLowerCase().includes(filter.trim().toLowerCase())), [tools, filter]);
  if (!tools || tools.length === 0) return <EmptyState lab={lab} onDiscover={onDiscover} />;
  const permitted = tools.filter((t) => t.permitted === true).length;
  const refused = tools.filter((t) => t.permitted === false).length;
  const name = lab.identity?.name;
  return (
    <div data-testid="tools-panel">
      <label className="pgc-lbl" htmlFor="pgc-filter">Filter tools</label>
      <input id="pgc-filter" ref={filterRef} className="pgc-filter" type="search" placeholder="Filter tools..." autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="tool-filter" />
      <div className="pgc-count">
        <span data-testid="tool-count">{rows.length} of {tools.length} tools</span>
        {mock ? (
          <span className="pgc-permsum" data-testid="perm-summary">
            <span>{permitted} permitted</span>{refused > 0 && <span>{refused} not permitted</span>}<span>for {visible(name ?? "the caller")}</span>
          </span>
        ) : <span className="pgc-permsum" data-testid="perm-summary"><span>This lab cannot tell which of these the key may run. Run one to find out (inferred from the answer).</span></span>}
      </div>
      {rows.length === 0 ? (
        <p className="pgc-hint" data-testid="tools-nomatch">No tools match “{visible(filter)}”.</p>
      ) : (
        <ul className="pgc-tool-grid" data-testid="tool-grid">
          {rows.map((t) => {
            const n = Object.keys(t.args ?? {}).length;
            const no = t.permitted === false;
            return (
              <li key={t.name}>
                <button type="button" className="pgc-tool" data-refused={no || undefined} aria-pressed={lab.selectedTool === t.name} data-testid={`tool-${t.name}`} onClick={() => onPick(t.name)}>
                  <span className="pgc-tool__name"><Wrapped text={t.name} /></span>
                  <span className="pgc-tool__params">{n} param{n === 1 ? "" : "s"}</span>
                  {t.description && <span className="pgc-tool__desc">{visible(t.description)}</span>}
                  {no && <span className="pgc-tag pgc-tag--lock"><Icon name="lock" />Not permitted</span>}
                  {no && t.reason && <span className="pgc-tool__why">{visible(t.reason)}</span>}
                  {mock && !no && t.write && <span className="pgc-tag"><Icon name="hourglass" />Needs approval</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
