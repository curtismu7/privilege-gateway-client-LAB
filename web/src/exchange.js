// One run as the exchange the shared GatewayTrace draws ("What Privilege did"). The trace comes from the server's run record; nothing is made up here.
export function exchangeOf(run) {
  const t = run.trace;
  return { step: 1, title: run.action === "discover" ? "tools/list" : `tools/call ${run.tool}`, status: t?.response?.status ?? null, trace: t };
}
