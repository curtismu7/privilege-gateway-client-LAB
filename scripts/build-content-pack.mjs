// Builds content-pack.json for the Learning Hub, so the pack cannot drift from the lab's identity.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
// The stories come from server/src/data/stories (the same data the app serves), filled with the default cast; the pack carries each
// story's pointer and one-line takeaway. The try-it cards link `/?story=S0n`, which the web app (step 2) opens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, APP_NAME, PORT } from '../server/src/config.js';
import { STORIES } from '../server/src/stories.js';
import { castFor, fill, DEFAULT_VERTICAL } from '../server/src/cast.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const cast = castFor(DEFAULT_VERTICAL);
  return {
    schema: 'demo-content-pack/1',
    id: APP_ID,
    title: APP_NAME,
    version,
    // catalog D144 is provisional (owner, 2026-11-22: D143 belongs to ciba-approval-sequence-LAB); no catalog row truly matches yet.
    demo: { id: APP_ID, name: APP_NAME, catalog: 'D144', baseUrl: `http://localhost:${PORT}`, doctor: '/api/health', tags: ['pingone-privilege', 'agent-gateway', 'ai-agent-security', 'mcp', 'agent-controls', 'simulated', 'real'] },
    glossary: [
      { id: 'door', term: 'Door', definition: 'A standing MCP endpoint on a Privilege gateway. A caller picks a door, lists its tools and calls one. This lab ships three: one that permits every tool, one that permits some, and one that refuses every caller.', aliases: ['MCP door'] },
      { id: 'agent-access-key', term: 'Agent access key', definition: 'The credential an agent presents to a door. In Real mode the lab reads one per door from its own .env; it is write-only and never shown, logged or traced.', aliases: ['agent key'] },
      { id: 'held-call', term: 'Held call', definition: 'A call a gateway pauses until a person approves it. In this lab a hold is Mock only and its body is invented: nobody has captured a real one, so Real never claims it.', aliases: ['hold'] },
      { id: 'verdict', term: 'Verdict', definition: 'The outcome the lab shows first for a call: Allowed, Blocked by policy, Needs sign-in, Held, or Upstream error. A refusal is a result, not a fault.', aliases: [] },
    ],
    sources: [
      { id: 'mcp-spec', title: 'Model Context Protocol specification', url: 'https://modelcontextprotocol.io/specification', kind: 'standard', use: 'The tools/list and tools/call wire the lab speaks to a door.', status: 'not-read', checked: '2026-11-21' },
    ],
    stories: STORIES.map((st) => ({ id: st.id, title: fill(st.title, cast), say: fill(st.say, cast), file: `server/src/data/stories/${st.file}` })),
    cards: [
      { id: 'concept-doors', label: 'The three doors', description: 'All tools, some tools, and none: the same client against three policies.', group: 'concept', action: { type: 'route', href: '/' }, terms: ['door', 'verdict'] },
      ...STORIES.map((st) => ({ id: `try-${st.id.toLowerCase()}`, label: fill(st.title, cast), description: `${fill(st.say, cast).slice(0, 180)}${st.mockOnly ? ' (Mock only)' : ''}`, group: 'try-it', action: { type: 'route', href: `/?story=${st.id}` }, terms: st.id === 'S04' ? ['door', 'held-call', 'verdict'] : ['door', 'verdict'], story: st.id })),
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    documents: [{ id: 'talk-track', path: 'docs/talk-track.md', title: 'Talk track' }],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
