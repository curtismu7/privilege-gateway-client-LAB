import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { interpret, replyFor } from "./agent.js";
import { visible } from "./safeText.js";

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

function Chip({ run, onShow }) {
  if (!run) return null;
  const v = run.verdict;
  return (
    <button type="button" className="pgc-chipword pgc-chipword--btn" data-verdict={v.id} onClick={() => onShow(run)} title="Show this run in Evidence and the panels" data-testid="chat-step-chip">
      <Icon name={ICON[v.id] ?? "alert"} />{v.word}
    </button>
  );
}

// What the agent did in one turn: the discovery, then each tool call with the gateway's verdict. A chip opens that run in Evidence.
function Steps({ steps, onShow }) {
  if (!steps?.length) return null;
  return (
    <ol className="pgc-steps" data-testid="chat-steps">
      {steps.map((s, i) => (
        <li key={i} data-testid={`chat-step-${s.kind}`}>
          {s.kind === "discover"
            ? <span>Asked the gateway for this door's tools{s.run?.tools ? `: ${s.run.tools.length} listed` : ""}</span>
            : <span>Called <code>{visible(s.tool)}</code> <code className="pgc-steps__args">{visible(JSON.stringify(s.args ?? {})).slice(0, 160)}</code>{s.labError ? ` — not sent: ${visible(s.labError)}` : ""}</span>}
          <Chip run={s.run} onShow={onShow} />
        </li>
      ))}
    </ol>
  );
}

function Compose({ text, setText, send, busy, placeholder }) {
  return (
    <div className="pgc-compose">
      <div>
        <label className="pgc-lbl" htmlFor="pgc-ask">Message</label>
        <textarea id="pgc-ask" value={text} maxLength={2000} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} data-testid="chat-input" />
      </div>
      <button type="button" className="pgc-go" disabled={!text.trim() || busy} onClick={send} data-testid="chat-send">Send</button>
    </div>
  );
}

// The REAL agent (Real only): a Claude model that the lab server runs. Every tool it picks goes through the real gateway as a normal run.
function RealChat({ lab }) {
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
        <strong>REAL agent</strong> ({visible(agent.model ?? "Claude")}). Each message calls the model through the Anthropic API, billed to the key in this lab's .env. Every tool it picks goes to the real gateway with this door's agent key, and the gateway decides.
      </p>
      {msgs.length === 0 ? (
        <div className="pgc-empty pgc-empty--chat"><h3>Ask the agent to do something with the tools on {visible(lab.door)}</h3><p>Try: “who has access to prod-db-primary?”, “what entitlements does carol.nguyen have?” or “what can you do here?”.</p></div>
      ) : (
        <div className="pgc-chat" aria-live="polite" data-testid="chat-log">
          {msgs.map((m, i) => (
            <div key={i} className={`pgc-msg pgc-msg--${m.who}${m.local || (m.stopped && !["done"].includes(m.stopped)) ? " pgc-msg--stopped" : ""}`} data-testid={`msg-${m.who}`} data-stopped={m.stopped ?? undefined}>
              <b>{m.who === "you" ? "You" : m.by === "lab" || m.local ? "Lab (agent stopped)" : "Agent (Claude)"}</b>
              <span className="pgc-msg__text">{visible(plainReply(m.text))}</span>
              <Steps steps={m.steps} onShow={lab.showRun} />
            </div>
          ))}
          {thinking && <div className="pgc-msg pgc-msg--agent" data-testid="chat-thinking"><b>Agent (Claude)</b><span>Thinking and asking the gateway…</span></div>}
          <div ref={end} />
        </div>
      )}
      <Compose text={text} setText={setText} send={send} busy={thinking || Boolean(lab.busy)} placeholder="Ask the agent... (Cmd+Enter to send)" />
    </div>
  );
}

// A SIMULATED agent (Mock only). It calls no model: agent.js reads the message, the lab's own server answers the call, and the reply is worded
// from the verdict that came back. One refused tool is one reply; it never changes the door's other tools.
function MockChat({ lab }) {
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
    setMsgs((m) => [...m, { who: "agent", ...replyFor(plan, { run, door: lab.door, name: run.identity?.name }) }]);
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
            </div>
          ))}
          {thinking && <div className="pgc-msg pgc-msg--agent" data-testid="chat-thinking"><b>Agent (simulated)</b><span>Asking the gateway…</span></div>}
          <div ref={end} />
        </div>
      )}
      <Compose text={text} setText={setText} send={send} busy={thinking} placeholder="Ask the agent... (Cmd+Enter to send)" />
    </div>
  );
}

export default function ChatTab({ lab }) {
  return lab.info.source === "mock" ? <MockChat lab={lab} /> : <RealChat lab={lab} />;
}
