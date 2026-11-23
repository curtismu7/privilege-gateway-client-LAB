import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { interpret, replyFor } from "./agent.js";
import { visible } from "./safeText.js";
import MovieReel from "./evidence/MovieReel.jsx";
import { shownBasis } from "./verdictView.js";

const ICON = { allowed: "check", blocked: "lock", held: "hourglass", upstream: "unplug", "needs-sign-in": "key", "bad-request": "alert" };

// The chat sends the server only text, and only as much recent history as the server accepts: each message at most MESSAGE_CHARS (an
// earlier agent reply is cut to that), at most HISTORY_MESSAGES messages, and HISTORY_BYTES of UTF-8 JSON (the server reads at most 16 kB).
export const MESSAGE_CHARS = 2000;
export const HISTORY_MESSAGES = 40;
export const HISTORY_BYTES = 12000;
const jsonBytes = (s) => new TextEncoder().encode(JSON.stringify(s)).length;
export function historyFor(msgs, next) {
  const all = [...msgs.filter((m) => !m.local).map((m) => ({ role: m.who === "you" ? "user" : "assistant", text: String(m.text).slice(0, MESSAGE_CHARS) })), { role: "user", text: next }];
  const out = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0 && out.length < HISTORY_MESSAGES; i -= 1) {
    used += jsonBytes(all[i].text) + 32;
    if (used > HISTORY_BYTES && out.length) break;
    out.unshift(all[i]);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}

// The model is asked for plain text but may still write Markdown. The reply stays text (never HTML): bold markers are dropped and its line
// breaks are kept (the CSS shows them), so a list does not read as "**name:** ... - **name:**".
export const plainReply = (s) => String(s ?? "").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1").replace(/^#{1,6}\s+/gm, "");

// Ready-made prompts (owner 2026-11-23). Picking one fills the message; it never sends by itself. Real prompts are for the Claude agent;
// Mock prompts use words the simulated agent reads (agent.js).
export const REAL_PROMPTS = Object.freeze([
  "What tools can you use on this door?",
  "Who has access to prod-db-primary?",
  "Who holds the prod-db-admin role?",
  "What entitlements does carol.nguyen have?",
  "Call sensitive_holdings for account inv_5520.",
  "Open a ticket to review carol.nguyen's access to prod-db-primary.",
]);
export const MOCK_PROMPTS = Object.freeze([
  "list my tools",
  "who has role prod-db-admin",
  "get access grants",
  "get investment balance",
  "call sensitive_tax_record",
  "open a ticket",
]);

// One run's evidence, inline under the chat message (owner 2026-11-23): the verdict in words and the movie reel of its hops. There is still
// ONE walkthrough on the page: a frame of a run that is not the page's current run first loads that run (Evidence and the panels follow),
// and after that the frames walk the page's one walkthrough.
function InlineEvidence({ run, stepper, current, onShow }) {
  const v = run.verdict;
  const hops = run.hops ?? [];
  const pick = (n) => { if (!current || !stepper) onShow(run); else stepper.select(n); };
  return (
    <div className="pgc-inlev" data-testid="chat-evidence" data-verdict={v.id}>
      <p className="pgc-inlev__verdict"><Icon name={ICON[v.id] ?? "alert"} /><b>{v.word}</b> <span>{visible(v.sentence ?? "")}</span></p>
      <dl className="pgc-inlev__facts">
        <dt>Door</dt><dd>{visible(run.door ?? "")}</dd>
        <dt>Tool</dt><dd>{run.tool ? visible(run.tool) : "Discovery (tools/list)"}</dd>
        <dt>How decided</dt><dd>{visible(shownBasis(v.basis, run.simulated) ?? "")}</dd>
      </dl>
      {hops.length > 0 && (<>
        <MovieReel hops={hops} selected={current && stepper ? stepper.selected : null} onSelect={pick} />
        <p className="pgc-inlev__hint">{current ? "This run is in Evidence: click a frame to walk it." : "Click a frame to load this run into Evidence and walk it."}</p>
      </>)}
    </div>
  );
}

function EvidenceToggle({ run, stepper, current, onShow }) {
  const [open, setOpen] = useState(false);
  if (!run) return null;
  return (<>
    <button type="button" className="pgc-linkbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="chat-evidence-toggle">{open ? "Hide evidence" : "Evidence"}</button>
    {open && <InlineEvidence run={run} stepper={stepper} current={current} onShow={onShow} />}
  </>);
}

function Chip({ run, onShow }) {
  if (!run) return null;
  const v = run.verdict;
  return (
    <button type="button" className="pgc-chipword pgc-chipword--btn" data-verdict={v.id} onClick={() => onShow(run)} title="Show this run in Evidence and the panels" data-testid="chat-step-chip">
      <Icon name={ICON[v.id] ?? "alert"} />{v.word}
    </button>
  );
}

// What the agent did in one turn: the discovery, then each tool call with the gateway's verdict. A chip opens that run in Evidence; the
// Evidence toggle shows it inline.
function Steps({ steps, onShow, stepper, currentId }) {
  if (!steps?.length) return null;
  return (
    <ol className="pgc-steps" data-testid="chat-steps">
      {steps.map((s, i) => (
        <li key={i} data-testid={`chat-step-${s.kind}`}>
          {s.kind === "discover"
            ? <span>Asked the gateway for this door's tools{s.run?.tools ? `: ${s.run.tools.length} listed` : ""}</span>
            : <span>{s.unlisted ? "Asked the gateway for a tool it did not list: " : "Called "}<code>{visible(s.tool)}</code> <code className="pgc-steps__args">{visible(JSON.stringify(s.args ?? {})).slice(0, 160)}</code>{s.labError ? ` — not sent: ${visible(s.labError)}` : ""}</span>}
          <Chip run={s.run} onShow={onShow} />
          <EvidenceToggle run={s.run} stepper={stepper} current={Boolean(s.run) && s.run.id === currentId} onShow={onShow} />
        </li>
      ))}
    </ol>
  );
}

function Compose({ text, setText, send, busy, placeholder, prompts = [] }) {
  return (
    <div className="pgc-compose">
      <div>
        {prompts.length > 0 && (
          <div className="pgc-prompts">
            <label className="pgc-lbl" htmlFor="pgc-prompt">Prompt</label>
            <select id="pgc-prompt" value="" onChange={(e) => { if (e.target.value) setText(e.target.value); }} data-testid="chat-prompts">
              <option value="">Pick a prompt…</option>
              {prompts.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        <label className="pgc-lbl" htmlFor="pgc-ask">Message</label>
        <textarea id="pgc-ask" value={text} maxLength={2000} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} data-testid="chat-input" />
      </div>
      <button type="button" className="pgc-go" disabled={!text.trim() || busy} onClick={send} data-testid="chat-send">Send</button>
    </div>
  );
}

// The REAL agent (Real only): a Claude model that the lab server runs. Every tool it picks goes through the real gateway as a normal run.
function RealChat({ lab, stepper }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, thinking]);
  const agent = lab.info.agent ?? { available: false, reason: null, model: null };

  if (!agent.available) {
    return (
      <div className="pgc-empty" data-testid="chat-real-off">
        <Icon name="key" className="pgc-empty__ico" />
        <h3>The real agent is not configured</h3>
        <p>{agent.reason ?? "The real agent is not available."}</p>
        <p>The Tools tab still runs any listed tool against the real gateway.</p>
      </div>
    );
  }

  async function send() {
    const message = text.trim();
    if (!message || thinking) return;
    const history = historyFor(msgs, message);
    setText("");
    setMsgs((m) => [...m, { who: "you", text: message }]);
    setThinking(true);
    try {
      const out = await lab.agentTurn(history);
      if (out) setMsgs((m) => [...m, { who: "agent", text: out.reply, steps: out.steps, by: out.by, stopped: out.stopped }]);
      // Not sent (another call of this lab was still running, or the door or mode changed): say so, and keep the message out of later history.
      else setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], local: true }, { who: "agent", local: true, text: "Not sent: another call in this lab was still running. Send it again when it finishes.", stopped: "not-sent" }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: "agent", local: true, text: `This lab could not run the agent: ${e?.message ?? "the request failed"}`, stopped: "lab-error" }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div data-testid="chat-panel-real">
      <p className="pgc-note pgc-note--real" data-testid="chat-real-note">
        <strong>REAL agent</strong> ({visible(agent.model ?? "Claude")}). {agent.via === "llm-gateway" ? "Each message calls the model through the Privilege LLM gateway, with this lab's llm-scoped agent key." : "Each message calls the model through the Anthropic API, billed to the key in this lab's .env."} Every tool it picks goes to the real gateway with this door's agent key, and the gateway decides.
      </p>
      {msgs.length === 0 ? (
        <div className="pgc-empty pgc-empty--chat"><h3>Ask the agent to do something with the tools on {visible(lab.door)}</h3><p>Try: “who has access to prod-db-primary?”, “what entitlements does carol.nguyen have?” or “what can you do here?”.</p></div>
      ) : (
        <div className="pgc-chat" aria-live="polite" data-testid="chat-log">
          {msgs.map((m, i) => (
            <div key={i} className={`pgc-msg pgc-msg--${m.who}${m.local || (m.stopped && !["done"].includes(m.stopped)) ? " pgc-msg--stopped" : ""}`} data-testid={`msg-${m.who}`} data-stopped={m.stopped ?? undefined}>
              <b>{m.who === "you" ? "You" : m.by === "lab" || m.local ? "Lab (agent stopped)" : "Agent (Claude)"}</b>
              <span className="pgc-msg__text">{visible(plainReply(m.text))}</span>
              <Steps steps={m.steps} onShow={lab.showRun} stepper={stepper} currentId={lab.lastRun?.id} />
            </div>
          ))}
          {thinking && <div className="pgc-msg pgc-msg--agent" data-testid="chat-thinking"><b>Agent (Claude)</b><span>Thinking and asking the gateway…</span></div>}
          <div ref={end} />
        </div>
      )}
      <Compose text={text} setText={setText} send={send} busy={thinking || Boolean(lab.busy)} placeholder="Ask the agent, or pick a prompt above (Cmd+Enter to send)" prompts={REAL_PROMPTS} />
    </div>
  );
}

// A SIMULATED agent (Mock only). It calls no model: agent.js reads the message, the lab's own server answers the call, and the reply is worded
// from the verdict that came back. One refused tool is one reply; it never changes the door's other tools.
function MockChat({ lab, stepper }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, thinking]);

  async function send() {
    const message = text.trim();
    if (!message || thinking) return;
    setText("");
    setMsgs((m) => [...m, { who: "you", text: message }]);
    const plan = interpret(message, lab.info.catalog.map((t) => t.name));
    if (plan.intent === "help") { setMsgs((m) => [...m, { who: "agent", ...replyFor(plan, {}) }]); return; }
    setThinking(true);
    let run = null;
    if (plan.intent === "list") run = await lab.discover();
    else {
      const sample = lab.info.catalog.find((t) => t.name === plan.tool)?.args ?? {};
      run = await lab.callTool(plan.tool, sample);
    }
    setThinking(false);
    if (!run) {
      setMsgs((m) => [...m, { who: "agent", text: lab.busy ? "I am still waiting for the previous call. Try again in a moment." : "I could not reach the gateway through this lab's server, so I could not call any tool.", chip: null }]);
      return;
    }
    setMsgs((m) => [...m, { who: "agent", ...replyFor(plan, { run, door: lab.door, name: run.identity?.name }), run }]);
  }

  return (
    <div data-testid="chat-panel">
      <p className="pgc-note pgc-note--sim" data-testid="chat-sim-note"><strong>SIMULATED agent.</strong> No model is called. It reads your message, asks the lab's simulated gateway, and tells you what that gateway decided. Switch to Real for the real agent.</p>
      {msgs.length === 0 ? (
        <div className="pgc-empty pgc-empty--chat"><h3>Ask the agent to use the tools on this door</h3><p>Try: “list my tools”, “get investment balance” or “call sensitive_tax_record”.</p></div>
      ) : (
        <div className="pgc-chat" aria-live="polite" data-testid="chat-log">
          {msgs.map((m, i) => (
            <div key={i} className={`pgc-msg pgc-msg--${m.who}`} data-testid={`msg-${m.who}`}>
              <b>{m.who === "you" ? "You" : "Agent (simulated)"}</b>
              <span>{visible(m.text)}</span>
              {m.chip && <span className="pgc-chipword" data-verdict={m.chip.id}><Icon name={ICON[m.chip.id] ?? "alert"} />{m.chip.word}</span>}
              {m.run && <span><EvidenceToggle run={m.run} stepper={stepper} current={m.run.id === lab.lastRun?.id} onShow={lab.showRun} /></span>}
            </div>
          ))}
          {thinking && <div className="pgc-msg pgc-msg--agent" data-testid="chat-thinking"><b>Agent (simulated)</b><span>Asking the gateway…</span></div>}
          <div ref={end} />
        </div>
      )}
      <Compose text={text} setText={setText} send={send} busy={thinking} placeholder="Ask the agent, or pick a prompt above (Cmd+Enter to send)" prompts={MOCK_PROMPTS} />
    </div>
  );
}

export default function ChatTab({ lab, stepper = null }) {
  return lab.info.source === "mock" ? <MockChat lab={lab} stepper={stepper} /> : <RealChat lab={lab} stepper={stepper} />;
}
