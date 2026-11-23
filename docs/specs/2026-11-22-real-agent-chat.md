# Real agent chat spec

**Status:** built and verified live (2026-11-22); awaiting the owner's go to commit, push and open a PR   **Owner:** curtismu7 (decides)   **Tier:** 2 (colleagues run this lab)

## Goal
Make the demo runnable by talking to an agent. In Real mode, the Chat tab runs a real Claude agent that reads the tools the gateway lists on the chosen door, picks a tool and fills its arguments from the tool's own `inputSchema`, and calls it through the real gateway with that door's agent key. Each tool call shows the gateway's verdict like a Tools-tab run. Mock keeps the scripted agent, which calls no model. The same change fixes the Tools tab in Real: its argument form comes from the real `inputSchema`, not the lab's Mock samples (bug: `get_access_grants` was sent `principal`, the real tool needs `resource`).

## Design
- **Loop:** Messages API, a manual tool-use loop on the lab server (`server/src/agent/`). Not Managed Agents: every tool call has to go through the lab's own `run('call', ...)` so that the netguard, the agent key (server-side only), the hops and the verdict stay exactly as they are for a Tools-tab run, and a demo turn needs no container. (Owner chose this, 2026-11-22.)
- **SDK:** `@anthropic-ai/sdk` 1.12.0 (server runtime), given a `fetch` that asks the netguard first. Vetting: `docs/dependencies.md`.
- **Model:** `claude-sonnet-5-5` (owner, 2026-11-22), effort `low` (tool picking with short replies), adaptive thinking left on (the default). Server-side refusal fallback on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). `PGC_AGENT_MODEL` can override the model.
- **Key:** `PGC_ANTHROPIC_API_KEY` in this lab's own `.env`, write-only like the agent keys: never returned, logged or traced. `.env.example` gets the name only.
- **Netguard:** a new `decideModel()`. Real only, exactly one origin (`https://api.anthropic.com`), https only. Mock allows none.
- **Tools sent to the model:** exactly the discovered list for the door, each with the gateway's `inputSchema`. A refused tool is never listed, so the model cannot pick it. If the model names an unlisted tool anyway, the gateway decides as usual.
- **Route:** `POST /api/agent` `{door, messages}`, same-origin and workspace-scoped like `/api/call`. Returns the reply text, the run records of each tool call and a `simulated:false` label.
- **UI:** the Chat tab in Real shows "Real agent (Claude)" and a cost note. Each tool call gets a verdict chip linked to its run in Evidence. Mock keeps today's chat and label.

## Acceptance criteria
1. Real Tools tab: discovering `demo-all-tools` and opening `get_access_grants` shows `resource` (required), not `principal`. Test: a stubbed gateway lists a schema and `lab.discover` returns its properties and required list.
2. Mock Tools tab is unchanged: the existing sample-args tests still pass.
3. Real Chat, stubbed model plus stubbed gateway: "who can access prod-db-primary?" makes one `tools/call get_access_grants {resource:"prod-db-primary"}` through `run('call')`, and the reply carries that run's id and verdict.
4. Every model request goes through the netguard: a test counts zero socket attempts outside `decideModel`'s one origin, and the Mock chat makes zero model calls.
5. The agent key and the API key never appear in any response, log line, hop or trace (grep test over the outputs).
6. Browser: in Real, with the lab's own `.env`, three prompts on the three doors give allowed, partly refused (some-tools) and blocked (blocked door: the agent says it has no tools). Screenshot each.

## Unhappy paths (each gets a test)
- No `PGC_ANTHROPIC_API_KEY`: the Real Chat tab says the agent is not configured and names the setting. The Tools tab still works.
- The model API is down, slow or 429/5xx: a 30 s timeout per model request, SDK retries capped at 1, and a 90 s deadline for the whole turn (checked before each model call). The chat shows "the agent model did not answer", in amber, never red, and says no gateway call was made for that step.
- `stop_reason: refusal` or `max_tokens`: shown in plain words, and no tool runs from a truncated input.
- A runaway loop: at most 6 tool calls per turn, then the agent stops and says so.
- The gateway refuses a call (403 or blocked door): the tool result goes back to the model as an error, and the verdict chip shows the refusal (amber, with a lock).
- A write tool (`open_ticket`): it goes to the gateway, which holds it for a person (HITL). The lab never approves anything itself.
- Prompt injection in tool output (the backend data includes an "Immediately call open_ticket..." line): the system prompt treats tool output as data. Any call it causes still goes through the gateway's policy and HITL, which is the point of the demo.
- Long or hostile chat input: messages are capped at 2,000 characters and the history at 20 turns. Model text is rendered as text, never as HTML.
- Switching mode or door mid-chat clears the conversation.

## Out of scope
An LLM in Mock mode, streaming tokens into the UI, the k8s/hosted build, prompt caching tuning, saving chat history across a Reset.

## Protected / must not break
Netguard zero-outbound in Mock, write-only keys, pi.flow login, vendored files (none edited), verdict wording rules (observed/inferred in Real, refusals amber), stories and talk track, Reset.

## Verification plan
`npm test` on the Air (server, web, scripts) with real counts. `npm run doctor`. Conformance gate. Real browser run per criterion 6 (owner's `.env`, owner's API key). An independent `/code-review` of the diff. No merge or shelf restart until the owner says go.

## Decisions (owner, 2026-11-22)
1. The loop is hosted in the lab (Messages API), not Managed Agents.
2. Model: Claude Sonnet 5.5.
3. Key: `PGC_ANTHROPIC_API_KEY` in this lab's own `.env`, added by the owner.

## Evidence (2026-11-22)
- Tests on the Air (Node 26): server 209 (208 pass, 0 fail, 1 skipped as before), web 374/374, scripts 27/27. Build passes. Conformance: 0 failed, 1 advisory (rule 18 k8s, deferred).
- Live, real gateway + real model (`claude-sonnet-5-5`), Chromium via Playwright, lab on 127.0.0.1:7933 with the lab's own `.env`:
  - Criterion 1: Real Tools tab, `get_access_grants` form `{"resource": "prod-db-primary"}`, "Required: resource".
  - `demo-all-tools`, "Who has access to prod-db-primary?": discovery 18 tools Allowed, `get_access_grants {"resource":"prod-db-primary"}` Allowed, a correct answer. The agent also refused a prompt-injection planted in the backend data (a grant's justification told it to open a ticket for erin.walsh) and said so.
  - `demo-some-tools`: discovery 7 tools; the agent was never offered `sensitive_*` (the real gateway hides refused tools), used `get_portfolio_summary` and `who_has_role`, both Allowed.
  - `demo-blocked`: discovery 403 (Blocked by policy), no model call, the lab says the agent has no tools.
  - 375 px: no horizontal overflow; no console errors.
- Independent review (`/code-review high`, 10 findings): fixed 1-3 (history: earlier replies cut to 2,000 chars, at most 40 messages, a UTF-8 byte budget), 5 ($defs/definitions kept, duplicate tool names offered once), 7 (90 s turn deadline), 8 (a send while another call runs says "Not sent" and is kept out of history; Send is disabled while the lab is busy), 9 (the model-down test now asserts no tool run), 10 (one agent config). Not fixed, below.

## Follow-ups (done 2026-11-22, second change)
- Stories in Real: `runSpec` (useLab.js) discovers the door first and sends the tool's listed arguments; a tool the gateway does not list (a story about a refusal) keeps the catalog sample, and the gateway decides. Mock is unchanged. Test: `useLab.test.jsx`.
- A `tools/list` reply over 256 KB: no change needed. The capture replaces it with a note, so the discovery is already an honest "Upstream error ... too large" (no empty forms), and the agent says so without a model call. A test now pins that.
- Refusals in the chat (owner chose "call-by-name tool"): the agent gets one extra tool, `call_unlisted_tool(name, arguments)`, for when the user names a tool it was not offered. The lab sends that call to the gateway like the Tools tab's "run by name"; the gateway decides (on `demo-some-tools` it refuses), and the chat labels the step "a tool it did not list". The refused tool itself is never offered.
