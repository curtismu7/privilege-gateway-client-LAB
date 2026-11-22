import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { initial, reduce, speedMs, SPEEDS } from "./stepper.js";

// ONE walkthrough for every panel (section 8f). It walks the ordered demo-hop/1 array of the latest run, the same array the movie reel, the
// token sequence and the sequence view draw. The pure reducer (stepper.js) owns the state; this hook only drives the timer and maps a step
// number to a hop number. Hops that did not run (verdict skip) are not walked; they stay behind the shared "hops not in this run" chip.
const EMPTY = [];

// Where Simulate stops. A run that was refused, held or failed ends at the hop where it ended; Next goes on to the rest (the reply).
//   upstream error: the tool hop that failed        held: the hop that waits for the human        refused / needs sign-in / bad request: the
//   Privilege decision hop (or the first hop that failed)        anything else: the last hop.
export function planRun(hops = EMPTY, verdictId = null) {
  const ran = (Array.isArray(hops) ? hops : EMPTY).filter((h) => h.verdict !== "skip");
  const last = (p) => { for (let i = ran.length - 1; i >= 0; i -= 1) if (p(ran[i])) return i; return -1; };
  const first = (p) => ran.findIndex(p);
  let at = -1;
  if (verdictId === "upstream") at = last((h) => h.kind === "tool-dispatched" && h.verdict === "deny");
  else if (verdictId === "held") at = last((h) => h.verdict === "held");
  else if (verdictId === "blocked" || verdictId === "needs-sign-in" || verdictId === "bad-request") at = first((h) => h.kind === "authorize-decision" && h.verdict === "deny");
  if (at < 0 && verdictId !== "allowed") at = first((h) => h.verdict === "deny" || h.verdict === "held");
  const stop = at >= 0 ? at : Math.max(ran.length - 1, 0);
  return { ran, ns: ran.map((h) => h.n), stop, stopsEarly: at >= 0 && at < ran.length - 1, stopHop: ran[stop] ?? null, all: Array.isArray(hops) ? hops : EMPTY };
}

export const counterText = ({ total, step, extra }) => {
  if (total < 1) return "No run yet";
  if (extra != null) return `Message ${extra}, not in this run`;
  return step >= 0 ? `Message ${step + 1} of ${total}` : `Not started, ${total} messages`;
};

export function useRunStepper(hops = EMPTY, verdictId = null) {
  const plan = useMemo(() => planRun(hops, verdictId), [hops, verdictId]);
  const total = plan.ns.length;
  const [s, dispatch] = useReducer(reduce, total, initial);
  const [extra, setExtra] = useState(null); // a hop that did not run, picked from the "not in this run" chip

  // A new run starts the walk over (a new array, even of the same length).
  useEffect(() => { dispatch({ type: "total", total }); setExtra(null); }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // The timer. At the stop hop it pauses instead of ticking.
  useEffect(() => {
    if (s.step < 0 || s.paused) return undefined;
    const id = setTimeout(() => dispatch({ type: s.step >= plan.stop ? "pause" : "tick" }), speedMs(s.speed));
    return () => clearTimeout(id);
  }, [s.step, s.paused, s.speed, plan.stop]);

  const playing = s.step >= 0 && !s.paused;
  const simulate = useCallback(() => { setExtra(null); dispatch({ type: "simulate", total }); }, [total]);
  const toggle = useCallback(() => {
    if (total < 1) return;
    if (s.step < 0 || (s.paused && s.step >= plan.stop)) { simulate(); return; }
    setExtra(null);
    dispatch({ type: playing ? "pause" : "resume" });
  }, [total, s.step, s.paused, plan.stop, playing, simulate]);
  // Next / Prev from a fresh page start the walk PAUSED at message 1; stepping by hand always pauses a running walk.
  const startPaused = useCallback(() => { setExtra(null); dispatch({ type: "simulate", total }); dispatch({ type: "pause" }); }, [total]);
  const next = useCallback(() => { if (total < 1) return; if (s.step < 0) { startPaused(); return; } setExtra(null); dispatch({ type: "pause" }); dispatch({ type: "next" }); }, [total, s.step, startPaused]);
  const prev = useCallback(() => { if (total < 1) return; if (s.step < 0) { startPaused(); return; } setExtra(null); dispatch({ type: "pause" }); dispatch({ type: "prev" }); }, [total, s.step, startPaused]);
  const reset = useCallback(() => { setExtra(null); dispatch({ type: "stop" }); }, []);
  const setSpeed = useCallback((speed) => dispatch({ type: "speed", speed }), []);
  // Clicking a frame, a row or an actor-card step: the same walkthrough, paused on that hop.
  const select = useCallback((n) => {
    const at = plan.ns.indexOf(n);
    if (at >= 0) { setExtra(null); dispatch({ type: "goto", step: at }); return; }
    if (plan.all.some((h) => h.n === n)) { setExtra(n); dispatch({ type: "pause" }); }
  }, [plan]);

  const selected = extra ?? (s.step >= 0 ? plan.ns[s.step] ?? null : null);
  return {
    hops: plan.all, total, step: s.step, playing, paused: s.paused, started: s.step >= 0, speed: s.speed, selected,
    counter: counterText({ total, step: s.step, extra }), atStop: s.step >= plan.stop,
    stopsEarly: plan.stopsEarly, stopHop: plan.stopHop,
    toggle, simulate, next, prev, reset, setSpeed, select,
  };
}
