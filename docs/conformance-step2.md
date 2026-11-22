# Conformance, end of step 2c (2026-11-21)

Command: `node demo-kit-base/scripts/conformance.mjs <repo> --new --tier=Demo` (run by hand; CI does not call it yet). The checker is heuristic (file and grep evidence): a PASS is not proof. It does not check rules 24, 24b, 25 or 26.

Result: **25 PASS, 1 FAIL, 1 WARN** on the committed tree.

## FAIL

| Rule | What the checker looks for | Why it fails here |
|---|---|---|
| 5 "ReactFlow diagram, no mermaid" | `reactflow` or `@xyflow` in a package.json | Owner decision 2026-11-21: this lab draws **no UML or box diagram**. The sequence view is the shared evidence `SequenceView` with `MovieReel` and `StepDetailPanel` (STANDALONE-UI-PATTERNS 8c). No ReactFlow was added to satisfy the checker. The mermaid half of the rule passes: nothing here uses mermaid. |

Rule 5 is the known owner decision (the rulebook has no way to say "this lab draws nothing"; options are in `conformance-step1.md`). Nothing was faked.

## Rule 17 now PASSES, and that is not a real pass

At the end of step 1 rule 17 ("diagrams from diagram-studio data") failed for the same reason as rule 5. It passes now only because `web/src/panels/stepper.js` (step 2b) carries a comment that names the diagram-studio reducer this lab's walkthrough was copied from, and the checker greps the source for the text `diagram-studio`. The lab still draws no diagram and loads no diagram-studio data. It is the same owner decision as rule 5, not evidence of conformance. No reference was added to make it pass; the comment is honest provenance and is left as it is. (The step 2b notes said "unchanged"; that was wrong for rule 17.)

## WARN

| Rule | Reason |
|---|---|
| 18 "k8s manifests" | The SE k8s mock build is deferred by the owner (2026-10-31): Docker only. This warns even with `--new`, by design. The `MODE` switch check passes. |

## Not covered by the checker, covered here

- Rule 24 / 24b (JsonPane, decoded tokens): vendored pins and `scripts/check-token-decode.mjs` with `CHECK_TOKEN_DECODE_ENFORCE=1`: clean.
- Rule 25 (GatewayTrace): vendored files and pins; Mock traces say `checked`, Real only `observed` / `inferred` (tests, and the browser run against the Real stub).
- Rule 26 (Real never silently off): `GET /api/info` now also reports `realWanted`; the page shows the source from `/api/info` at all times and an amber alert when `MODE=real` was asked for but Real is unavailable (unit test, and `e2e/demo.py` against a lab started that way).
- Rule 16 (pi.flow only): the page login is a username and password form that calls the lab's own server; no redirect (the browser run asserts the URL does not change).

## The other checks, run on the committed tree

| Check | Result |
|---|---|
| `scripts/check-ui-standard.sh` | OK (vendored `standalone-ui.css` equals the canonical copy and the pinned hash) |
| `check-css.sh` | all rules ok. It found one `!important` (a step 2a leftover on `.pgc-idtable__src`); fixed by a more specific selector |
| `check-ui-patterns.mjs --app privilege-gateway-client-LAB` (advisory, the page is not on the allowlist) | P2 and P9 DRIFT on the `ready` page, P9 on the `panel-dock` page; everything else PASS (P11 WARN is the vendored ReleaseNotes). P9 is the red-primary decision from 2a (this lab uses ink for its one emphasised action). P2 is a checker misread (a `ToolsTab` heading is read as coming before the banner; the banner is the first element of `main`, asserted in a unit test and in the browser). Nothing new drifted in 2c |
| `check-token-decode.mjs` (enforced) | clean |
| `check-no-ai-attribution.sh` | 0 files, 0 commits |
