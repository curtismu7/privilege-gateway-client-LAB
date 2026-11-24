import React from "react";
import Icon from "./Icon.jsx";
import { visible } from "./safeText.js";

// Rule 26: the real source is shown at all times, from GET /api/info, never assumed. A lab that came up in Mock although Real was asked for says
// so in words (amber, with an icon), and a Mock lab that simply has no Real configured says where it stands and how to change that.
export default function ModeStatus({ info, signedIn = false }) {
  const real = info.source === "real";
  const unavailableButWanted = !real && info.realWanted && !info.realAvailable;
  let line;
  if (real) line = <>Source: <b>Real</b>, the gateway named in this lab's own settings. Switching Mode to Mock keeps working at any time.</>;
  else if (info.realAvailable) line = <>Source: <b>Mock</b> (simulated). Real is configured here; switch Mode to Real to use it.</>;
  else if (unavailableButWanted) line = <>Source: <b>Mock</b> (simulated). The Real option is off until it is configured (see above).</>;
  else line = <>Source: <b>Mock</b> (simulated). The Real option is off. {visible(info.realReason ?? "Real is not configured: add this lab's own .env settings and restart; Mock keeps working.")}</>;
  return (
    <div className="pgc-modebar" data-testid="mode-status" data-source={info.source} data-wanted-unavailable={unavailableButWanted ? "true" : "false"}>
      {info.hosted && real && !signedIn && (
        <p className="pgc-note pgc-note--hold" role="status" data-testid="hosted-signin">
          <Icon name="key" /><span><b>Sign in to run the Real lab.</b> This hosted lab calls the real gateway and the real agent only for a signed-in person: use Sign in in the left rail. Mock needs no sign-in.</span>
        </p>
      )}
      {unavailableButWanted && (
        <p className="pgc-note pgc-note--hold pgc-modebar__warn" role="alert" data-testid="mode-unavailable">
          <Icon name="alert" /><span><b>Real was asked for (MODE=real) but is not available, so this lab is showing Mock.</b> {visible(info.realReason ?? "")} Nothing on this page is from a real gateway.</span>
        </p>
      )}
      <p className="pgc-modebar__line" data-testid="mode-source">{line}</p>
    </div>
  );
}
