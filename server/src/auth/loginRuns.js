// The pi.flow runs waiting for credentials, one per workspace (server side only: a flow id and PingOne's cookies never leave the server).
// Capped and expired, because starting a sign-in needs no login: on a public host it must not be able to fill the memory.
// whenFull: 'evict' drops the oldest run (the local lab); 'refuse' keeps every pending run and returns false (the hosted lab: starting needs
// no login, and a request with no cookie is a new workspace, so evicting would let anyone cancel everyone else's sign-in).
export function createLoginRunStore({ max = 100, ttlMs = 10 * 60 * 1000, now = Date.now, whenFull = 'evict' } = {}) {
  const store = new Map(); // insertion order = age
  const fresh = (v) => now() - v.at <= ttlMs;
  return {
    set(ws, run) {
      for (const [k, v] of store) if (!fresh(v)) store.delete(k);
      store.delete(ws); // one pending run per workspace: a new start replaces that browser's earlier one
      if (whenFull === 'refuse' && store.size >= max) return false;
      while (store.size >= max) store.delete(store.keys().next().value);
      store.set(ws, { run, at: now() });
      return true;
    },
    get(ws) {
      const v = store.get(ws);
      if (!v) return undefined;
      if (!fresh(v)) { store.delete(ws); return undefined; }
      return v.run;
    },
    delete: (ws) => store.delete(ws),
    get size() { return store.size; },
  };
}
