import React, { useCallback, useEffect, useRef, useState } from "react";
import FloatingDialog, { NARROW_QUERY } from "../floating-dialog/FloatingDialog.jsx";
import StepDetailPanel from "../evidence/StepDetailPanel.jsx";
import Icon from "../Icon.jsx";
import ReelPanel from "./ReelPanel.jsx";
import TokensPanel from "./TokensPanel.jsx";
import SequencePanel from "./SequencePanel.jsx";
import DiagramPanel from "./DiagramPanel.jsx";
import TracePanel from "./TracePanel.jsx";
import { TALK_W } from "./talkPlace.js";
import { runLook } from "../verdictView.js";
import { releaseDialogFocus } from "./autoFocus.js";

// The Panels dock: one button per evidence panel (icon and label), each panel a non-modal FloatingDialog with its own storageKey and singletonKey
// (drag by the title, resize from the edges, keyboard move and resize, Escape, a remembered size and place, a bottom sheet at 600px, a real
// pop-out window; the Diagram panel has none: React Flow cannot measure its boxes in another window, so they would stay hidden). Every panel body is a function of its props alone, because a popped-out panel is a separate React root with no shared context.
//
// Close hides the panel and keeps its place and size (the dialog stays mounted, and the shared dialog saves them). A panel opens BESIDE the
// verdict and the actions, never over them: the first time it opens, it is put below the verdict card, at the right, as high as the screen allows.
export const PANELS = [
  { id: "reel", label: "Movie reel", icon: "film", w: 780, h: 480, Body: ReelPanel },
  { id: "tokens", label: "Token sequence", icon: "key", w: 700, h: 480, Body: TokensPanel },
  { id: "sequence", label: "Sequence", icon: "seq", w: 960, h: 500, Body: SequencePanel },
  { id: "diagram", label: "Diagram", icon: "diagram", w: 950, h: 640, Body: DiagramPanel, popOut: false },
  { id: "trace", label: "Gateway trace", icon: "doc", w: 700, h: 480, Body: TracePanel },
];
const DETAIL = { w: 480, h: 480 };
const MARGIN = 16;
const MIN_TOP = 96;
const SHORT_VIEWPORT = 560;

const hasSaved = (id) => { try { return window.localStorage.getItem(`pgc.panel.${id}`) != null; } catch { return false; } };
const rect = (sel) => (typeof document === "undefined" ? null : document.querySelector(sel)?.getBoundingClientRect() ?? null);

// Where a panel first opens: below the verdict card (so the verdict and its actions stay in view), at the right. `k` is how many panels are already
// open: each steps down a little, so every title bar stays reachable. (The panels are wide because the shared reel and sequence toolbars are; on a
// 1440 screen the two right-hand tabs can be under a panel until it is moved. The verdict, its buttons and Run are not.)
export function placeFor({ w, h }, k = 0, vp = { w: window.innerWidth, h: window.innerHeight }, dockH = rect(".pgc-dock")?.height ?? 56, cardBottom = rect('[data-testid="verdict-card"]')?.bottom ?? null, reserve = 0) {
  // A short viewport (200% zoom of a laptop window is about 720x450) has no room to keep clear of the header: the panel takes the room above the dock.
  const top = vp.h < SHORT_VIEWPORT ? 8 : Math.max(MIN_TOP, Math.min(cardBottom != null ? Math.round(cardBottom + 12) : MIN_TOP, vp.h - dockH - 260));
  const width = Math.min(w, vp.w - 2 * MARGIN - reserve);
  const y = top + Math.min(k, vp.h < SHORT_VIEWPORT ? 0 : 4) * 30;
  const height = Math.max(240, Math.min(h, vp.h - y - dockH - 12));
  return { x: Math.max(8, vp.w - reserve - width - MARGIN), y, w: width, h: height };
}

// A panel needs room to be read: at least this tall. When the verdict card leaves less than that below it, the page is scrolled up just far enough
// (never past the card's own top, so the verdict stays fully in view) to make room, before the panel is placed.
const ROOM = 400;
export function scrollForRoom(vp = { w: window.innerWidth, h: window.innerHeight }, inset = 8) {
  const card = rect('[data-testid="verdict-card"]');
  if (!card) return;
  const dockH = rect(".pgc-dock")?.height ?? 56;
  const free = vp.h - dockH - 12 - (card.bottom + 12);
  const shortfall = ROOM - free;
  const canScroll = Math.max(0, card.top - inset);
  const by = Math.min(shortfall, canScroll);
  if (by > 0 && typeof window.scrollBy === "function") window.scrollBy({ top: by, left: 0, behavior: "instant" });
}

function useNarrowQuery() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

// Presenter mode pre-arranges the page: the Movie reel opens beside the Talk track (which keeps the right edge), clear of the identity rail.
const RAIL_CLEAR = 372;
const MIN_PRESENTER_W = 420;
export function presenterSpec(panel, vp = { w: window.innerWidth, h: window.innerHeight }) {
  const reserve = TALK_W + MARGIN;
  const w = Math.min(panel.w, vp.w - reserve - RAIL_CLEAR);
  return w >= MIN_PRESENTER_W ? { spec: { ...panel, w }, reserve } : { spec: panel, reserve: 0 };
}

export default function PanelDock({ run, stepper, onTalkTrack = null, talkActive = false, presenter = false }) {
  const [open, setOpen] = useState({});     // id -> boolean: shown
  const [seen, setSeen] = useState({});     // id -> placement: a panel that has been opened once stays mounted, so Close keeps its place
  const [boxes, setBoxes] = useState({});    // the Diagram panel's moved boxes: id -> { x, y }. Kept here because a closed panel's body is unmounted; Reset empties it
  const moveBox = useCallback((id, p) => setBoxes((b) => ((b[id]?.x === p.x && b[id]?.y === p.y) ? b : { ...b, [id]: { x: p.x, y: p.y } })), []);
  const resetBoxes = useCallback(() => setBoxes({}), []);
  const [detailOn, setDetailOn] = useState(false);
  const [detailAt, setDetailAt] = useState(null);
  const [front, setFront] = useState(null);   // the panel last opened or touched is drawn on top (the dialogs are stacked by this, not by DOM order)
  const narrow = useNarrowQuery();
  const dockRef = useRef(null);

  // Keep the page's last line clear of the dock: its height is a custom property the stylesheet reads.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty("--pgc-dock-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty("--pgc-dock-h"); };
  }, []);

  // Touching a panel (press or focus anywhere inside it) brings it to the front, so a panel under another is reached by its title bar.
  useEffect(() => {
    const on = (e) => { const id = e.target?.closest?.('.fd-panel[data-testid^="panel-"]')?.getAttribute("data-testid")?.slice(6); if (id) setFront(id); };
    document.addEventListener("pointerdown", on, true);
    document.addEventListener("focusin", on, true);
    return () => { document.removeEventListener("pointerdown", on, true); document.removeEventListener("focusin", on, true); };
  }, []);

  const presenterRef = useRef(presenter);
  presenterRef.current = presenter;
  const show = useCallback((id) => {
    // A panel the person has not moved or resized (nothing saved for it) is placed afresh each time it opens, because the verdict card above it
    // changes height from one run to the next; one they have moved keeps its place. A new `gen` remounts the (closed) dialog with the new defaults.
    if (!narrow && !open[id] && !hasSaved(id) && !seen[id]?.moved) scrollForRoom(undefined, presenterRef.current ? Math.ceil((rect(".banner")?.height ?? 0)) + 16 : 8);
    if (!seen[id] || (!open[id] && !hasSaved(id) && !seen[id].moved)) {
      const k = Object.keys(open).filter((x) => open[x]).length;
      const panel = PANELS.find((p) => p.id === id);
      const arranged = presenterRef.current && !narrow ? presenterSpec(panel) : { spec: panel, reserve: 0 };
      const at = placeFor(arranged.spec, narrow ? 0 : k, undefined, undefined, undefined, arranged.reserve);
      setSeen((s) => ({ ...s, [id]: { ...at, gen: (s[id]?.gen ?? 0) + 1 } }));
    }
    // On a phone every panel is a full-width sheet, so only one is open at a time.
    setOpen((o) => (narrow ? { [id]: true } : { ...o, [id]: true }));
    setFront(id);
    if (narrow) setDetailOn(false);
  }, [narrow, open, seen]);
  // Close hides. The dialog stays mounted, so its place and size stay in memory; if the person moved or resized it, remember that here too, so a
  // browser that cannot store anything (a private window) does not get it re-placed on the next open.
  const hide = useCallback((id) => {
    const st = document.querySelector(`[data-testid="panel-${id}"]`)?.style;
    const num = (k) => Number.parseFloat(st?.getPropertyValue(k));
    const now = st ? { x: num("--fd-x"), y: num("--fd-y"), w: num("--fd-w"), h: num("--fd-h") } : null;
    setSeen((s) => {
      const a = s[id];
      if (!a || !now || a.moved) return s;
      const moved = ["x", "y", "w", "h"].some((k) => Number.isFinite(now[k]) && now[k] !== a[k]);
      return moved ? { ...s, [id]: { ...a, moved: true } } : s;
    });
    setOpen((o) => ({ ...o, [id]: false }));
  }, []);
  // An open panel that is under another is brought forward by its dock button (a title bar can be under a taller panel); one already in front is hidden.
  const toggle = (id) => {
    if (!open[id]) { show(id); return; }
    if (front !== id) { setFront(id); document.querySelector(`[data-testid="panel-${id}"]`)?.focus(); return; }
    hide(id);
  };

  // Presenter mode opens the Movie reel beside the Talk track once there is a run to show (it is placed under the verdict card as it is then, not as the
  // empty page was). It happens once per presenter session: a person who closes it is not fought. A phone shows the talk track only.
  const showRef = useRef(show);
  showRef.current = show;
  const autoRef = useRef(false);
  useEffect(() => { if (!presenter) autoRef.current = false; }, [presenter]);
  useEffect(() => {
    if (!presenter || narrow || autoRef.current || !run?.id || !talkActive) return undefined;
    // After the talk track has opened and the page has made room for it (the card changes height then), so the reel is placed under the card as it is.
    const id = setTimeout(() => { autoRef.current = true; showRef.current("reel"); setTimeout(releaseDialogFocus, 120); }, 80);
    return () => clearTimeout(id);
  }, [presenter, narrow, run?.id, talkActive]);

  // One announcement of "Message N of M": the first open stepped panel owns it, else the dock does.
  const liveOwner = ["reel", "sequence", "diagram", "tokens"].find((id) => open[id]) ?? "dock";

  const toggleDetail = () => {
    if (detailOn) { setDetailOn(false); return; }
    // First time: to the left of the Sequence panel, at its height, so the two sit side by side.
    setDetailAt((d) => {
      if (d) return d;
      const base = placeFor(DETAIL, 0);
      const seq = seen.sequence;
      if (!seq) return base;
      const w = Math.max(320, Math.min(base.w, seq.x - 16)); // as wide as the room at the left of the Sequence panel allows (never under 320)
      return { ...base, w, x: Math.max(8, seq.x - w - 8), y: seq.y, h: Math.min(base.h, seq.h) };
    });
    setDetailOn(true);
  };

  // The panels' look follows the run: a refusal (blocked, needs sign-in) carries a lock beside its word; a Real upstream failure is the one red case.
  const look = runLook(run);
  const dialogClass = `pgc-fd${look.refusal ? " pgc-fd--refusal" : ""}${look.red ? " pgc-fd--red" : ""}`;

  return (
    <>
      <nav className="pgc-dock" ref={dockRef} aria-label="Evidence panels" data-testid="panel-dock">
        <span className="pgc-dock__lbl">Panels</span>
        <div className="pgc-dock__btns" role="group" aria-label="Open an evidence panel">
          {PANELS.map((p) => (
            <button key={p.id} type="button" aria-pressed={Boolean(open[p.id])} onClick={() => toggle(p.id)} data-testid={`dock-${p.id}`}
              title={open[p.id] ? (front === p.id ? `${p.label} is open. Press to hide it; its place is kept.` : `${p.label} is open behind another panel. Press to bring it forward.`) : `Open ${p.label}`}>
              <Icon name={p.icon} />{p.label}
            </button>
          ))}
          <button type="button" aria-pressed={talkActive} disabled={!onTalkTrack} onClick={onTalkTrack ?? undefined} data-testid="dock-talk" title={talkActive ? "The talk track is open. Press to hide it." : "Open the presenter script (movable, resizable, can pop out)"}>
            <Icon name="mic" />Talk track
          </button>
        </div>
        <span className="pgc-dock__count" aria-live={liveOwner === "dock" ? "polite" : "off"} aria-atomic="true" data-testid="dock-counter">{stepper.counter}</span>
      </nav>

      {PANELS.map(({ id, label, w, h, Body, popOut }) => {
        const at = seen[id];
        if (!at) return null;
        return (
          <FloatingDialog key={`${id}-${at.gen}`} isOpen={Boolean(open[id])} onClose={() => hide(id)} noBackdrop
            title={<><Icon name={PANELS.find((p) => p.id === id).icon} />{label}</>} ariaLabel={`${label} panel`}
            closeAriaLabel={`Close ${label}. It hides; its place and size are kept.`}
            className={dialogClass}
            defaultWidth={at.w} defaultHeight={at.h} defaultX={at.x} defaultY={at.y} minWidth={320} minHeight={240} disablePopOut={popOut === false}
            storageKey={`pgc.panel.${id}`} singletonKey={`pgc-panel-${id}`} footer={null} testId={`panel-${id}`} zIndex={front === id ? 1010 : 1000}>
            <Body run={run} stepper={stepper} live={liveOwner === id} detailOn={detailOn} onDetail={toggleDetail} boxes={boxes} onMoveBox={moveBox} onResetBoxes={resetBoxes} />
          </FloatingDialog>
        );
      })}

      {detailAt && (
        <FloatingDialog isOpen={detailOn && Boolean(open.sequence)} onClose={() => setDetailOn(false)} noBackdrop
          title={<><Icon name="list" />Step detail</>} ariaLabel="Step detail panel" closeAriaLabel="Close Step detail. It hides; its place and size are kept."
          className={dialogClass} defaultWidth={detailAt.w} defaultHeight={detailAt.h} defaultX={detailAt.x} defaultY={detailAt.y} minWidth={320} minHeight={240}
          storageKey="pgc.panel.detail" singletonKey="pgc-panel-detail" footer={null} testId="panel-detail" zIndex={front === "detail" ? 1010 : 1000}>
          <div className="pgc-pane">
            {stepper.selected == null
              ? <p className="pgc-emptynote" data-testid="detail-pick">Walk the sequence (Simulate or Next) or click a message, and its full detail follows here.</p>
              : <StepDetailPanel hops={run?.hops ?? []} selected={stepper.selected} onSelect={stepper.select} />}
          </div>
        </FloatingDialog>
      )}
    </>
  );
}
