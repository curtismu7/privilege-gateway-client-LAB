// Runtime settings read from the environment (this lab's own .env beside the compose file; see .env.example). Read at call time so tests
// can change the environment. Nothing here is a secret except the session secret, which is never returned or logged.
import path from 'node:path';
import { bindHost } from './safety.js';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function readSettings(env = process.env) {
  const dataDirRaw = String(env.PGC_DATA_DIR || '').trim();
  const hosts = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return {
    host: bindHost(env),
    // The container listens on all interfaces; compose publishes 127.0.0.1 only and says so with LAB_PUBLISH=loopback (rule 11).
    publish: env.LAB_PUBLISH === 'loopback' ? 'loopback' : '',
    allowedHosts: hosts,
    // Rule 11: mock sign-in needs BOTH. IDP=mock and ALLOW_MOCK_SIGNIN=1 (the literal "1"). NODE_ENV is not a guard: the Docker image sets it.
    idp: String(env.IDP || '').toLowerCase(),
    mockSignin: String(env.IDP || '').toLowerCase() === 'mock' && env.ALLOW_MOCK_SIGNIN === '1',
    // Presenter mode (rule 3): the page opens in presenter mode when this is "1"; ?presenter=1 does the same per visit.
    presenter: env.PGC_PRESENTER === '1',
    // Rule 13: where a workspace keeps files (its trace sink). Empty = memory only.
    dataDir: dataDirRaw ? path.resolve(dataDirRaw) : '',
    sessionSecret: String(env.PGC_SESSION_SECRET || ''),
    sessionTtlMs: num(env.PGC_SESSION_TTL_MS, 8 * 3600 * 1000),
  };
}
