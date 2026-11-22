// The reducer behind the one walkthrough (section 8f): the same behaviour as the studio's, and what this lab relies on.
import { describe, expect, test } from "vitest";
import { initial, reduce, speedMs, SPEEDS, DEFAULT_SPEED } from "./stepper.js";

const run = (s, ...actions) => actions.reduce((st, a) => reduce(st, typeof a === "string" ? { type: a } : a), s);

describe("stepper reducer", () => {
  test("starts off: step -1, not paused, normal speed", () => {
    expect(initial(5)).toEqual({ total: 5, step: -1, paused: false, speed: DEFAULT_SPEED });
  });
  test("simulate starts at the first message, playing; with nothing to walk it stays off", () => {
    expect(reduce(initial(5), { type: "simulate" })).toMatchObject({ step: 0, paused: false });
    expect(reduce(initial(0), { type: "simulate" }).step).toBe(-1);
  });
  test("tick walks forward and pauses on the last message instead of looping", () => {
    let s = reduce(initial(3), { type: "simulate" });
    s = run(s, "tick", "tick");
    expect(s.step).toBe(2);
    s = run(s, "tick");
    expect(s).toMatchObject({ step: 2, paused: true });
  });
  test("tick does nothing while paused or off", () => {
    expect(reduce(initial(3), { type: "tick" }).step).toBe(-1);
    expect(run(initial(3), "simulate", "pause", "tick").step).toBe(0);
  });
  test("resume continues; from the last message it restarts at the first", () => {
    expect(run(initial(3), "simulate", "tick", "pause", "resume")).toMatchObject({ step: 1, paused: false });
    expect(run(initial(3), "simulate", "tick", "tick", "tick", "resume")).toMatchObject({ step: 0, paused: false });
  });
  test("next and prev are clamped to the ends and do nothing while off (the hook starts the walk)", () => {
    expect(reduce(initial(3), { type: "next" }).step).toBe(-1);
    expect(reduce(initial(3), { type: "prev" }).step).toBe(-1);
    expect(run(initial(3), "simulate", "prev").step).toBe(0);
    expect(run(initial(3), "simulate", "next", "next", "next", "next").step).toBe(2);
  });
  test("goto clamps, pauses, and does nothing for an empty run", () => {
    expect(reduce(initial(4), { type: "goto", step: 9 })).toMatchObject({ step: 3, paused: true });
    expect(reduce(initial(4), { type: "goto", step: -3 })).toMatchObject({ step: 0, paused: true });
    expect(reduce(initial(0), { type: "goto", step: 1 }).step).toBe(-1);
  });
  test("speed accepts only the three known speeds, and the milliseconds fall back to normal", () => {
    expect(reduce(initial(2), { type: "speed", speed: "fast" }).speed).toBe("fast");
    expect(reduce(initial(2), { type: "speed", speed: "warp" }).speed).toBe(DEFAULT_SPEED);
    expect(SPEEDS.map((s) => s.id)).toEqual(["slow", "normal", "fast"]);
    expect(speedMs("fast")).toBeLessThan(speedMs("normal"));
    expect(speedMs("nope")).toBe(speedMs("normal"));
  });
  test("stop turns it off; a new total starts over but keeps the chosen speed", () => {
    expect(run(initial(3), "simulate", "tick", "stop")).toMatchObject({ step: -1, paused: false });
    const s = run(initial(3), { type: "speed", speed: "slow" }, "simulate", "tick", { type: "total", total: 7 });
    expect(s).toEqual({ total: 7, step: -1, paused: false, speed: "slow" });
  });
});
