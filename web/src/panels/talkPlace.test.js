import { afterEach, describe, expect, test } from "vitest";
import { seedTalkPlace, talkPlace, TALK_W } from "./talkPlace.js";

// N3 (fix pass): the Talk track's first place is computed, not only stored, so a browser that cannot store anything (a private window, blocked site
// data) opens it below the header just the same.
const vp = { w: 1440, h: 900 };
afterEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });

describe("Talk track place", () => {
  test("below the header, at the right, above the dock, whatever the storage does", () => {
    const p = talkPlace({ vp, headerBottom: 112, dockH: 56 });
    expect(p.y).toBeGreaterThanOrEqual(112);
    expect(p.x + p.w).toBeLessThanOrEqual(vp.w);
    expect(p.y + p.h).toBeLessThanOrEqual(vp.h - 56);
    expect(p.w).toBe(TALK_W);
  });
  test("a phone gets no place (a bottom sheet)", () => { expect(talkPlace({ vp: { w: 375, h: 812 }, headerBottom: 120, dockH: 100 })).toBeNull(); });
  test("seeding stores the same place, and never overwrites one the person has set", () => {
    expect(seedTalkPlace("k", { vp, headerBottom: 112, dockH: 56 })).toBe(true);
    const saved = JSON.parse(window.localStorage.getItem("k"));
    const p = talkPlace({ vp, headerBottom: 112, dockH: 56 });
    expect(saved).toEqual({ pos: { x: p.x, y: p.y }, size: { w: p.w, h: p.h } });
    window.localStorage.setItem("k", "mine");
    expect(seedTalkPlace("k", { vp, headerBottom: 112, dockH: 56 })).toBe(false);
    expect(window.localStorage.getItem("k")).toBe("mine");
  });
  test("storage that throws does not break seeding", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
    try { expect(seedTalkPlace("k", { vp, headerBottom: 112, dockH: 56 })).toBe(false); } finally { if (real) Object.defineProperty(window, "localStorage", real); else delete window.localStorage; }
  });
});
