import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { interpret, replyFor } from "./agent.js";
import { visible } from "./safeText.js";

const ICON = { allowed: "check", blocked: "lock", held: "hourglass", upstream: "unplug", "needs-sign-in": "key", "bad-request": "alert" };

// A SIMULATED agent (Mock only). It calls no model: agent.js reads the message, the lab's own server answers the call, and the reply is worded
// from the verdict that came back. One refused tool is one reply; it never changes the door's other tools.
export default function ChatTab({ lab }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, thinking]);
  const mock = lab.info.source === "mock";

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

  if (!mock) {
    return (
      <div className="pgc-empty" data-testid="chat-real">
        <Icon name="alert" className="pgc-empty__ico" />
        <h3>The agent chat is a Mock-only simulation</h3>
        <p>It calls no model and there is no real agent behind it, so it is not offered in Real. Use the Tools tab to run a tool against the real gateway.</p>
      </div>
    );
  }
  return (
    <div data-testid="chat-panel">
      <p className="pgc-note pgc-note--sim" data-testid="chat-sim-note"><strong>SIMULATED agent.</strong> No model is called. It reads your message, asks the lab's simulated gateway, and tells you what that gateway decided.</p>
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
      <div className="pgc-compose">
        <div>
          <label className="pgc-lbl" htmlFor="pgc-ask">Message</label>
          <textarea id="pgc-ask" value={text} placeholder="Ask the agent... (Cmd+Enter to send)" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} data-testid="chat-input" />
        </div>
        <button type="button" className="pgc-go" disabled={!text.trim() || thinking} onClick={send} data-testid="chat-send">Send</button>
      </div>
    </div>
  );
}
