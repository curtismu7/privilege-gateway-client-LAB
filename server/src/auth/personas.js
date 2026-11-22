// The seeded personas for Mock sign-in (rule 11). Invented, neutral names; nothing here is a real account.
//   aidemo    the identity the simulated gateway evaluates (the agent key's identity). Signing in as it makes no mismatch.
//   demouser  an ordinary page-login user. Signed in as demouser, a Mock run can show the page login and the gateway identity apart.
//   demoAdmin a normal user (owner, 2026-11-22). Only its name differs from demouser: no admin flag, no switch file, no extra privilege anywhere.
import { MOCK_IDENTITY, MOCK_PAGE_LOGIN } from '../doors.js';

export const PERSONAS = Object.freeze({
  aidemo: { id: 'aidemo', name: MOCK_IDENTITY.name, email: MOCK_IDENTITY.email, role: 'Agent owner: the identity the simulated gateway evaluates' },
  demouser: { id: 'demouser', name: MOCK_PAGE_LOGIN.name, email: MOCK_PAGE_LOGIN.email, role: 'Page-login user: a person who is not the key\'s identity' },
  demoAdmin: { id: 'demoAdmin', name: 'demoAdmin', email: 'demoadmin@example.com', role: 'Page-login user: a person who is not the key\'s identity' },
});

export const personaIds = () => Object.keys(PERSONAS);
export const personaById = (id) => (typeof id === 'string' && Object.hasOwn(PERSONAS, id) ? PERSONAS[id] : null);
