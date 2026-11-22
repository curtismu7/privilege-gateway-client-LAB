// Preflight: the same checks GET /api/health reports from, plus whether the port is free.
// Prints only level/id/detail lines, never the value of a setting. Exit 1 on any failure. Needs no network.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* optional: this lab's own .env beside the compose file */ }

const { runChecks } = await import(pathToFileURL(path.join(root, 'server/src/checks.js')));
const { printChecks } = await import(pathToFileURL(path.join(root, 'server/src/doctor.js')));
const { PORT, APP_ID } = await import(pathToFileURL(path.join(root, 'server/src/config.js')));

const checks = runChecks();
let ok = printChecks(checks);

const port = Number(process.env.PORT) || PORT;
// The port is either free, or this lab is already running on it (then its own health answer must say so). Anything else on the port is a failure.
async function labOnPort() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    return body?.schema === 'demo-health/1' && body?.demo?.id === APP_ID ? body : null;
  } catch { return null; }
}
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', async (e) => {
    const running = e.code === 'EADDRINUSE' ? await labOnPort() : null;
    if (running) { ok = ok && running.state === 'ready'; console.log(`[${running.state === 'ready' ? 'pass' : 'fail'}] running: this lab is already on ${port} and its health says ${running.state}`); }
    else { ok = false; console.log(`[fail] port-free: ${port} is not free (${e.code}) and it is not this lab. Free port ${PORT} (this app's one allocated port)`); }
    resolve();
  });
  s.listen(port, '127.0.0.1', () => s.close(() => { console.log(`[pass] port-free: ${port} is free`); resolve(); }));
});
process.exit(ok ? 0 : 1);
