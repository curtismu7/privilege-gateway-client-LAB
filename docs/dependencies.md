# Dependencies

Vetted 2026-11-21 (owner rule 10: say why, check maintenance, compatibility, licence and advisories before adding a package). Versions are the ones the sibling labs
already ship and CI-test on Node 26; each was looked up on the npm registry on the date above (`npm view <pkg> version license time.modified engines.node`).
`npm audit` after `npm install` reported **0 vulnerabilities** (165 packages audited, 2026-11-21).

| Package | Where | Why it is needed | Version | Licence | Node engines | Notes |
|---|---|---|---|---|---|---|
| express | server (runtime) | HTTP server and routing; the family stack | ^5.3.0 | MIT | >= 18 | Established, maintained; same major as pf-array-claims-LAB |
| react, react-dom | web (runtime) | UI; the vendored shared components are React | ^19.3.1 | MIT | any | Same as pf-array-claims-LAB, whose vendored evidence and floating-dialog tests pass on it |
| vite | web (dev) | Dev server and production build | ^8.3.8 | MIT | ^20.19 or >= 22.12 | Family stack |
| @vitejs/plugin-react | web (dev) | JSX transform for Vite | ^6.3.0 | MIT | ^20.19 or >= 22.12 | Family stack |
| vitest | web (dev) | Test runner for the vendored shared component tests | ^5.1.0 | MIT | ^22.12, ^24 or >= 26 | Needs Node 26, which we pin |
| jsdom | web (dev) | DOM for vitest | ^31.0.0 | MIT | ^22.22.2, ^24.15 or >= 26 | Needs Node 26, which we pin |
| @testing-library/react, /dom, /jest-dom | web (dev) | Component tests the shared pieces ship with | ^16.3.3, ^10.4.2, ^6.9.1 | MIT | >= 18 (jest-dom 6.x) | jest-dom 8.0.0 was published 2026-11-19; we stay on the 6.x line the siblings run, to move with the family |
| ajv | root (dev) | Validates `content-pack.json` against the Learning Hub schema (`npm run content-pack`) | ^8.20.0 | MIT | any | Only used by a script, never shipped in the image |

Step 1c (2026-11-21) adds **no new package**. ajv was re-checked: 8.20.0 is the registry's latest, MIT, last modified 2026-04-24, root devDependency only (a script validates `content-pack.json`; it is never in the image). The sign-in cookie uses `node:crypto` HMAC and the pi.flow login uses the global `fetch`, so no `jose`, session or HTTP-client package was needed.

No other package was added through step 2. (Step 2 deliberately did not add `@xyflow/react`: the owner then decided the lab draws no box diagram. On 2026-11-22 the owner reversed that: see step 3 below.)

Shared code is not an npm dependency: it is vendored byte for byte from AI-DEMO-Standalone `origin/main` and pinned (see README, "Vendored shared parts").

Step 2a (web shell and verdict): no new npm package. `@testing-library/react`, `jsdom` and `vitest` were already present; the component and hook tests need no `user-event` (they use `fireEvent`). One more shared file is vendored byte for byte and pinned, `shared/signin-dialog/SignInDialog.jsx` (web/src/signin-dialog/), for the Real page login.

Step 2c: no new npm package and no new vendored file. The shared `TalkTrackDialog` was evaluated and not used (it was modal then; it is non-modal since #488 but still has no default place, see `docs/upstream/README.md`), so `web/src/TalkTrack.jsx` is lab code on the already-vendored `FloatingDialog`. `e2e/demo.py` and `e2e/real-stub.mjs` need only what `e2e/panels.py` already needs (python3, Playwright, Chromium) and the repo's own test helpers.

## Step 3 (2026-11-22): `@xyflow/react`, the one new dependency

Owner decision 2026-11-22: the lab gets one standard diagram (a call-path box diagram), so rules 5 and 17 are met by drawing it, not by a comment. The shared `diagram-kit` (vendored byte for byte, pinned) is built on React Flow and cannot run without it, and a movable, zoomable box canvas with arrows is exactly what React Flow is; writing one by hand would be a large custom implementation.

| Package | Where | Version | Licence | Why |
|---|---|---|---|---|
| @xyflow/react | web (runtime) | ^12.12.1 (installed 12.12.1) | MIT | The canvas under the diagram-kit and the Diagram panel. The kit's README says "needs @xyflow/react 12"; the sibling labs run 12.12.x |

Vetting, looked up on the registry on 2026-11-22 (`npm view @xyflow/react`): 12.12.1 published 2026-11-02 (the 12.x line has had a release about monthly since August; the latest tag is 13.0.2, published 2026-11-17, a major the kit has not been tested on, so this lab stays on 12), MIT, maintained by the xyflow team (xyflow/xyflow on GitHub). Peer dependencies `react` and `react-dom` `>=18`; this lab runs React 19.3 and the kit's own tests and ours pass on it. Runtime dependencies: `zustand` ^4, `classcat` and `@xyflow/system` (same team), no install script. `npm audit` after installing: **0 vulnerabilities**. The production page JS is 576 kB minified (182 kB gzipped) with it; Vite warns about the chunk size, and nothing is split.

Test setup: jsdom has no `ResizeObserver` or `DOMMatrixReadOnly`, so `web/src/testSetup.js` gets two small stubs (lab code, the kit README asks for it). Browser proof of everything React Flow draws: `e2e/diagram.py`.
