# Conformance, end of step 1 (2026-11-21)

Command: `node demo-kit-base/scripts/conformance.mjs <repo> --new --tier=Demo` (the checker lives in the family's demo-kit-base; run by hand because CI does not call it yet).

Result: **24 PASS, 2 FAIL, 1 WARN.** Run on the committed step 1c tree. The checker is heuristic (file and grep evidence): a PASS is not proof. It does not check rules 24, 24b, 25 or 26 at all; this repo's own pin tests, `check-token-decode` (enforced) and the verdict and trace tests carry those.

## FAIL

| Rule | What the checker looks for | Why it fails here | What it needs |
|---|---|---|---|
| 5 "ReactFlow diagram, no mermaid" | `reactflow` or `@xyflow` in a package.json | The owner decided on 2026-11-21 that this lab draws **no UML or box diagram**: the sequence view is the shared evidence `SequenceView` (with `MovieReel` and `StepDetailPanel`), per STANDALONE-UI-PATTERNS section 8c. There is no ReactFlow in the repo, on purpose. The mermaid half of the rule passes: nothing in the repo uses mermaid. | **Owner decision needed.** Either record an exception (rules 5 and 17 name no way to say "this lab draws nothing"), or add one standard diagram. Nothing has been faked to satisfy the checker. |
| 17 "diagrams from diagram-studio data" | the text `diagram-studio` in source or package.json | Same reason: no diagram, so no diagram-studio data and no reference to it. No fake reference was added. | **Owner decision needed** (same as rule 5). For a new Demo app the rulebook says rule 17 is required; `--new` therefore fails it. |

Where the decision is written down (checked in the fix pass after step 1 review): the owner's claim entry in `~/Development/STANDALONE-COORDINATION.md` (2026-11-21, "Owner decisions 2026-11-21: ... no drawn UML/box diagram, use the shared evidence SequenceView; ...") and the owner's approval that started this build. It is **not** in STANDALONE-RULES.md, and the build plan (`PRIVILEGE-GATEWAY-CLIENT-LAB-PLAN-2026-11-21.md`) still carries its earlier recommendation of four `pgc-*` diagram JSON files plus a validator (plan sections 3 and 5 step 1) and lists the diagram questions as open (section 7, questions 2 and 3). The decision supersedes that recommendation, so this lab adds no diagram JSON and no validator; building them would contradict the owner. The two FAILs stay until the rulebook and checker record the exception below. This lab cannot edit either, so they are left as a decision for the owner.

Options for the owner, in the order of least work:

1. **Record an exception for this lab** in STANDALONE-RULES.md (rules 5 and 17: "applies only where the app draws a diagram; the evidence `SequenceView` is not a drawn diagram") and teach the checker to accept it (for example a one-line `docs/diagram-exception.md` the checker looks for). This matches the owner's 2026-11-21 decision as written.
2. **Add one standard diagram** (a ReactFlow flow of the three doors loaded from diagram-studio data by name). It contradicts the decision "no drawn diagram", so it needs a new decision, and about a day of work plus the studio data file.

Until one is chosen, `--new` will keep reporting these two FAILs and the ship checklist item "conformance `--new` 0 FAIL" cannot be ticked.

## WARN

| Rule | Reason |
|---|---|
| 18 "k8s manifests" | The SE k8s mock build is deferred by the owner (2026-10-31): Docker only. This warns even with `--new`, by design. The sibling check, "MODE switch for the mock-only build", passes. |

## PASS (24)

Rule 7 tier declared (`Tier: Demo`) and `CLAUDE.md`; rule 8 `ci.yml` with gitleaks and forbidden-strings; rule 9 `docs/shelf-entry.json` parses with a relative `composeFile`; rule 15 `demo-health/1`; rule 6 `content-pack.json`; rule 3 doctor, reset, **talk track** and **presenter mode**; rule 1 netguard; rule 12 **customer.config**; rule 13 **workspace id**; rule 10 **stories use {{cast}} tokens**; docker publishes `127.0.0.1` only; no EC `generateKeyPair`; rule 19 Mock/Real route and UI toggle text; rule 20 no self-hosted Ping product; no AI attribution (and CI runs the check); rule 22 TopMenu pin; rule 23 upstream failures map to JSON; rule 18 `MODE` switch.

Changes since the end of step 1b (which failed rules 9, 3 talk track, 10, 12, 5 and 17): rules 9, 3 talk track, 10 and 12 now pass. Rule 9 passes the checker with `catalogId: null`; note that the shelf registry rejects a null `catalogId` (it must be a string or absent), so the key must be dropped or set before the registry PR.

## Not covered by the checker, covered here

- Rule 24 / 24b (JsonPane, decoded tokens): vendored JsonPane pins and `scripts/check-token-decode.mjs` with `CHECK_TOKEN_DECODE_ENFORCE=1`: clean.
- Rule 25 (GatewayTrace): vendored files and pins; `assertTrace` is called on a Mock and a Real trace in the run tests.
- Rule 26 (Real never silently off): `GET /api/info` reports the mode and why; a `MODE=real` start without settings says so in `startNote`. Still to be checked after the first Docker rebuild (step 3).
- Rule 16 (pi.flow only): the page login sends `response_mode=pi.flow` and nothing else (test asserts it, and a mutation to another mode is caught).
