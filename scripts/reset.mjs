// Reset the running lab to a clean state (same as POST /api/reset): the workspace's run log, trace sink and sign-in session, the mock
// gateway sessions and faults and the netguard counters. The mode (Mock or Real) is left as it is. PGC_WORKSPACE picks the workspace
// (default "default"). Loopback only; needs the lab to be running.
const port = Number(process.env.PORT) || 7833;
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.PGC_WORKSPACE || 'default';
try {
  const res = await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-workspace': workspace }, body: '{}', signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? body.error ?? ''}`);
  console.log(`reset ok (workspace ${body.workspace}): cleared ${body.cleared.join(', ')}; mode stays ${body.mode}`);
} catch (e) {
  console.error(`reset failed: ${e.message}. Is the lab running on port ${port}?`);
  process.exit(1);
}
