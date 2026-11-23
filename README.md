# Privilege Gateway Client Lab

Tier: Demo

A client for a PingOne Privilege MCP gateway. You pick one of three standing doors, discover its tools, run one, and the first thing you see is the verdict (Allowed, Blocked by policy, Needs sign-in, Held, Upstream error). An identity rail shows who is being evaluated, and evidence panels show how the call went: a movie reel, decoded tokens per hop, and the shared sequence view of the hops.

**Status: server side done (steps 1a to 1c); the web app is built through step 2c, plus the step 3 Diagram panel.** The page has the verdict-first stage, the identity rail with the three doors, the four tabs (Tools, Arguments and response, Evidence, a simulated Agent chat) and, from step 2b, a Panels dock with the Movie reel, Token sequence, Sequence (the shared evidence `SequenceView`) and Gateway trace as movable, resizable, pop-out panels, all driven by one walkthrough. From step 2c the Demo-tier features are in the page: six stories (`?story=S01` to `S06` links, and a picker) with three vertical packs, the persona picker and the Real page-login control with their states explained, the Mock/Real source line, presenter mode, a movable and pop-out Talk track, Reset of the whole page, `customer.config` branding and the workspace id. Help, a version button and the Docker build are later steps. Real mode, the pi.flow login against a live PingOne and Docker have not been verified by an agent.

## The three doors

| Door | Behaviour (the plan) |
|---|---|
| `lab-banking-full` | 18 tools listed, all permitted |
| `lab-banking-limited` | 7 listed (read-only); the other 11 are not listed, as on the real gateway, and a call to one by name is refused with 403 |
| `lab-banking-blocked` | no policy: every caller is refused before any tool is listed |

## What is simulated

- **Mock (the default, fully offline):** the gateway, its three doors and policies, the tokens (each labelled mock), the upstream behind a tool, held calls and any gateway-internal hop are all in-process simulations on `.invalid` hosts. No socket is opened. Anything the lab invents is labelled simulated or illustrative on the page.
- **Real (owner-run only):** the lab speaks MCP over HTTP to the owner's own gateway with one agent access key per door, read from this lab's own `.env`, plus a pi.flow page login. It states only what it saw: the HTTP status and body as *observed*, a grant or key decision as *inferred*. A real gateway reports no per-check detail, so the lab never claims it "checked" something it did not see.
- **Real agent chat (owner-run, optional):** in Real the Chat tab runs a real Claude agent (default `claude-sonnet-5-5`) on the Anthropic API, with its tool loop in this lab's server. It is offered exactly the tools the gateway lists on the door, with their own input schemas, and each tool it picks is a normal lab run through the gateway with that door's agent key, so the gateway decides every call and each one gets a verdict chip. It needs `PGC_ANTHROPIC_API_KEY` in this lab's own `.env` (write-only, billed to its owner). Mock keeps the simulated agent, which calls no model.
- **Shapes not yet measured (UNVERIFIED):** what a real gateway returns for a held call, and whether its tool list is filtered or full. Mock labels its own version of these simulated.

## Demo-tier features (rules 10 to 13)

- **Stories** (`server/src/data/stories/S01` to `S06`): all tools, some tools (the 11 left out of the list and refused by name), the blocked door, a held call, an upstream error and an identity mismatch (the last three are Mock only and say so). Each is data with `{{castBrand}}`-style tokens and names the run it teaches; a test replays every story and step against the lab and checks the verdict it names. `GET /api/stories`.
- **Three vertical packs** (`server/src/data/verticals/`: retail, health, finance) define every token. A test fails on any token a story or the talk track uses that a pack does not define. The vertical changes the words only, never the doors or tools.
- **customer.config** (`customer.config.example.json`; the real `customer.config.json` or `CUSTOMER_CONFIG` is git-ignored): name, tagline, vertical and the cast vocabulary. Bad fields fall back to defaults and are reported. `GET /api/config`.
- **Workspace id** (`X-Workspace`, default `default`): scopes the run log, the trace sink (`GET /api/trace`, plus files under `PGC_DATA_DIR` when set) and the sign-in cookie. Reset clears one workspace.
- **Personas and sign-in:** Mock has a persona picker (`aidemo`, `demouser`, `demoAdmin`). It exists only when `IDP=mock` and `ALLOW_MOCK_SIGNIN=1`, and every request is refused behind a proxy, on a non-loopback bind and in Real. `demoAdmin` is a normal user like the other two (owner decision 2026-11-22): only its name differs, it has no special mark and no extra privilege. Real signs the page in through PingOne pi.flow only (no redirect), with the agent key per door as before. The page login never carries a token: only a few claims.
- **Talk track:** `docs/talk-track.md`, the source for the page and the presenter mode (`PGC_PRESENTER=1`, or `?presenter=1`). `GET /api/talk-track`.
- **Reset:** `POST /api/reset` and `npm run reset` (`PGC_WORKSPACE` picks the workspace). **Doctor:** `npm run doctor`, which also recognises this lab already running on 7833.

## Where this came from

A new lab, built to a written plan and the standalone rulebook. The scaffold (workspaces layout, CI, compose hardening, pin tests, content-pack scripts) is adapted from `intent-console-lab-LAB` and `pf-array-claims-LAB`; every name, port, catalog id and URL of those labs was removed. It is not a fork of any lab and no code of `mcp-demo-client-privilege-LAB` was used. The visual and behavioural spec is a design mock that is never copied as code. The sequence view is the shared evidence `SequenceView`. The one drawn diagram is a ReactFlow box diagram of the call path, drawn from diagram-studio data (`diagrams/pgc-call-path.json`) through the shared diagram-kit (step 3); there is no UML look and no mermaid.

## Vendored shared parts

Copied byte for byte from AI-DEMO-Standalone `origin/main` at `6a637fd`, each with a pin file and a pin test, never hand-edited. To change one, change the canonical copy first, then re-vendor with `cp` and re-pin.

| Part | Lives in | Pin |
|---|---|---|
| health (`demo-health/1`), doctor, trace (W3C traceparent), shelf-link (server), gateway-real, hop-detail | `server/src/`, `server/src/vendor/` | `server/src/pins/<unit>.sha256` |
| gateway-trace (server file and the "What Privilege did" panel) | `server/src/gatewayTrace.js`, `web/src/gateway-trace/` | `web/src/gateway-trace/gateway-trace.sha256` (canonical) |
| TopMenu (whole directory) | `web/src/top-menu/` | `top-menu.sha256` (regenerated here: the canonical pin is stale) |
| JsonPane, VerifyMark, ShelfLink | `web/src/components/` | `JsonPane.sha256`, `JsonPane.css.sha256`, `VerifyMark*.sha256`, `ShelfLink.sha256` |
| floating-dialog, evidence (sequence view, movie reel, step detail), safeText | `web/src/floating-dialog/`, `web/src/evidence/`, `web/src/safeText.js` | `floating-dialog.sha256`, `evidence.sha256`, `safeText.sha256` |
| standalone-ui.css | `web/src/standalone-ui.css` | `scripts/standalone-ui.sha256` |
| UI and attribution checks | `scripts/check-ui-standard.sh`, `scripts/check-no-ai-attribution.sh`, `scripts/check-token-decode.mjs` | canonical copies |

`web/src/json/JsonPane.jsx` is the one lab-owned shim: the canonical evidence step detail imports `../json/JsonPane.jsx` while the canonical gateway-trace imports `../components/JsonPane`; the shim re-exports the single vendored copy so both share one module (the Form/JSON choice is module state).

## Run it

Prerequisites: Node 26 or newer. Docker (OrbStack) only for the Docker form, which is drafted but not built yet. Mock sign-in is on in the Docker compose file (loopback publish only) and off when you run `npm start` unless you set `IDP=mock` and `ALLOW_MOCK_SIGNIN=1`.

```
npm ci
npm test
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7833/. `GET /api/health` answers `demo-health/1`. Or `./scripts/run.sh`.

- Settings: this lab's own `.env` beside `docker-compose.yml` (see `.env.example`: names only). Mock needs none.
- Tests: `npm test` runs the server tests (`node --test test/*.test.js`), the web tests (vitest) and the packaging tests (`node --test scripts/*.test.mjs`).
- Browser proof of the panels (real Chromium, real mouse and keyboard, a real pop-out window; not part of `npm test`): start a Mock lab, then `BASE=http://127.0.0.1:<port>/ SHOTS=<dir> python3 e2e/panels.py` (needs `pip install playwright` and `playwright install chromium`; see the file's header).
- Learning Hub pack: `npm run content-pack`.

## Ports

This lab listens on 7833 only, published on `127.0.0.1` only. If the port is taken: `lsof -iTCP:7833 -sTCP:LISTEN -n -P`, then stop the old copy (`kill <PID>`, or `docker compose down` from this folder). The lab refuses any other port on purpose.

## Using the Demo-tier features

- **Stories:** open `/?story=S01` (to `S06`; the Learning Hub try-it cards link there) or pick one in the Stories bar under the verdict. A story sets its door and scenario and starts its run; the check line says whether the verdict is the one the story expects. S04 to S06 are Mock only (in Real they are marked and say why they will not run). The Vertical control in the header switches the words between retail, health and finance.
- **Sign in:** in Mock (needs `IDP=mock` and `ALLOW_MOCK_SIGNIN=1`, loopback only) a persona picker (`aidemo`, `demouser`, `demoAdmin`: three ordinary users). In Real a username and password form for PingOne pi.flow, no redirect, when the `PGC_PINGONE_*` settings exist. When either is unavailable the rail shows a disabled Sign in with the reason.
- **Mode:** the source is shown from `/api/info` at all times. Real not configured: the option is off with a how-to and `POST /api/mode` answers 409. `MODE=real` without Real configured starts in Mock and the page says so in an alert.
- **Presenter mode:** the Present button, the `P` key, `?presenter=1` or `PGC_PRESENTER=1`. Larger type, the banner stays on screen, the identity rail folds into its bar, the Talk track opens at the right and the Movie reel beside it once there is a run. `Esc` leaves it.
- **Talk track:** from `docs/talk-track.md` through `GET /api/talk-track`, in a movable, resizable, pop-out panel that does not block the page.
- **Reset:** clears the lab's state on the server and, on the page, the run, the story and its address, the walk, every panel and its remembered place, and the talk track.
- **Branding and workspace:** `customer.config.json` (name, tagline, vertical, cast) is the page title and header; `?workspace=<id>` keeps its own run history and sign-in and is shown in the header when it is not `default`.
- **Browser proof:** `e2e/demo.py` (and `e2e/panels.py` from 2b) drive real Chromium against labs you start; `e2e/real-stub.mjs` starts a Real lab with a loopback stub gateway and a stub PingOne. Not part of `npm test`; the header of each script says how to run it.
