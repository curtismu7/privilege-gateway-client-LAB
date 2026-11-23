# SE-hosted Real instance spec

**Status:** decisions taken (owner, 2026-11-23); design being checked against the facts below   **Owner:** curtismu7 (decides)   **Tier:** 2 (a public URL colleagues use; live tenant and paid model keys)

## Goal
Colleagues open one https link on the US SE cluster and run the demo in Real, including the Real agent chat, without installing anything. The hosted instance is Real only (see the review section): Mock stays in the local Docker lab.

## Rule position
The rollout model allows a hosted Real instance only as "a Ping-operated real instance (owner-run, shared login)" with its own Secret, never the default hosted copy (ROLLOUT-MODEL.md lines 15 and 21; Muse is the example). Rulebook rule 18 defers the mock k8s build and rule 19 says "no hosted build exists for standalone apps". This instance is an owner exception to rule 19, recorded here and in STANDALONE-HOSTS.md.

## Design (draft)
- **Same image**, built for linux/arm64, pushed to GHCR with an immutable tag. `k8s/` manifests with `__IMAGE__` / `__SE_HOST__` placeholders, `deploy.sh` that needs `OWNER_APPROVED=1` and `NAMESPACE`. Non-root, read-only FS, `/api/health` probes, resource limits.
- **Secret** (`privilege-gateway-client-real`, created by the owner with `kubectl create secret`, never in git): the `PGC_GW_*` settings and keys, `PGC_ANTHROPIC_API_KEY` (or the LLM gateway settings, Q3), and the PingOne sign-in settings.
- **Sign-in required in Real (new switch, e.g. `PGC_REQUIRE_SIGNIN=1`, on only in the hosted manifest):** every Real discover, call and agent turn answers 401 `signin_required` until the workspace has a Real page login. Mock needs no sign-in and calls nothing. Locally the switch is off, so nothing changes for the Docker lab.
- **Per-person limits** so one visitor cannot spend the keys: a cap on agent messages per signed-in person per day, plus the existing per-message caps.
- **Workspaces:** each signed-in person gets their own workspace (run log and evidence are not shared).

## Acceptance criteria
1. Not signed in, Real: Tools, story and chat calls answer 401 `signin_required`, and the page says to sign in. Test plus a browser check on the hosted URL.
2. Signed in (pi.flow, live PingOne): discover, call and the agent chat work on all three doors. Browser proof on the hosted URL.
3. No key or token appears in any response, log line or trace (the existing grep tests, plus `kubectl logs` grepped after the browser run).
4. The pod runs the pushed digest (imageID equals the registry digest), `/api/health` answers demo-health/1, and the page loads over TLS.
5. The mode cannot be switched on the hosted URL (409 `mode_fixed`): one shared mode would let any visitor switch it, and sign every Real login out with it.

## Unhappy paths
- Sign-in fails, or PingOne asks for MFA or consent: a named error, and Real stays locked.
- The Secret is missing or incomplete: the lab starts in Mock and says Real is not configured (existing behaviour).
- The per-person agent cap is reached: the chat says so; Tools still works.
- The model or gateway is down: the existing named errors.
- Two colleagues at once: separate workspaces and logins.

## Decisions (owner, 2026-11-23)
1. Gate: the lab's own PingOne sign-in (pi.flow). Real calls need it; Mock stays open.
2. Who: colleagues onboarded with the rollout kit's hosted-access profile, plus demouser.
3. Model: through the Privilege LLM gateway with a virtual key (as mcp-demo-client does), not the Anthropic key directly.
4. Host: `privilege-gateway-client.<SE cluster domain>` (the full name is in STANDALONE-HOSTS.md, outside this repo: shipped text names no real host).

## Independent review (2026-11-23, `/code-review high`, 10 findings, all fixed)
- The mode is one setting shared by every visitor: hosted refuses `POST /api/mode` (409). A per-visitor mode would mean reworking the lab's mode end to end (netguard, lab, agent, sign-in); **owner decision pending** if Mock on the hosted URL is wanted.
- Workspaces: least-recently-used eviction at the cap (hosted), the cookie is the only workspace source (`X-Workspace` and `default` ignored).
- Pending pi.flow sign-ins: capped at 100 and expired after 10 minutes (`auth/loginRuns.js`).
- Reset on hosted clears only the caller's workspace.
- The daily agent cap counts only turns that reached the model; gateway-style model ids are kept; the `deploy.sh` tag check reads the last path segment; stale comments and the CLAUDE.md line fixed; a signed-in web test added.

## Status of the outside pieces (2026-11-23)
- Sign-in app `privilege-gateway-client-hosted` created in the AI-DEMO2 environment (hosted-access group only, PKCE, no secret; pi.flow probe asks for a username and password). Settings in `~/.config/demo-kit/pgc-hosted.env`.
- Keys: waiting on the Pingid-privilege rebuild (new tenant). The rebuild session will create the three door keys, their grants and `pgc-agent-llm` after the gateway cutover.
- Not done: local proof with a live sign-in, the image, the Secret, the deploy (owner go).

## Out of scope
The ZIP and Drive rollout (forms B and C), the landing page and the shelf entry: these follow once this works.
