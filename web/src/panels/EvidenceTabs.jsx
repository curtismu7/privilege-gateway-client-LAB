import React, { useEffect, useRef, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog.jsx";
import StepDetailPanel from "../evidence/StepDetailPanel.jsx";
import Icon from "../Icon.jsx";
import ReelPanel from "./ReelPanel.jsx";
import TokensPanel from "./TokensPanel.jsx";
import SequencePanel from "./SequencePanel.jsx";
import DiagramPanel from "./DiagramPanel.jsx";
import TracePanel from "./TracePanel.jsx";
import { runLook } from "../verdictView.js";
import { releaseDialogFocus } from "./autoFocus.js";

// The evidence views inline, in one tabbed section under the verdict card (the shape the Appfire Agent Governance lab uses): one tab per view, the
// selected view drawn in place — no floating dialogs for the views themselves. The one walkthrough (useRunStepper in App) feeds every view, so the
// reel, the token sequence, the sequence view and the diagram all follow the same hop. The Sequence view's optional Step detail stays its own small
// floating dialog, and the Talk track keeps its place in the top menu.
export const PANELS = [
  { id: "reel", label: "Movie reel", icon: "film", Body: ReelPanel },
  { id: "tokens", label: "Token sequence", icon: "key", Body: TokensPanel },
  { id: "sequence", label: "Sequence", icon: "seq", Body: SequencePanel },
  { id: "diagram", label: "Diagram", icon: "diagram", Body: DiagramPanel },
  { id: "trace", label: "Gateway trace", icon: "doc", Body: TracePanel },
];
const STEPPED = new Set(["reel", "tokens", "sequence", "diagram"]);

export default function EvidenceTabs({ run, stepper, presenter = false }) {
  const [active, setActive] = useState("reel");
  const [detailOn, setDetailOn] = useState(false);
  const [boxes, setBoxes] = useState({});
  const refs = useRef({});
  const moveBox = (id, p) => setBoxes((b) => ((b[id]?.x === p.x && b[id]?.y === p.y) ? b : { ...b, [id]: { x: p.x, y: p.y } }));
  const resetBoxes = () => setBoxes({});

  // The step detail dialog is switched on from the Sequence view's bar; a mode or door change (a new panel generation) closes it.
  useEffect(() => { setDetailOn(false); }, [run?.id]);

  const onKey = (e, i) => {
    let next = null;
    if (e.key === "ArrowRight") next = (i + 1) % PANELS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + PANELS.length) % PANELS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PANELS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(PANELS[next].id);
    refs.current[PANELS[next].id]?.focus();
  };

  const look = runLook(run);
  const { Body } = PANELS.find((p) => p.id === active);
  const live = STEPPED.has(active); // the stepbar of a stepped view announces; otherwise the row's counter does

  return (
    <section className={`pgc-etabs pgc-calm${look.refusal ? " pgc-calm--refusal" : ""}${look.red ? " pgc-calm--red" : ""}`} aria-label="Evidence views" data-testid="evidence-tabs">
      <div className="pgc-etabs__bar">
        <div role="tablist" aria-label="Evidence views" className="pgc-etabs__tabs">
          {PANELS.map((p, i) => (
            <button key={p.id} type="button" role="tab" id={`etab-${p.id}`} aria-controls={`epanel-${p.id}`} aria-selected={active === p.id}
              tabIndex={active === p.id ? 0 : -1} ref={(el) => { refs.current[p.id] = el; }} onClick={() => setActive(p.id)} onKeyDown={(e) => onKey(e, i)}
              data-testid={`etab-${p.id}`}>
              <Icon name={p.icon} />{p.label}
            </button>
          ))}
        </div>
        <span className="pgc-etabs__count" aria-live={live ? "off" : "polite"} aria-atomic="true" data-testid="evidence-counter">{stepper.counter}</span>
      </div>
      <div role="tabpanel" id={`epanel-${active}`} aria-labelledby={`etab-${active}`} data-testid={`epanel-${active}`} className="pgc-etabs__body">
        <Body run={run} stepper={stepper} live={live} detailOn={detailOn} onDetail={() => setDetailOn(true)} boxes={boxes} onMoveBox={moveBox} onResetBoxes={resetBoxes} />
      </div>

      {detailOn && (
        <FloatingDialog isOpen onClose={() => setDetailOn(false)} noBackdrop
          title={<><Icon name="list" />Step detail</>} ariaLabel="Step detail panel" closeAriaLabel="Close Step detail. It hides; its place and size are kept."
          className="pgc-fd" defaultWidth={480} defaultHeight={480} minWidth={320} minHeight={240}
          storageKey="pgc.panel.detail" singletonKey="pgc-panel-detail" footer={null} testId="panel-detail" zIndex={1010}>
          <div className="pgc-pane">
            {stepper.selected == null
              ? <p className="pgc-emptynote" data-testid="detail-pick">Walk the sequence (Simulate or Next) or click a message, and its full detail follows here.</p>
              : <StepDetailPanel hops={run?.hops ?? []} selected={stepper.selected} onSelect={stepper.select} />}
          </div>
        </FloatingDialog>
      )}
      {presenter ? null : null}
    </section>
  );
}

