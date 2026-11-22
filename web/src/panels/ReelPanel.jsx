import React from "react";
import MovieReel from "../evidence/MovieReel.jsx";
import StepDetailPanel from "../evidence/StepDetailPanel.jsx";
import StepperBar from "./StepperBar.jsx";
import RunNote from "./RunNote.jsx";

// Movie reel panel: the shared MovieReel (every frame a button, arrow keys, Home, End) and the shared StepDetailPanel for the frame in focus,
// both fed by the one hop array and the one walkthrough. All data comes by props (this body is drawn in a second window when popped out).
export default function ReelPanel({ run, stepper, live }) {
  const hops = run?.hops ?? [];
  return (
    <div className="pgc-pane" data-testid="panel-reel-body">
      <StepperBar stepper={stepper} live={live} />
      <RunNote run={run} stepper={stepper} />
      {hops.length === 0
        ? <p className="pgc-emptynote" data-testid="reel-none">No run yet. Get the tools or run one, and its hops fill this reel.</p>
        : (<>
          <MovieReel hops={hops} selected={stepper.selected} onSelect={stepper.select} />
          {stepper.selected == null
            ? <p className="pgc-emptynote" data-testid="reel-pick">Press Simulate or Next, or click a frame, to see what happened at that hop.</p>
            : <StepDetailPanel hops={hops} selected={stepper.selected} onSelect={stepper.select} />}
        </>)}
    </div>
  );
}
