import { fileURLToPath } from 'node:url';
import { createApp, startHttpServer } from './app.js';
import { runChecks } from './checks.js';
import { allPassed } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { APP_ID } from './config.js';

// The lab's own .env, beside the compose file. Never ~/Documents or ~/Development/.env.
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env: Mock only */ }

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[${APP_ID}] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const host = assertBindAllowed(bindHost(), process.env);
const { app } = createApp();
const { url } = await startHttpServer({ port: resolvePort(), host, app });
console.log(`[${APP_ID}] lab at ${url} (loopback; mock, no outbound network)`);
console.log(`[${APP_ID}] health: ${url}api/health`);
