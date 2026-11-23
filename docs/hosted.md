# The owner-run SE-hosted Real instance

Spec and decisions: `docs/specs/2026-11-23-se-hosted-real.md`. This is NOT the local lab: it is one owner-run deployment on the US SE cluster,
in Real, behind a PingOne sign-in. Colleagues use it in a browser; nobody else runs it.

## What `PGC_HOSTED=1` changes (set only by `k8s/deployment.yaml`)
- Every Real discover, call, story run and agent message answers 401 `signin_required` until the visitor signs in. **Sign in is the redirect
  sign-in** (owner exception to rule 16, 2026-11-23): the browser goes to PingOne and back to `https://<host>/callback`, so a PingOne session
  the browser already has (from another hosted demo in that environment) signs the visitor in with no prompt. PKCE, a public client, one
  pending sign-in per browser (a new start replaces it), single use, 5-minute expiry. `/callback` finishes only the sign-in this browser
  started (its own workspace cookie and the same state), so a link started elsewhere is refused. At the cap (200 pending) a new start is
  refused, never another browser's dropped. A failure returns to the page with a plain reason. The local lab keeps the pi.flow dialog. Mock needs no sign-in and calls nothing.
- One workspace per browser (cookie `pgc_ws`; `X-Workspace` and `?workspace=` are ignored), at the cap (`PGC_MAX_WORKSPACES`, default 200) an
  empty workspace is forgotten first, so cookieless requests cannot push out anyone's runs, so visitors never share a run log, a trace or a pending sign-in. Cookies are `Secure`.
- The mode is fixed (Real): `POST /api/mode` answers 409 `mode_fixed`, because one shared mode would let any visitor switch everyone.
- Reset clears only the caller's own workspace. Pending sign-ins are capped (100) and expire after 10 minutes.
- A daily cap on agent messages per signed-in person (`PGC_AGENT_DAILY_LIMIT`, default 40); a turn that never reached the model does not count. The Tools tab is not capped.
- The agent reaches the model through the Privilege LLM gateway's Anthropic lane (`PGC_LLM_GATEWAY_URL` + `PGC_LLM_VIRTUAL_KEY`, an
  llm-scoped agent key), never with an Anthropic API key (`deploy.sh` refuses a Secret that holds one).

## The Secret (owner only)
`privilege-gateway-client-real` in the deployment namespace, created with kubectl from a temporary env file that lives outside any repo
(mode 600, deleted afterwards). Names it must hold (`deploy.sh` checks the names, never the values):

| Name | What |
|---|---|
| `PGC_GW_URL`, `PGC_GW_APPS` | The Privilege gateway origin and the three door names |
| `PGC_GW_KEY_LAB_BANKING_FULL`, `PGC_GW_KEY_LAB_BANKING_LIMITED`, `PGC_GW_KEY_LAB_BANKING_BLOCKED` | One agent access key per door |
| `PGC_LLM_GATEWAY_URL`, `PGC_LLM_VIRTUAL_KEY` | The LLM gateway origin and the llm-scoped agent key |
| `PGC_AGENT_MODEL` | A model the llm key allows |
| `PGC_PINGONE_ENVIRONMENT_ID`, `PGC_PINGONE_REGION`, `PGC_USER_CLIENT_ID` | The sign-in: the environment where the hosted-access colleagues are, and the hosted sign-in app (public client, PKCE, authorization code, restricted to the hosted-access group). The app must allow the redirect URI `https://<host>/callback`; `k8s/deployment.yaml` sets `PGC_USER_REDIRECT_URI` to it |
| `PGC_SESSION_SECRET` | A long random value, so sign-ins survive a pod restart |

```sh
kubectl -n <namespace> create secret generic privilege-gateway-client-real --from-env-file=<temporary file>
```

## Deploy (owner-approved)
Build for linux/arm64 (all SE nodes are arm64), push to GHCR with an immutable tag, then
`OWNER_APPROVED=1 NAMESPACE=... IMAGE=...:<sha> SE_HOST=... INGRESS_CLASS=... CLUSTER_ISSUER=... k8s/deploy.sh` (`--dry-run` first).
Verify by content, the pod imageID against the registry digest, and a signed-in browser run of the three doors and the agent.
