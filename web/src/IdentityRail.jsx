import React, { useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { NOT_NAMED } from "./verdictView.js";
import { visible } from "./safeText.js";
import { signInState } from "./signinView.js";

const initials = (name) => String(name ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
const SCENARIO_LABEL = {
  none: "None: a normal run",
  "no-key": "No agent key is sent",
  "bad-key": "A wrong agent key is sent",
  "upstream-error": "The gateway's upstream fails (502)",
  "identity-mismatch": "Page login differs from the gateway identity",
};

// The door picker: a radio group with one tab stop. Arrow keys move the choice and the focus together; Home and End jump.
export function DoorPicker({ doors, value, onChange, disabled }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const key = e.key;
    let next = null;
    if (key === "ArrowDown" || key === "ArrowRight") next = (i + 1) % doors.length;
    else if (key === "ArrowUp" || key === "ArrowLeft") next = (i - 1 + doors.length) % doors.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = doors.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(doors[next].id);
    refs.current[doors[next].id]?.focus();
  };
  const checkedIndex = Math.max(0, doors.findIndex((d) => d.id === value));
  return (
    <div className="pgc-doors" role="radiogroup" aria-label="Door: the app you are calling through the gateway" data-testid="door-picker">
      {doors.map((d, i) => {
        const on = d.id === value;
        return (
          <button key={d.id} type="button" role="radio" aria-checked={on} tabIndex={i === checkedIndex ? 0 : -1} className="pgc-door" data-testid={`door-${d.id}`}
            ref={(el) => { refs.current[d.id] = el; }} aria-disabled={disabled || undefined} onClick={() => !disabled && onChange(d.id)} onKeyDown={(e) => onKey(e, i)}>
            <span className="pgc-door__radio" aria-hidden="true" />
            <span className="pgc-door__name">{visible(d.id)}</span>
            <span className="pgc-door__desc">{visible(d.description ?? "A door named in this lab's settings.")}{d.keyed === false ? " No agent key is set for it." : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

function expiryText(iso, now = Date.now()) {
  const left = Date.parse(iso) - now;
  if (!Number.isFinite(left)) return null;
  const m = Math.max(0, Math.round(left / 60000));
  return m >= 120 ? `Session ends in ${Math.round(m / 60)} h` : `Session ends in ${m} min`;
}

export default function IdentityRail({ lab, onSignIn, open, onToggle }) {
  const { info, door, identity, me, authConfig, scenario, setScenario, busy } = lab;
  const mock = info.source === "mock";
  const { available: canSignIn, why: signInWhy } = signInState(info.source, authConfig);
  const doorUrl = info.gateway?.origin ? `${info.gateway.origin}/${door}/mcp` : null;
  const gwName = identity?.name;
  return (
    <aside className="pgc-rail" aria-label="Identity and door" data-open={open ? "true" : "false"} data-testid="rail">
      <button type="button" className="pgc-rail__toggle" aria-expanded={open} aria-controls="pgc-rail-body" onClick={onToggle} data-testid="rail-toggle">
        <span>Identity and door: <b className="pgc-mono">{visible(door ?? "none")}</b></span>
        <Icon name="down" className="pgc-rail__chev" />
      </button>
      <div className="pgc-rail__body" id="pgc-rail-body">
        <section aria-labelledby="pgc-who-h" className="pgc-rail__sec">
          <h2 id="pgc-who-h">{mock ? "Who the gateway evaluates" : "Identity this lab declares"}</h2>
          <div className="pgc-id" data-testid="gateway-identity">
            <span className={`pgc-avatar${gwName ? "" : " pgc-avatar--off"}`} aria-hidden="true">{gwName ? initials(gwName) : <Icon name="key" />}</span>
            <div className="pgc-id__who">
              <div className="pgc-id__name" data-testid="gateway-identity-name">{gwName ? visible(gwName) : NOT_NAMED}</div>
              {identity?.email && <div className="pgc-id__mail">{visible(identity.email)}</div>}
            </div>
            <span className="pgc-badge"><Icon name={mock ? "check" : "key"} />{visible(identity?.label)}</span>
            {identity?.note && <p className="pgc-id__note">{visible(identity.note)}</p>}
            {identity?.mismatch && (
              <p className="pgc-note pgc-note--mismatch pgc-id__mm" role="note"><strong>SIMULATED scenario.</strong> Page login: {visible(identity.pageLogin?.name)}. The decisions below apply to {visible(identity.name)}, not to the page login.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="pgc-login-h" className="pgc-rail__sec">
          <h2 id="pgc-login-h">Page login</h2>
          <div className="pgc-login" data-testid="page-login">
            {me ? (
              <>
                <div className="pgc-id__name" data-testid="page-login-name">{visible(me.name ?? me.username ?? me.sub)}</div>
                <div className="pgc-id__mail">{me.source === "mock-persona" ? "Mock persona (simulated sign-in)" : "Signed in with PingOne (pi.flow)"}</div>
                {mock && me.expiresAt && <div className="pgc-id__mail" data-testid="session-expiry">{expiryText(me.expiresAt)}</div>}
                <button type="button" onClick={lab.signOut} data-testid="rail-sign-out">Sign out</button>
              </>
            ) : (
              <>
                <div className="pgc-id__name">Not signed in</div>
                <div className="pgc-id__mail" id="pgc-signin-why" data-testid="signin-why">{canSignIn ? "No page login yet. The gateway calls on this page do not need one." : signInWhy}</div>
                <button type="button" onClick={onSignIn} disabled={!canSignIn} aria-describedby="pgc-signin-why" title={canSignIn ? undefined : signInWhy} data-testid="rail-sign-in">Sign in</button>
              </>
            )}
            <p className="pgc-id__mail pgc-login__note" data-testid="login-note">
              {mock
                ? "A Mock page login only shows who is at this page. The gateway still evaluates the identity behind the door's agent key."
                : "A page login proves who is at this page. The gateway evaluates the identity of the door's agent key, which this lab can only show as declared by its own settings."}
            </p>
          </div>
        </section>

        <section aria-labelledby="pgc-door-h" className="pgc-rail__sec">
          <h2 id="pgc-door-h">Which door</h2>
          <DoorPicker doors={info.doors} value={door} onChange={lab.chooseDoor} disabled={Boolean(busy)} />
          {doorUrl && <div className="pgc-url pgc-mono" data-testid="door-url">{visible(doorUrl)}</div>}
        </section>

        <details className="pgc-adv" data-testid="advanced">
          <summary>Advanced</summary>
          <div className="pgc-adv__body">
            <label htmlFor="pgc-scenario">Simulated scenario (Mock only)</label>
            <select id="pgc-scenario" value={mock ? scenario : "none"} disabled={!mock || Boolean(busy)} onChange={(e) => setScenario(e.target.value)} data-testid="scenario-select">
              {(mock ? info.scenarios : ["none"]).map((s) => <option key={s} value={s}>{SCENARIO_LABEL[s] ?? s}</option>)}
            </select>
            <p className="pgc-adv__note">{mock ? "A scenario is simulated: it changes what the lab's own gateway does for the next run, so you can see each verdict. It is not a test of a real gateway." : "Scenarios are simulated and exist in Mock only. Real shows what the gateway really did."}</p>
            <dl className="pgc-kv">
              <dt>Gateway</dt><dd className="pgc-mono">{visible(info.gateway?.origin ?? "")}{info.gateway?.simulated ? " (simulated, in this process)" : ""}</dd>
              <dt>Agent key</dt><dd>{mock ? "A mock key, kept on the server." : "Kept on the server, never sent to this page."}</dd>
              <dt>Lab version</dt><dd>v{visible(info.version)}</dd>
            </dl>
          </div>
        </details>
      </div>
    </aside>
  );
}
