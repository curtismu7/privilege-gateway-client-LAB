# Fix pass after the step 2 and step 3 reviews (2026-11-22)

Scope: the two independent reviews of commit 91de5f6 (requirements and honesty; break-it), plus the owner change that `demoAdmin` is a normal user. One writer, small commits, a failing test before each fix. Tests ran on the MacBook Air with `air-test` (server and web suites) and locally for the browser work (Chromium, Playwright, ports 7971 to 7975; port 7833 and its container untouched).

Browser proof: `e2e/colors.py`, `e2e/overflow.py`, `e2e/fixes.py` (new), `e2e/ui-patterns.sh` (new) and the existing `e2e/panels.py`, `e2e/demo.py`, `e2e/diagram.py`, at 1440x900 and 375x812, light and dark (`fixes.py` also at 720x450). Screenshots: `~/Development/privilege-gateway-client-shots/fix-<what>-<viewport>-<theme>.png` (68 files), each family looked at.

## Findings

| # | Finding | What was done | Test that fails without it | Status |
|---|---|---|---|---|
| B1 | A failed run left the previous run on the Arguments response, Evidence, reel, tokens, sequence, trace, diagram and the dock counter | `useLab.exec` clears `lastRun` and `discovery` when a request fails (they are what every surface reads, so all agree). A stale answer for an old epoch still does nothing | `web/src/failedRun.test.jsx` (3 hook tests with the real server core behind a failing transport, 1 page test that checks every surface) | Fixed. Consequence: after a failed call the tool list is gone until Discover is run again (the failure card's Try again repeats the failed call) |
| B2 | Red on refusals in the Evidence tab (numbered circle, HTTP 403 and FAIL chips, decision rows) | `.pgc-calm` on the tabs section (`App.jsx`, from `runLook`): the same ink and amber token remap the dialogs have, scoped to the lab's own wrapper; a lock on the FAIL chip for a refusal (`.pgc-calm--refusal`); `.pgc-calm--red` keeps red for a Real upstream failure. The build-log claim "no red inside a panel" is corrected | `e2e/colors.py`: 52 computed-colour checks (7 states x Arguments and Evidence tabs x 2 viewports x 2 themes) failed 52 of 52 before, 0 after; `web/src/calm.test.jsx`, `verdictView.test.js` (`runLook`) | Fixed |
| B3 | The vendored JsonPane paints the key `note` red ("SIMULATED: invented sample data", the mock token note) | The same `.pgc-calm` remap reaches the JsonPane inside the tabs; the vendored file is untouched; upstream note 1 in `docs/upstream/README.md` | same `e2e/colors.py` run (the `note` rows were in the 52) | Fixed |
| B4 | check-ui-patterns: P2 on `ready`, P9 on `ready` and `panel-dock` | See `docs/conformance-step3-diagram.md` (fix pass). The checker has an allow marker (`ui-pattern: allow <RULE> <reason>`); used for P9. P2: the Tools empty title is `role="heading"`. Result: 2 pages, 2 clean | `e2e/ui-patterns.sh` (before: 2 pages with drift; after: 2 clean); `web/src/uiPatterns.test.jsx` | Fixed, with a waiver the owner should confirm (see below) |
| Owner | `demoAdmin` is a normal user | Removed `admin` on the persona, `isAdmin` on `/api/me` and the session (Mock and Real), the switch file `ALLOW_ADMIN_PERSONA` and `settings.adminSwitchFile`, the admin chip and the "admin persona" rail text, the e2e admin lab, README, CLAUDE.md, `.env.example`. demoAdmin has the same role text as demouser; only the name differs | `server/test/auth.test.js` (personas carry no extra field; the session and every verdict equal demouser's; the old switch file does nothing; an `admin` field in the login body is ignored), `web/src/App2c.test.jsx` (no admin mark even if a server still sent one) | Done |
| N1 | Long unbroken text overflowed (filter echo 300 chars, identity 600 chars) | `overflow-wrap: anywhere` and `min-width: 0` on the count line, the permitted summary, the empty-state hint and the rail badge | `e2e/overflow.py`: 24 checks, 12 failed before, 0 after (scrollWidth equals the viewport) | Fixed |
| N2 | Silent cuts: the upstream message (300), the tool result (800) | `lab.js` rebuilds the message and the result text from the captured wire body (scrubbed at capture), up to the lab's caps (1000 and 20000 characters); a cut is always `… (shortened)` (`verdict.js` `clip` too). The vendored client's own cuts stay and are noted upstream (note 3) | `server/test/real.test.js` (700 characters shown whole; beyond the cap marked; a short one untouched; a long tool result), `server/test/runs.test.js` (the Mock message ends "Request id mock-502."), `server/test/verdict.test.js` | Fixed. Not fixed: tool descriptions (300) and names (160) are cut inside the vendored client with no marker (upstream note 3) |
| N3 | Talk track at y=8 when storage throws | `talkPlace()` computes the place and TalkTrack gets it as its default, as well as seeding storage | `e2e/fixes.py` N3 (failed at 1440 before), `web/src/panels/talkPlace.test.js` | Fixed |
| N4 | Literal `**observed**` in the talk track | Quotes instead of asterisks in `docs/talk-track.md` | `server/test/talkTrack.test.js` (no Markdown marker in any talk-track or story text) and `e2e/fixes.py` N4 | Fixed |
| N5 | Open panels not re-placed after a Mock/Real switch | A successful switch remounts the dock: panels close, and open afresh under the new card | `web/src/modeSwitch.test.jsx`, `e2e/fixes.py` N5 (Real stub lab to Mock) | Fixed |
| N6 | Real rail said "Who the gateway evaluates" with a "?" avatar | Real: "Identity this lab declares" and a key icon | `web/src/modeSwitch.test.jsx`, `e2e/fixes.py` N6 | Fixed |
| N7 | Presenter mode needed three Escapes | A dialog the page opened (talk track, reel) releases the focus the shared dialog gave it (`panels/autoFocus.js`); a dialog the person works in still closes first | `e2e/fixes.py` N7 (failed at 1440 before), `web/src/panels/autoFocus.test.js` | Fixed |
| N8 | Mock upstream card said "Observed: read directly from the gateway's answer" | "Simulated by this lab." in the card and the Evidence decision | `web/src/verdictView.test.js`, `web/src/modeSwitch.test.jsx`, `e2e/fixes.py` N8 | Fixed. The server still marks a staged Mock upstream failure `basis: observed` (a server test pins that); the page words it |
| N9 | No skip link | A "Skip to main content" link, first tab stop, visible on focus; `main` is its target. The banner is still `main`'s first child | `web/src/modeSwitch.test.jsx`, `e2e/fixes.py` N9 | Fixed |
| N10 | No CSP or framing protection on the page | `Content-Security-Policy` (default `'self'`; scripts `'self'` only; styles `'self' 'unsafe-inline'` for React style attributes and the pop-out's copy of inline styles; `img-src` and `font-src` with `data:` for the lock mask; `connect-src 'self'`; `object-src` and `base-uri` `'none'`; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, and the existing nosniff, on every response | `server/test/headers.test.js` (the page, assets, a client route and the API); `e2e/fixes.py` N10 in the real build: no violation while using every panel, the pop-out is styled, the page cannot be framed | Fixed. The lab-proxy fetches the page server-side, so it needs no framing; not tested through a real lab-proxy |
| N11 | 200% zoom: Sequence panel squeezed; 375px sheet covers the dock | Short viewport (under 560px tall): panels start at the top and take the room above the dock, and the dock is compact; on a phone the sheets stop above the dock | `web/src/panels/panels.test.jsx` (placement), `e2e/fixes.py` N11, `e2e/panels.py` (sheet bottom now meets the dock) | Partly fixed. At 720x450 the panel is 327px tall (was 240) and the dock is still about 100px; a taller improvement needs the shared toolbars to wrap (upstream note 5) |
| N12 | Shared red: Mock/Real select fill, banner edge, header rule | Left as they are, listed in `docs/upstream/README.md` (note 6) | n/a | Listed |
| Diagram | Pop-out disabled for the Diagram; default placement short when the verdict card is tall | Left (owner decisions) | n/a | Left |

## Skipped or not verified

- **A Real upstream failure keeps red** (B2 variant `.pgc-calm--red`): pinned by `runLook` and a CSS test, but not seen in a browser; the Real stub has no failing mode.
- **Real mode** was only exercised against the loopback stub (`e2e/real-stub.mjs`); nothing real was contacted.
- **Tool descriptions and names** cut inside the vendored client (N2): not fixable here.
- **Through the shared lab-proxy** (N10): not run.
- **B1 trade-off**: clearing the discovery as well as the last run also removes the tool list after a failed call. The owner may prefer to keep the list and only drop the run; say so and it is a one-line change plus a test.

## Decisions for the owner

1. **P9 waiver** (B4): the three primary actions carry the documented `ui-pattern: allow P9` escape. On the Ready screen the card's "Get MCP tools" and the Tools tab's "Get MCP tools" are both ink primaries. Keep, or make the Tools-tab one a plain button (a design change)?
2. **B1**: keep clearing the tool list after a failed call (current), or keep the list and clear only the run?
3. **Upstream items** (`docs/upstream/README.md`): the JsonPane and GatewayTrace red, the silent cuts in the shared client, a no-focus option for dialogs the page opens, and the shared red parts (note 6) are for an owner-approved upstream PR.

## Open after the final independent review (HEAD 493f364, verdict: ready to publish, no blocking findings)

Left for a later pass, none of them blocking:

1. P9 waiver: `pgc-go-primary` plus `ui-pattern: allow P9` comments. The comment says tab panels are hidden, which is not true for the Tools-tab button on the Ready screen (both "Get MCP tools" ink primaries are visible). Owner decision: keep the waiver or make the Tools-tab button plain.
2. The diagram box "Copy link" copies `?box=<id>` but nothing reads `?box=` yet (UI-patterns 8c).
3. Diagram boxes are tabbable but Enter and Space do not expand a box; the stepper buttons work by keyboard.
4. Layout: zoom controls overlap the Browser box edge in some fits; the default Diagram canvas at 1440x900 is about 190px tall until resized; with all five panels open they cascade over the tabs and the Run button.
5. At 375px the Talk track and panel sheets cover the banner and the header Presenter button until closed.
6. The Diagram caption after a blocked run stops at message 6 and does not say the call was refused (the outcome box does).
7. `server/test/headers.test.js` mentions a nonexistent `e2e/headers.py`; the check lives in `e2e/fixes.py` (N10).
8. DOM order: the rail `h2`s come before the page `h1`.
9. Real mode was exercised only against the loopback stub, not through the lab-proxy, and a Real upstream failure keeping red was not seen in a browser.
10. Generic public region hostnames (auth.pingone.com and regional variants) appear in the pi.flow login code and its test; they are not tenant identifiers.
11. The shared `scripts/diagram-overlap.js` cannot see the kit's labels without `.dk-label` added at run time (documented in `docs/upstream/README.md`).
