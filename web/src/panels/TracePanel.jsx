import React from "react";
import GatewayTrace from "../gateway-trace/GatewayTrace.jsx";
import { exchangeOf } from "../exchange.js";

// "What Privilege did", the shared GatewayTrace, for the latest run. Mock decisions are `checked`; a Real trace may only say observed or inferred
// (the server decides which, this only draws it). It is one exchange per run, so it is not stepped.
export default function TracePanel({ run }) {
  return (
    <div className="pgc-pane" data-testid="panel-trace-body">
      <GatewayTrace exchanges={run ? [exchangeOf(run)] : []} source={run?.source ?? "mock"} />
    </div>
  );
}
