// Workspaces (rule 13). A workspace id (default "default", header X-Workspace) scopes the run log, the trace sink, the sign-in session
// and the workspace's data directory. Reset clears one workspace. State is created on first use; the number of workspaces is capped (the default workspace is exempt, and Reset frees a slot).
// Shared by every workspace, on purpose: the in-process mock gateway (its MCP sessions are per run and a Reset clears them all), the
// netguard counters and the mode (Mock or Real). A workspace is a visitor's own run history and sign-in, not a second lab.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_WORKSPACE = 'default';
export const MAX_WORKSPACES = 20;
export const MAX_RUNS = 20;
export const WORKSPACE_HEADER = 'x-workspace';
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SINK_MAX_BYTES = 1024 * 1024;

export const validWorkspace = (id) => typeof id === 'string' && ID.test(id);

export class WorkspaceError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

// The workspace id from a request: absent = default; a malformed one is an error, never silently the default.
export function workspaceFrom(req) {
  const raw = req.headers[WORKSPACE_HEADER];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  if (!validWorkspace(raw)) throw new WorkspaceError('bad_workspace', 400, 'X-Workspace must be 1 to 32 lowercase letters, digits and dashes, starting with a letter or digit');
  return raw;
}

// One trace sink per workspace: the last runs' redacted hops, in memory, and (only when a data directory is configured) a JSON-lines
// file under <dataDir>/<workspace>/. The file is capped; nothing but already-redacted run facts is written (no key, no cookie).
function createSink({ dir }) {
  let entries = [];
  const file = dir ? path.join(dir, 'trace.jsonl') : null;
  return {
    add(entry) {
      entries = [entry, ...entries].slice(0, MAX_RUNS);
      if (!file) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file) || fs.statSync(file).size < SINK_MAX_BYTES) fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      } catch { /* a read-only or full disk must not break a run: the in-memory sink still has it */ }
    },
    entries: () => entries.map((e) => structuredClone(e)),
    clear() {
      entries = [];
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to remove */ } }
    },
    file: () => file,
  };
}

export function createWorkspaces({ dataDir = '', max = MAX_WORKSPACES } = {}) {
  const all = new Map();
  const build = (id) => ({ id, runs: [], sink: createSink({ dir: dataDir ? path.join(dataDir, id) : null }), createdAt: Date.now() });
  return {
    get(id = DEFAULT_WORKSPACE) {
      if (!validWorkspace(id)) throw new WorkspaceError('bad_workspace', 400, 'bad workspace id');
      let ws = all.get(id);
      if (!ws) {
        // The default workspace is always admitted: 20 other ids must never lock the person on the plain page out of the lab.
        if (id !== DEFAULT_WORKSPACE && [...all.keys()].filter((k) => k !== DEFAULT_WORKSPACE).length >= max) throw new WorkspaceError('too_many_workspaces', 429, `at most ${max} workspaces; reset one or restart the lab`);
        ws = build(id);
        all.set(id, ws);
      }
      return ws;
    },
    peek: (id = DEFAULT_WORKSPACE) => all.get(id) ?? null,
    ids: () => [...all.keys()],
    // Reset gives the slot back: the workspace is forgotten and starts fresh on its next use. One that was never created takes no slot
    // (a full cap must not make Reset fail), but its data directory, if any, is still cleared.
    reset(id) {
      if (!validWorkspace(id)) throw new WorkspaceError('bad_workspace', 400, 'bad workspace id');
      const ws = all.get(id) ?? build(id);
      ws.runs.length = 0;
      ws.sink.clear();
      all.delete(id);
      return ws;
    },
  };
}
