// The pi.flow runs waiting for credentials, one per workspace (server side only: a flow id and PingOne's cookies never leave the server).
// Capped and expired, because starting a sign-in needs no login: on a public host it must not be able to fill the memory.
export function createLoginRunStore({ max = 100, ttlMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const store = new Map(); // insertion order = age
  const fresh = (v) => now() - v.at <= ttlMs;
  return {
    set(ws, run) {
      for (const [k, v] of store) if (!fresh(v)) store.delete(k);
      store.delete(ws);
      while (store.size >= max) store.delete(store.keys().next().value);
      store.set(ws, { run, at: now() });
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
