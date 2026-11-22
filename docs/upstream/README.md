# Proposed upstream changes (for an owner-approved AI-DEMO-Standalone PR)

This lab never edits shared code. What it needs from `shared/` is written here as a ready-to-apply patch. Nothing here has been sent anywhere.

## `hop-catalog.patch` (shared/hop-detail/hop-catalog.json)

Adds five hop kinds the lab emits and the shared catalog does not have: `door-picked`, `discover`, `policy-check`, `tool-call`, `verdict`. Apply from the AI-DEMO-Standalone root:

    git apply --check docs/upstream/hop-catalog.patch && git apply docs/upstream/hop-catalog.patch

(`server/test/upstream.test.js` applies it to the vendored copy, which is byte-identical to the canonical file, and checks that only those kinds are added and every run still validates.) After it merges, re-vendor `hop-catalog.json` here: `server/src/hops.js` uses a proposed kind as soon as the vendored catalog has it, with no code change.

Until then each proposed kind falls back to the nearest existing one, so the lab ships and validates today:

| Proposed | Falls back to |
|---|---|
| `door-picked` | `website` |
| `discover` | `privilege-gateway-leg` |
| `policy-check` | `authorize-decision` |
| `tool-call` | `privilege-gateway-leg` |
| `verdict` | `agent-reply` |

A fallback lends its teaching text (`spec`) but never its `fact`: the lab sets its own fact on every hop, so a reel frame never says "cookie only, no token" for a door pick.

## `lanes.patch`: none needed

The lab uses the existing actor ids (`browser`, `lab`, `privilege`, `mcp`, `idp`, `hitl`) as they are, so there is no `lanes.patch`. One caveat for step 2: the actor-card text of `lab` ("looks a command key up in a fixed allow-list") and `mcp` ("checks the bearer again") describes other labs. If that text shows in this lab's cards, either accept it or propose new actors upstream then.

## A gap worth raising upstream

`demo-hop/1` verdicts are `ok | deny | held | obligation | skip`. A hop that failed (a 502, no answer) has no value of its own. This lab marks it `deny` and puts the plain failure in `fact` ("502 failed", "no answer"), but the reel's word for `deny` is "denied". A real `error` verdict would be more honest.

## Found in step 2b (the panels): shared behaviour to raise, nothing changed here

Each of these is in vendored code this lab must not edit. The lab works around it in its own files and says how.

1. **A pop-out cannot host a nested dialog.** `FloatingDialog` always portals into the opener's `document.body`. Inside a popped-out Sequence panel, clicking an actor opens the shared `ActorCard` (a `FloatingDialog`) in the OPENER window, not in the popup (`e2e/panels.py` prints this as an `INFO` line). A fix upstream: portal into the `ownerDocument` of the element the dialog is rendered from (a ref on a hidden marker node), or accept a `container` prop. Until then the card is usable but in the wrong window.
2. **The shared reel and sequence carry their own walkers.** `MovieReel` has Run and Speed with its own interval, `SequenceView` has Slow, Play and Prev/Next with its own timer. Section 8f says a lab adds no second stepper, so this lab drives `selected` from one stepper and these two controls simply call the same `onSelect` (a click on Run moves the one walk, paused on a hop). A `controls={false}` prop, or a controlled `playing` / `onPlayingChange`, would let a lab hide them.
3. **Red inside the evidence parts.** The active step (reel frame outline, sequence row, step-detail number and top edge), every pressed toggle, the `FloatingDialog` top edge and `MovieReel`'s Run button are drawn with `--accent` (Ping Red) or `button.primary`, and a refused hop's word with `--danger-text`. This lab's brief keeps red for Sign in, the thin header rule and real errors, so `app.css` redefines those TOKENS inside `.pgc-fd` (ink for `--accent`, amber for `--danger-text` unless the run is a Real upstream failure). It restyles no selector. A shared `--ev-active` token, separate from `--accent`, would make this one line upstream.
4. **`denied` for a failure.** (Already listed above.) In the reel a 502 reads "denied" because `demo-hop/1` has no `error` verdict; this lab keeps the lock icon for refusals only (`.pgc-fd--refusal`) so an upstream failure does not look like a policy refusal.
5. **Toolbar width.** The shared `SequenceView` and `MovieReel` toolbars are about 700px wide and do not wrap, so a panel under that width scrolls sideways. The lab's default panel widths (780 and 960) avoid it on a 1440px screen; at 600px and below the panel is a full-width sheet and the toolbars wrap.

## Found in step 2c (talk track): the shared TalkTrackDialog is modal

`shared/talk-track/TalkTrackDialog.jsx` (origin/main 0198a2a) renders a `FloatingDialog` without `noBackdrop`, so opening it dims the page with a backdrop, sets `aria-modal` and holds Tab inside. Its README and `STANDALONE-UI-PATTERNS.md` 8d.1 say it is docked beside the page, and 8f says nothing that opens during a walkthrough may block the controls. The Talk track is used while stepping through the reel, so it must not block the page.

This lab therefore does NOT use the vendored dialog: `web/src/TalkTrack.jsx` is the same panel (same props, test ids and `singletonKey`) with `noBackdrop`. The upstream fix is one line, `docs/upstream/talk-track-no-backdrop.patch`. When it lands, delete `TalkTrack.jsx`, vendor `TalkTrackDialog.jsx` with a pin and import it in `App.jsx`. A second small upstream point: the panel opens at the very top right of the window (`placement="right"` puts it at y=16), over the header's Mode, Reset and Sign in controls; this lab seeds the dialog's remembered place (`panels/talkPlace.js`) so it opens under the header.

## Found in step 3 (the Diagram panel): shared code to raise, nothing changed here

1. **`scripts/diagram-overlap.js` cannot see the diagram-kit's labels.** It finds labels by React Flow's own classes (`.react-flow__edge-textwrapper`, `.react-flow__edge-label`, `.react-flow__edgelabel-renderer > *`). The kit draws its labels in `ViewportPortal` with class `dk-label`, so on a kit diagram the script reports `labels: 0, overlaps: [], pass: true`: a pass that checked nothing. `e2e/diagram.py` adds `'.dk-label'` to the selector at run time and refuses a run that found no labels. Upstream: add `.dk-label` to the script's selector list.
2. **React Flow does not work in a popped-out window.** In a `FloatingDialog` pop-out (a separate React root in another window) the boxes stay `visibility: hidden` and no arrow is drawn: React Flow measures boxes with a `ResizeObserver` created in the opener's window, which does not report the other window's elements. The Diagram panel therefore has no pop-out (`disablePopOut`) and says so. The kit README could say that any kit diagram inside a pop-out has this limit.
3. **No shared stepper yet.** Section 8f names `diagram-studio-LAB`'s reducer and hook as the reference, but there is nothing to vendor, so this lab keeps its own tested copy (`panels/stepper.js`). A shared, pinned copy would let labs drop theirs.
4. **diagram-kit README says React 18.** It works unchanged on React 19.3 (kit tests and this lab's pass); the README line could say "18 or 19".

## Found in the fix pass (2026-11-22): shared code to raise, nothing changed here

The lab works around each of these in its own files (named below). The vendored files stay byte-identical to origin/main.

1. **`JsonPane` paints the keys `note`, `reason`, `decision`, `verdict`, `error`, `outcome` red** (`components/JsonPane.jsx` ALERT set, `JsonPane.css` `.jtok--alert` and `.jform__row[data-alert]`, both `--danger-text`). A mock token's `note` ("MOCK token signed with a per-process random key") and the "SIMULATED: invented sample data" note are not errors, and a refusal's `decision` is not either. Suggested: keep red for `error` and `error_description` only, or let a host switch the alert colour. Workaround here: `.pgc-calm` (app.css) remaps `--danger-text` to the amber token for the lab's own tabs; `.pgc-fd` does the same inside dialogs.
2. **`GatewayTrace` draws its numbered circle with `--accent` and a failed check or `HTTP 403` chip with `--danger-text`.** A refusal is a policy working as designed, not an error. Suggested: a neutral or amber `fail` chip, or a `data-tone` the host can set. Workaround: the same `.pgc-calm` remap, plus a lock icon on the chip for a refusal (`.pgc-calm--refusal`).
3. **`gateway-real/gatewayClient.js` cuts silently.** An HTTP error body is kept as its first 300 characters inside the error message (`rpcError` slices to 300 and the call adds `body.slice(0, 300)`), a tool result's text to 800, a tool description to 300 and a name to 160, with no ellipsis or word that says so. Suggested: add `… (shortened)` wherever it cuts, or carry the full text up to the capture cap. Workaround: `lab.js` rebuilds the message and the result text from the captured wire body (up to the lab's own caps of 1000 and 20000 characters) and marks every cut `… (shortened)`; tool descriptions are still cut at 300 by the client.
4. **`FloatingDialog` always moves focus into a dialog that opens, and a non-modal one closes on Escape while focus is inside it.** A page that opens dialogs by itself (presenter mode) then needs three Escapes to leave. Suggested: a `focusOnOpen={false}` prop (or `autoOpened`), so a dialog the page opened does not take focus. Workaround: `panels/autoFocus.js` releases focus from a dialog the page opened.
5. **`FloatingDialog` opens at the top right by default and its narrow bottom sheet covers any fixed bar at the bottom.** A dock or footer is covered on a phone. Suggested: honour a `--fd-bottom-inset` custom property on the sheet. Workaround: `app.css` raises the lab's sheets above `--pgc-dock-h`.
6. **`standalone-ui.css` red parts the owner may want to relax** (this lab leaves them as they are, and lists them so the owner can decide): the Mock/Real select's red fill, the simulation banner's red left edge, the thin red header rule, and the pressed state of header toggles (Talk track, Present) which uses the same red. They are the shared standard's own; the lab's rule "red only on Sign in, real errors and the shared header parts" depends on them staying the only red.
7. **`ui-patterns` checker P9 reads a primary button by class name only** (`primary`, `*-primary`, `variant="primary"`). A lab whose emphasised action is not red (the owner's colour rule) has no button the checker can call primary, and when it names them, the checker cannot see that tab panels are hidden, so it counts all of them as one view state. Suggested: let a page declare its primary by `data-primary` or a role, and read `hidden` tab panels as exclusive. Workaround: the documented `ui-pattern: allow P9 <reason>` escape on the three primary buttons (see `docs/fix-pass-step2.md`).
8. **`ui-patterns` checker P2 reads source order across components.** It reported the first `<h3>` of the Tools tab as coming before the banner although the banner is `main.firstElementChild` at run time. Workaround: that heading is `role="heading" aria-level="3"` on a `div`.
9. **Playwright and a strict CSP.** `page.wait_for_function("string")` evaluates the string in the page, which a CSP without `'unsafe-eval'` refuses. The lab's e2e scripts open their contexts with `bypass_csp=True`, and `e2e/fixes.py` (N10) tests the real policy without it.
