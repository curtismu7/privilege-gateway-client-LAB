import React from "react";

// The simulation banner: first in the page on every tab (rule 2), also in presenter mode. It says what is simulated. In Real it flips to
// data-state="live" and says what is real and what this lab can and cannot see.
export default function SimulationBanner({ source = "mock", origin = null }) {
  if (source === "real") {
    return (
      <div className="banner" role="note" data-testid="sim-banner" data-state="live">
        <strong>Real</strong>: calls go to the gateway named in this lab's own settings{origin ? ` (${origin})` : ""}, with the agent key kept for the chosen door on this server. What you see is what the gateway answered.
        It does not report its own checks, so each decision here is observed (read from the answer) or inferred (concluded from it).
      </div>
    );
  }
  return (
    <div className="banner" role="note" data-testid="sim-banner">
      <strong>Simulation</strong>: the gateway, its three doors, the tools, the tokens and the identities on this page are simulated inside this lab's own process.
      Nothing leaves this machine and no real tenant, key or person is involved. Held calls, scenarios and the agent chat are simulated too.
    </div>
  );
}
