import React from "react";
import { SPEEDS } from "./stepper.js";
import Icon from "../Icon.jsx";

// The walkthrough controls of section 8f: Simulate / Pause / Resume, Prev, Next, Speed, Reset and the counter "Message N of M" (aria-live polite).
// Presentational: everything arrives by props, because a panel popped out into its own window is a separate React root with no shared context.
// The buttons are never disabled just because the walk has not started (only when there is nothing to walk); Next from a fresh page starts paused
// at message 1. `live` says whether THIS bar owns the announcement, so several open panels do not read the counter out several times.
export default function StepperBar({ stepper, live = false, extra = null, onReset = null }) {
  const none = stepper.total < 1;
  const label = !stepper.started ? "Simulate" : stepper.playing ? "Pause" : stepper.atStop ? "Replay" : "Resume";
  return (
    <div className="pgc-stepbar" role="toolbar" aria-label="Walkthrough controls" data-testid="stepper-bar">
      <button type="button" className="pgc-go" disabled={none} onClick={stepper.toggle} data-testid="step-toggle">
        <Icon name={stepper.playing ? "pause" : "play"} />{label}
      </button>
      <button type="button" disabled={none} onClick={stepper.prev} aria-label="Previous message" data-testid="step-prev">Prev</button>
      <button type="button" disabled={none} onClick={stepper.next} aria-label="Next message" data-testid="step-next">Next</button>
      <label className="pgc-stepbar__speed">Speed{" "}
        <select value={stepper.speed} onChange={(e) => stepper.setSpeed(e.target.value)} aria-label="Walkthrough speed" data-testid="step-speed">
          {SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={onReset ? false : none || !stepper.started} onClick={onReset ?? stepper.reset} data-testid="step-reset"
        title={onReset ? "Stop the walkthrough and put every box back where it started" : undefined}>Reset</button>
      {extra}
      <span className="pgc-stepbar__count" aria-live={live ? "polite" : "off"} aria-atomic="true" data-testid="step-counter">{stepper.counter}</span>
    </div>
  );
}
