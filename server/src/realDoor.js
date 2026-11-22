// Real mode wiring: the shared gateway-real hop (settings loader + MCP client + wire capture), fed ONLY from this lab's own
// environment (its .env beside docker-compose.yml). The vendored hop words its "not configured" problem with a shared
// settings file this lab does not use, so that wording is never shown: this module shows its own.
import { doorConfig, createRealDoor, createHttpClient } from './gatewayReal.js';
import { ENV_PREFIX } from './config.js';

export const HOWTO = 'Real needs this lab\'s own settings: PGC_GW_URL, PGC_GW_APPS and one PGC_GW_KEY_<NAME> per door in the .env beside docker-compose.yml (see .env.example), then restart the lab. Mock keeps working without them.';
const IDENTITY = /^[A-Za-z0-9._@+-]{1,64}$/;

// The PGC_GW_* settings as the shared loader's "NAME=value" text, from the process environment only. A value with a line
// break is dropped: it could smuggle a second setting.
export function settingsText(env, prefix = ENV_PREFIX) {
  return Object.entries(env)
    .filter(([k, v]) => k.startsWith(`${prefix}_GW_`) && typeof v === 'string' && !/[\r\n]/.test(v))
    .map(([k, v]) => `${k}=${v}`).join('\n');
}

// Only the first sentence of the shared loader's problem is kept; its tail names a file this lab does not read.
const ownProblem = (problem) => `${String(problem).split('. Set ')[0].replace(/\.$/, '')}. ${HOWTO}`;

// -> { available, reason, origin, doors, identity, door } ; door is the shared real door (capture on) or null.
// guard.assertAllowed(url) runs before every call the shared client makes, so only the configured origin is reachable.
export function loadReal(env, guard, { clientInfo = { name: 'privilege-gateway-client-lab', version: '0.1.0' } } = {}) {
  const config = doorConfig(settingsText(env), ENV_PREFIX);
  if (!config.ok) return { available: false, reason: ownProblem(config.problem), origin: null, doors: [], identity: null, door: null, callerIds: new Set() };
  const identityRaw = String(env[`${ENV_PREFIX}_GW_IDENTITY`] ?? '');
  const guarded = (opts) => {
    const c = createHttpClient(opts);
    return { ...c, rpc: async (method, params) => { guard.assertAllowed(opts.url); return c.rpc(method, params); } };
  };
  const door = createRealDoor({ config, client: guarded, clientInfo, capture: true });
  return {
    available: true, reason: null, origin: config.origin,
    doors: config.apps,
    identity: IDENTITY.test(identityRaw) ? identityRaw : null,
    door,
    callerIds: new Set(config.callers.map((c) => c.id)),
  };
}
