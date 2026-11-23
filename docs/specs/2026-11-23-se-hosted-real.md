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
2. Signed in (the redirect sign-in, live PingOne): discover, call and the agent chat work on all three doors. Browser proof on the hosted URL.
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
1. Gate: the lab's own PingOne sign-in. Real calls need it; Mock stays open. First pi.flow, then the redirect sign-in (see One login below).
2. Who: colleagues onboarded with the rollout kit's hosted-access profile, plus demouser.
3. Model: through the Privilege LLM gateway with a virtual key (as mcp-demo-client does), not the Anthropic key directly.
4. Host: `privilege-gateway-client.<SE cluster domain>` (the full name is in STANDALONE-HOSTS.md, outside this repo: shipped text names no real host).

## Independent review (2026-11-23, `/code-review high`, 10 findings, all fixed)
- The mode is one setting shared by every visitor: hosted refuses `POST /api/mode` (409). A per-visitor mode would mean reworking the lab's mode end to end (netguard, lab, agent, sign-in); **owner decision pending** if Mock on the hosted URL is wanted.
- Workspaces: least-recently-used eviction at the cap (hosted), the cookie is the only workspace source (`X-Workspace` and `default` ignored).
- Pending pi.flow sign-ins: capped at 100 and expired after 10 minutes (`auth/loginRuns.js`).
- Reset on hosted clears only the caller's workspace.
- The daily agent cap counts only turns that reached the model; gateway-style model ids are kept; the `deploy.sh` tag check reads the last path segment; stale comments and the CLAUDE.md line fixed; a signed-in web test added.

## Second independent review (2026-11-23, `/code-review` on PR #10, 8 findings, all fixed)
- The daily agent cap: the slot is taken before the turn runs (messages sent at once cannot all pass), and a turn counts once it tried the
  model (a failed or timed-out model call may still be billed); a turn that never tried gives its slot back.
- Pending redirect sign-ins: one per browser workspace (a new start replaces it), 5-minute expiry, capped at 200; at the cap a new start is
  refused (`signin_busy`), never another browser's dropped. The hosted pi.flow store refuses the same way.
- `/callback` finishes only the sign-in the same browser started (its workspace cookie and the same state, compared in constant time); a
  wrong browser or state is refused and does not use the run up (login CSRF).
- Workspaces at the cap: an empty one is forgotten first, so cookieless reads cannot push out anyone's runs.
- Text: the CLAUDE.md sign-in rule, the k8s manifest and `docs/hosted.md` (the app must allow `https://<host>/callback`) name the redirect
  sign-in; no real host or local path in this spec.
- Each code fix has a test that failed before it (`server/test/hosted.test.js`).

## One login: the redirect sign-in (owner, 2026-11-23)
The owner asked for one login. pi.flow cannot reuse the browser's PingOne session, so the hosted instance uses the standard redirect sign-in
(an owner exception to rulebook rule 16, recorded there): `GET /api/auth/redirect/start` keeps state, nonce and the PKCE verifier on the server
(capped, 5-minute expiry, single use) and sends the browser to PingOne's authorize; `GET /callback` checks the state, exchanges the code (public
client, PKCE) and reads userinfo, sets the session cookie for that browser's workspace and returns to the page; any failure returns with
`?signin_error=<code>`, which the page words. The local lab keeps pi.flow. Tests: start/callback/replay, refusal, forged state, token failure,
return-path guard, not-hosted has no route.

## Local proof on the domain (2026-11-23, owner signed in)
The live lab container was swapped to this branch with the hosted settings behind the shared lab-proxy on the owner's domain, then put back.
- Before sign-in: Real discover, call and agent answered 401 `signin_required`; `POST /api/mode` answered 409; the page said to sign in.
- Redirect sign-in: start sent the browser to PingOne's authorize with PKCE and the proxy callback; the owner signed in as demoUser; the
  lab saw a `real-login` for that browser's workspace.
- Signed in: `lab-banking-full` Allowed, 18 tools; `lab-banking-limited` Allowed, 7 tools; `lab-banking-blocked` Blocked by policy. The agent
  through the Privilege LLM gateway (`claude-sonnet-4-5`) answered "who holds prod-db-admin" with `who_has_role` (Allowed), and on the limited
  door asked for the unlisted `sensitive_holdings`, which the gateway refused.
- Gap found: a callback with an unknown or reused state returned to the site root (`/`), which behind the proxy is the shelf, not the lab.
  Fixed the same day: the fallback is `./`, which the browser resolves beside `/callback`, so it lands on the lab under any path prefix
  (test: forged state and a bad return path).

## Status of the outside pieces (2026-11-23)
- Sign-in app `privilege-gateway-client-hosted` created in the PingOne environment where the hosted-access colleagues are (hosted-access group only, PKCE, no secret; pi.flow probe asks for a username and password). Settings in the owner's local settings file, outside this repo.
- Keys: waiting on the Pingid-privilege rebuild (new tenant). The rebuild session will create the three door keys, their grants and `pgc-agent-llm` after the gateway cutover.
- Not done: local proof with a live sign-in, the image, the Secret, the deploy (owner go).

## Out of scope
The ZIP and Drive rollout (forms B and C), the landing page and the shelf entry: these follow once this works.
