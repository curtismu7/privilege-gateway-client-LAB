import React, { useCallback, useMemo, useState } from "react";
import StepperBar from "./StepperBar.jsx";
import CallPathDiagram from "./CallPathDiagram.jsx";
import { callPathDiagram, stepForHop } from "../diagrams/callPath.js";
import { visible } from "../safeText.js";

// Diagram panel: how a tool call travels, as a ReactFlow box diagram drawn from diagram-studio data (diagrams/pgc-call-path.json). It follows the ONE
// walkthrough: the hop in focus lights its arrow (steps[].hop in the data names the hop kind), and the run's own path and outcome stay marked. Boxes are
// movable (the places are kept by the dock, so closing and reopening the panel keeps them); Reset puts them back. Props only: a popped-out panel has no context.
export default function DiagramPanel({ run, stepper, live, diagram: given, boxes, onMoveBox, onResetBoxes }) {
  const diagram = useMemo(() => given ?? callPathDiagram(), [given]);
  const [open, setOpen] = useState(null);
  const [refit, setRefit] = useState(0);
  const [localMoved, setLocalMoved] = useState({});
  const moved = boxes ?? localMoved;
  const onMove = useCallback((id, p) => (onMoveBox ? onMoveBox(id, p) : setLocalMoved((m) => ({ ...m, [id]: { x: p.x, y: p.y } }))), [onMoveBox]);
  const reset = () => { stepper.reset(); (onResetBoxes ?? (() => setLocalMoved({})))(); setOpen(null); setRefit((r) => r + 1); };
  const hops = run?.hops ?? [];
  const hop = stepper.selected != null ? hops.find((h) => h.n === stepper.selected) : null;
  const at = hop && diagram ? stepForHop(diagram, hop) : -1;
  const step = at >= 0 ? diagram.steps[at] : null;
  const movedCount = Object.keys(moved).length;
  const caption = step ? `${step.title}. ${step.what} ${step.why ?? ""}` : "";
  if (!diagram) return <p className="pgc-emptynote" data-testid="dg-missing">The call-path diagram data could not be loaded.</p>;
  return (
    <div className="pgc-pane pgc-pane--fill" data-testid="panel-diagram-body">
      <StepperBar stepper={stepper} live={live} onReset={reset} />
      <div className="pgc-dgnow" data-testid="dg-now" aria-live="off" title={caption}>
        {hop ? (
          step
            ? <><strong>{visible(step.title)}</strong> <span>{visible(step.what)}</span></>
            : <><strong>{visible(hop.title ?? hop.kind)}</strong> <span>This message has no arrow of its own on the diagram.</span></>
        ) : hops.length
          ? <span><strong>{visible(run.verdict.word)}.</strong> Press Simulate or Next to walk this run along the path: the arrows it went along stay solid, the others are dimmed.{stepper.stopsEarly ? ` Simulate stops at message ${stepper.stopHop.n}, ${visible(stepper.stopHop.title)}, where this run ended.` : ""}</span>
          : <span>{visible(diagram.lede)}</span>}
      </div>
      <CallPathDiagram diagram={diagram} hops={hops} verdictId={run?.verdict?.id ?? null} selectedHop={stepper.selected} moved={moved} onMove={onMove} open={open} setOpen={setOpen} refit={refit} />
      <p className="pgc-dgnote" data-testid="dg-note" title="Drag a box to move it, drag the background to pan, click a box to expand it. Reset puts every box back. This panel does not pop out into a window: React Flow cannot measure boxes in another window.">Drag a box, click to expand. {movedCount ? `${movedCount} box${movedCount === 1 ? "" : "es"} moved; Reset puts them back.` : "Reset puts every box back."} No pop-out: React Flow cannot measure boxes in another window.</p>
    </div>
  );
}
