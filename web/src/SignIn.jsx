import React, { useEffect, useState } from "react";
import FloatingDialog from "./floating-dialog/FloatingDialog.jsx";
import SignInDialog from "./signin-dialog/SignInDialog.jsx";
import { api } from "./api.js";
import { visible } from "./safeText.js";

// Mock sign-in: a persona picker inside a FloatingDialog (rule 8d). The personas are invented and simulated; nothing here is a real account.
// The list comes from the server: aidemo, demouser and demoAdmin, all ordinary users (no admin mark; owner 2026-11-22).
function MockSignIn({ isOpen, onClose, onPick }) {
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    setError(null); setPersonas(null);
    api("/api/auth/mock/personas").then((r) => { if (alive) setPersonas(r.personas); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [isOpen]);
  async function pick(id) {
    setBusy(true); setError(null);
    try { await onPick(id); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="Sign in (Mock)" ariaLabel="Sign in" defaultWidth={400} defaultHeight={null} placement="center" storageKey="pgc.signin.mock" singletonKey="signin" testId="signin-dialog">
      <p className="pgc-note pgc-note--sim"><strong>SIMULATED sign-in.</strong> Pick a persona. Nobody is really signed in anywhere; this only sets the page login this lab shows next to the gateway identity.</p>
      {error && <p className="pgc-error" role="alert" data-testid="signin-error">{visible(error)}</p>}
      {!personas && !error && <p className="pgc-note">Loading personas…</p>}
      <ul className="pgc-personas">
        {(personas ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" className="pgc-persona" disabled={busy} onClick={() => pick(p.id)} data-testid={`persona-${p.id}`}>
              <b>{visible(p.name)}</b><span>{visible(p.email)}</span><span>{visible(p.role)}</span>
            </button>
          </li>
        ))}
      </ul>
    </FloatingDialog>
  );
}

// Real sign-in: the shared dialog with a username and password, driving the pi.flow page login on the server. The password goes to this lab's
// server only and is never stored.
export default function SignIn({ mode, isOpen, onClose, lab }) {
  if (mode === "real") {
    return <SignInDialog isOpen={isOpen} onClose={onClose} onSignIn={lab.signInReal} title="Sign in with PingOne" storageKey="pgc.signin.real" />;
  }
  return <MockSignIn isOpen={isOpen} onClose={onClose} onPick={lab.signInMock} />;
}
