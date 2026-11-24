// The lab's own preflight checks, in the shared doctor contract (see ./doctor.js). Shared by `npm run doctor` and GET /api/health.
// Synchronous, no network, never prints a setting's value.
import { nodeCheck } from './doctor.js';
import { assertBindAllowed, bindHost, portProblem } from './safety.js';
import { PORT } from './config.js';
import { selfTest as netguardSelfTest } from './netguard.js';
import { agentConfig } from './agentChat.js';
import { DOORS, TOOLS, grantedTools } from './doors.js';
import { doorConfig } from './gatewayReal.js';
import { settingsText } from './realDoor.js';
import { STORIES, scanStories } from './stories.js';
import { VERTICALS } from './cast.js';
import { loadCustomerConfig } from './customer.js';
import { loadTalkTrack } from './talkTrack.js';
import { readSettings } from './settings.js';
import { loginConfig } from './auth/pingoneLogin.js';
import { isLoopbackHost } from './safety.js';

export function runChecks(env = process.env, { scan = scanStories } = {}) {
  const checks = [nodeCheck(26)];
  try { checks.push({ id: 'bind', level: 'pass', detail: `${assertBindAllowed(bindHost(env), env)}${env.PGC_BIND ? ' (PGC_BIND opt-in)' : ' (loopback)'}` }); }
  catch (e) { checks.push({ id: 'bind', level: 'fail', detail: e.message }); }
  const port = env.PORT === undefined || env.PORT === '' ? PORT : Number(env.PORT);
  const problem = portProblem(port);
  checks.push({ id: 'port', level: problem ? 'fail' : 'pass', detail: problem || `${port} ${port === PORT ? 'is the allocated port' : `is accepted (PORT from the environment; this lab's allocated port is ${PORT})`} and not reserved` });
  const ng = netguardSelfTest();
  checks.push({ id: 'netguard', level: ng.ok ? 'pass' : 'fail', detail: ng.ok ? `self-test: ${ng.checks.length} policy cases hold (Mock reaches nothing but the in-process mock; Real reaches one configured origin)` : `self-test failed: ${ng.checks.filter((c) => !c.ok).map((c) => c.name).join('; ')}` });
  const shape = DOORS.map((d) => `${d.id}=${grantedTools(d).length}`).join(', ');
  const shapeOk = TOOLS.length === 18 && DOORS.length === 3 && grantedTools(DOORS[0]).length === 18 && grantedTools(DOORS[1]).length === 7 && grantedTools(DOORS[2]).length === 0;
  checks.push({ id: 'mock-gateway', level: shapeOk ? 'pass' : 'fail', detail: `${TOOLS.length} tools, doors permit: ${shape}; in-process, no socket` });
  const real = doorConfig(settingsText(env), 'PGC');
  checks.push({ id: 'real', level: 'info', detail: real.ok ? `Real is configured for ${real.apps.length} door(s) and ${real.callers.length} key(s) (names and values are not printed). It is the default; Mock stays one click away.` : 'Real is not configured, so the lab starts in Mock. Real settings (PGC_GW_URL, PGC_GW_APPS, PGC_GW_KEY_<NAME>) come only from this lab\'s own .env.' });
  const agent = agentConfig(env);
  checks.push({ id: 'agent', level: 'info', detail: agent.configured ? `The Real agent chat is configured (model ${agent.model}, ${agent.via === 'llm-gateway' ? 'through the Privilege LLM gateway' : 'on the Anthropic API'}; the key is not printed). It calls the model only in Real.` : `The Real agent chat is not configured: ${agent.reason} The Chat tab in Real says so and the Tools tab still works.` });
  const sc = scan();
  checks.push({ id: 'stories', level: sc.missing.length === 0 && sc.stories >= 6 && Object.keys(VERTICALS).length === 3 ? 'pass' : 'fail', detail: sc.missing.length ? `undefined {{cast}} tokens: ${sc.missing.slice(0, 3).join('; ')}` : `${STORIES.length} stories use ${sc.tokens.length} {{cast}} tokens, all defined by each of ${Object.keys(VERTICALS).length} vertical packs` });
  const cust = loadCustomerConfig({ env });
  checks.push({ id: 'customer-config', level: cust.warnings.length ? 'info' : 'pass', detail: cust.warnings.length ? `customer.config problems (defaults used for them): ${cust.warnings.slice(0, 3).join('; ')}` : `branding and vocabulary ok (vertical ${cust.config.vertical})` });
  const talk = loadTalkTrack();
  checks.push({ id: 'talk-track', level: talk.length >= 8 ? 'pass' : 'fail', detail: talk.length ? `docs/talk-track.md: ${talk.length} sections` : 'docs/talk-track.md is missing or empty' });
  const st = readSettings(env);
  const listener = isLoopbackHost(st.host) || st.publish === 'loopback';
  checks.push({ id: 'mock-signin', level: st.mockSignin && !listener ? 'fail' : 'pass', detail: st.mockSignin ? (listener ? 'Mock sign-in is on (IDP=mock and ALLOW_MOCK_SIGNIN=1), and every request is checked: loopback listener, local connection, no proxy header, Mock mode' : 'Mock sign-in is on but the listener is not loopback: refusing') : 'Mock sign-in is off (it needs IDP=mock and ALLOW_MOCK_SIGNIN=1); no persona routes are mounted' });
  const login = loginConfig(env);
  checks.push({ id: 'page-login', level: 'info', detail: login.ok ? 'Real page login (pi.flow) is configured; the password is typed in the dialog and never stored' : `Real page login (pi.flow) is not configured: ${login.problems.join('; ')}. Mock needs none of it.` });
  checks.push({ id: 'tenant', level: 'info', detail: 'Mock needs no tenant and no credentials. Real settings (gateway URL, door names, agent keys) come only from this lab\'s own .env; their values are never printed.' });
  return checks;
}
