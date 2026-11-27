import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { visible } from "./safeText.js";

// How long the tool boxes keep the "just arrived" tint after the gateway's list fills in (owner, 2026-11-27: make them clearly new, and scroll to them).
export const FRESH_MS = 6000;

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

const NAME_OK = /^[A-Za-z0-9_.-]{1,64}$/;

// A tool the list does not show can still be called: the gateway, not the list, decides. Arguments are empty, so only the gateway's own answer is seen.
function ByName({ lab, onRunByName }) {
  const [text, setText] = useState("");
  const name = text.trim();
  const ok = NAME_OK.test(name);
  const working = Boolean(lab.busy);
  return (
    <form className="pgc-byname" data-testid="by-name" onSubmit={(e) => { e.preventDefault(); if (ok && !working) onRunByName(name); }}>
      <label className="pgc-lbl" htmlFor="pgc-byname">Run a tool by name</label>
      <div className="pgc-byname__row">
        <input id="pgc-byname" className="pgc-filter" type="text" placeholder="A tool name, listed or not" autoComplete="off" spellCheck={false} maxLength={64} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="pgc-byname-note" data-testid="by-name-input" />
        <button type="submit" className="pgc-go" disabled={!ok || working} data-testid="by-name-run">Run</button>
      </div>
      <p id="pgc-byname-note" className="pgc-note" data-testid="by-name-note">{name && !ok ? "Use letters, digits, dot, dash and underscore, up to 64 characters." : "Sends the call with no arguments, so the gateway's decision is what you see."}</p>
    </form>
  );
}

export default function ToolsTab({ lab, onPick, filterRef, onDiscover, onRunByName }) {
  const [filter, setFilter] = useState("");
  const tools = lab.hasTools ? lab.discovery.tools : null;
  const mock = lab.info.source === "mock";
  const rows = useMemo(() => (tools ?? []).filter((t) => String(t.name).toLowerCase().includes(filter.trim().toLowerCase())), [tools, filter]);

  // "Just arrived": each new discovery result (not a keystroke in the filter, and not a list that was already there when this mounted)
  // tints the boxes for FRESH_MS and scrolls the first box into view once. Reduced motion gets an instant jump, no smooth scroll.
  const gridRef = useRef(null);
  const panelRef = useRef(null);
  const atMount = useRef(lab.discovery);
  const [fresh, setFresh] = useState(false);
  const arrived = Boolean(tools && tools.length > 0);
  useEffect(() => {
    // Not a new list (none at all, or the one that was here at mount): the tint must be off, whatever an earlier timer was doing.
    if (!arrived || lab.discovery === atMount.current) { setFresh(false); return undefined; }
    setFresh(true);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    (gridRef.current ?? panelRef.current)?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const t = setTimeout(() => setFresh(false), FRESH_MS);
    return () => clearTimeout(t);
  }, [lab.discovery, arrived]);

  // The tint is colour only, so say it in words too: a polite live region that always exists (a region added together with its text is often not read).
  const arrivedNote = (
    <span className="pgc-sr" role="status" aria-live="polite" data-testid="tools-arrived">
      {fresh && arrived ? `${tools.length} tool${tools.length === 1 ? "" : "s"} just arrived` : ""}
    </span>
  );
  if (!tools || tools.length === 0) return <>{arrivedNote}<EmptyState lab={lab} onDiscover={onDiscover} /></>;
  const name = lab.identity?.name;
  return (
    <>
    {arrivedNote}
    <div data-testid="tools-panel" ref={panelRef}>
      <label className="pgc-lbl" htmlFor="pgc-filter">Filter tools</label>
      <input id="pgc-filter" ref={filterRef} className="pgc-filter" type="search" placeholder="Filter tools..." autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="tool-filter" />
      <div className="pgc-count">
        <span data-testid="tool-count">{rows.length} of {tools.length} tools listed</span>
        <span className="pgc-permsum" data-testid="perm-summary">
          {mock
            ? <span>The gateway lists only what the grant allows for {visible(name ?? "the caller")}. A tool that is not listed is refused when called.</span>
            : <span>The reply does not say which tools the key may run. Run one to find out (inferred from the answer).</span>}
        </span>
      </div>
      <ByName lab={lab} onRunByName={onRunByName} />
      {rows.length === 0 ? (
        <p className="pgc-hint" data-testid="tools-nomatch">No tools match “{visible(filter)}”.</p>
      ) : (
        <ul className="pgc-tool-grid" data-testid="tool-grid" ref={gridRef} data-fresh={fresh ? "true" : undefined}>
          {rows.map((t) => {
            const n = Object.keys(t.args ?? {}).length;
            return (
              <li key={t.name}>
                <button type="button" className={fresh ? "pgc-tool pgc-tool--fresh" : "pgc-tool"} aria-pressed={lab.selectedTool === t.name} data-testid={`tool-${t.name}`} onClick={() => onPick(t.name)}>
                  <span className="pgc-tool__name"><Wrapped text={t.name} /></span>
                  <span className="pgc-tool__params">{n} param{n === 1 ? "" : "s"}</span>
                  {t.description && <span className="pgc-tool__desc">{visible(t.description)}</span>}
                  {mock && t.write && <span className="pgc-tag"><Icon name="hourglass" />Needs approval</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </>
  );
}
