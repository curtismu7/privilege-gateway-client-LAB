// Where the Talk track opens the first time. The shared dialog opens at the very top right of the window, which covers the header's controls
// (Mode, Reset, Sign in). Nothing may be added to the vendored dialog, so the saved place it reads is filled in before it is first shown: below the
// header, at the right, above the dock. A place the person has already set or moved is never touched. A browser that cannot store anything
// still gets the computed place (see below); the person can drag it away.
export const TALK_W = 430;
const MARGIN = 16;

// The place itself, computed: below the header, at the right, above the dock. null on a phone (a bottom sheet; no place to choose).
export function talkPlace({ vp = { w: window.innerWidth, h: window.innerHeight }, headerBottom = 72, dockH = 56 } = {}) {
  if (vp.w <= 600) return null;
  const w = Math.min(TALK_W, vp.w - 2 * MARGIN);
  const y = Math.round(headerBottom + 10);
  const h = Math.max(260, Math.min(620, vp.h - y - dockH - 12));
  return { x: Math.max(8, vp.w - w - MARGIN), y, w, h };
}

// The same place remembered, so a reload opens it where it was. The dialog is also given the place as its DEFAULT (TalkTrack `place`), so a browser
// that cannot store anything (a private window) still opens it below the header and not at the shared default (top right, over the controls).
export function seedTalkPlace(key, opts = {}) {
  try {
    if (window.localStorage.getItem(key) != null) return false;
    const p = talkPlace(opts);
    if (!p) return false;
    window.localStorage.setItem(key, JSON.stringify({ pos: { x: p.x, y: p.y }, size: { w: p.w, h: p.h } }));
    return true;
  } catch { return false; }
}
