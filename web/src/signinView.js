// Plain words for the sign-in states, from what the server reports in GET /api/auth/config. Nothing here decides who may sign in: the server
// guards (rule 11) do, and this only says which one said no.

const MOCK_WHY = {
  disabled: "Mock sign-in is off. It needs IDP=mock and ALLOW_MOCK_SIGNIN=1 in this lab's own .env (see .env.example), then a restart.",
  real_mode: "Mock sign-in exists in Mock only. Switch Mode to Mock to pick a persona.",
  non_loopback_listener: "Mock sign-in is refused because this lab is listening on more than the loopback address.",
  non_loopback_connection: "Mock sign-in is refused because this request did not come from this machine.",
  proxy_header: "Mock sign-in is refused because the request came through a proxy (a forwarded-for style header was present).",
  non_loopback_host: "Mock sign-in is refused because the page was opened under a name that is not loopback or allow-listed.",
};

// -> { available, why } for the active source. `why` is null when sign-in can be offered.
export function signInState(source, authConfig) {
  if (!authConfig) return { available: false, why: "The sign-in settings could not be read from this lab's server." };
  if (source === "real") {
    const r = authConfig.real;
    if (r?.configured) return { available: true, why: null };
    const problems = Array.isArray(r?.problems) && r.problems.length ? ` Missing: ${r.problems.join("; ")}.` : "";
    return { available: false, why: `Real page login is not configured.${problems} Set the PGC_PINGONE_* names in this lab's own .env (see .env.example), then restart. It is a pi.flow login: a username and password form, no redirect.` };
  }
  const m = authConfig.mock;
  if (m?.available) return { available: true, why: null };
  return { available: false, why: MOCK_WHY[m?.refusal] ?? MOCK_WHY.disabled };
}
