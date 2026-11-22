import { useCallback, useEffect, useState } from "react";
import { api as realApi } from "./api.js";

// Branding, the stories and the talk track, all from this lab's server (rules 10, 12 and 3). The words in the stories and the talk track are
// already filled in by the server (the {{cast}} tokens), for the chosen vertical; the page never fills a token itself.
// A failure here is not fatal: the lab still works, and the story area says what could not be loaded.
export function useContent({ api = realApi } = {}) {
  const [config, setConfig] = useState(null);
  const [vertical, setVertical] = useState(null);
  const [stories, setStories] = useState(null); // null = loading
  const [talk, setTalk] = useState(null);
  const [error, setError] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const c = await api("/api/config");
      setConfig(c);
      setVertical((v) => v ?? c.customer?.vertical ?? null);
      setError(null);
    } catch (e) { setError(e); setStories([]); setTalk([]); }
  }, [api]);
  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (!vertical) return undefined;
    let alive = true;
    const q = `?vertical=${encodeURIComponent(vertical)}`;
    Promise.all([api(`/api/stories${q}`), api(`/api/talk-track${q}`)])
      .then(([s, t]) => { if (alive) { setStories(s.stories); setTalk(t.sections); setError(null); } })
      .catch((e) => { if (alive) { setError(e); setStories([]); setTalk([]); } });
    return () => { alive = false; };
  }, [api, vertical]);

  return { config, customer: config?.customer ?? null, presenter: Boolean(config?.presenter), workspaceInUse: config?.workspace ?? "default", vertical, setVertical, stories, talk, error, reload: loadConfig };
}
