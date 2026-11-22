import React from "react";
import SequenceView from "../evidence/SequenceView.jsx";
import StepperBar from "./StepperBar.jsx";
import RunNote from "./RunNote.jsx";

// Sequence panel: the shared SequenceView (no drawn diagram here), with the one walkthrough's controls. The step detail that follows the walked
// message is its own non-modal FloatingDialog (section 8f), switched on and off from this bar.
export default function SequencePanel({ run, stepper, live, detailOn, onDetail }) {
  const hops = run?.hops ?? [];
  const toggle = (
    <button type="button" aria-pressed={detailOn} onClick={onDetail} data-testid="detail-toggle" title="A floating panel with the full detail of the message in focus">Step detail</button>
  );
  return (
    <div className="pgc-pane" data-testid="panel-sequence-body">
      <StepperBar stepper={stepper} live={live} extra={toggle} />
      <RunNote run={run} stepper={stepper} />
      {hops.length === 0
        ? <p className="pgc-emptynote" data-testid="sequence-none">No run yet. Get the tools or run one, and its messages are drawn here.</p>
        : <SequenceView hops={hops} selected={stepper.selected} onSelect={stepper.select} />}
    </div>
  );
}
