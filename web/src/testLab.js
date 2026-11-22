// Test helper (never imported by the app): the REAL lab core of this repo (the in-process mock gateway, verdicts and hops) behind the same
// paths the page calls, so component and hook tests run on real server shapes, not hand-written copies of them.
import { createLab, LabError } from "../../server/src/lab.js";
import { AgentError } from "../../server/src/agentChat.js";
import catalog from "../../server/src/vendor/hop-catalog.json";
import { ApiError } from "./api.js";
import { validateConfig, publicConfig, castForVertical } from "../../server/src/customer.js";
import { buildStories } from "../../server/src/stories.js";
import { buildTalkTrack } from "../../server/src/talkTrack.js";
import { VERTICALS } from "../../server/src/cast.js";

export function createTestApi({ env = {}, session = null, authConfig = null, hooks = {}, customerConfig = {}, presenter = false } = {}) {
  const lab = createLab({ env, version: "9.9.9", catalog });
  const calls = [];
  const auth = authConfig ?? { workspace: "default", source: lab.mode.get(), idp: "mock", mock: { enabled: true, available: true, refusal: null }, real: { flow: "pi.flow", configured: false, problems: ["not configured"] } };
  let me = session;
  const customer = validateConfig(customerConfig);
  async function api(fullPath, { method = "GET", body } = {}) {
    const [path, q] = fullPath.split("?");
    calls.push({ path: fullPath, method, body });
    if (hooks[path]) { const out = await hooks[path](body, lab); if (out !== undefined) return out; }
    try {
      if (path === "/api/info") return lab.info();
      if (path === "/api/config") return { workspace: "default", presenter, customer: publicConfig(customer) };
      if (path === "/api/stories" || path === "/api/talk-track") {
        const wanted = new URLSearchParams(q ?? "").get("vertical") ?? undefined;
        const pack = castForVertical(customer, wanted ?? undefined);
        if (!pack) throw new ApiError(400, "bad_vertical", `vertical must be one of ${Object.keys(VERTICALS).join(", ")}`);
        return path === "/api/stories" ? { vertical: pack.vertical, stories: buildStories(pack.cast) } : { vertical: pack.vertical, sections: buildTalkTrack(pack.cast) };
      }
      if (path === "/api/session") return { me };
      if (path === "/api/auth/config") return { ...auth, source: lab.mode.get() };
      if (path === "/api/auth/mock/personas") return { personas: [{ id: "aidemo", name: "aidemo", email: "aidemo@example.com", role: "Agent owner" }, { id: "demouser", name: "demouser", email: "demouser@example.com", role: "Page-login user" }, { id: "demoAdmin", name: "demoAdmin", email: "demoadmin@example.com", role: "Page-login user" }] };
      if (path === "/api/auth/mock/login") { me = { source: "mock-persona", id: body.persona, name: body.persona, email: `${body.persona}@example.com`, expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() }; return { ok: true, me }; }
      if (path === "/api/auth/logout") { me = null; return { ok: true }; }
      if (path === "/api/discover") return await lab.discover({ door: body.door, scenario: body.scenario }, {});
      if (path === "/api/call") return await lab.call({ door: body.door, scenario: body.scenario, tool: body.tool, args: body.arguments }, {});
      if (path === "/api/agent") return await lab.agentTurn({ door: body.door, messages: body.messages }, {});
      if (path === "/api/reset") { me = null; return lab.reset(); }
      if (path === "/api/mode") {
        const r = lab.mode.set(body.source);
        if (!r.ok) throw new ApiError(r.status, r.error, r.message);
        return lab.info();
      }
      if (path === "/api/shelf") throw new ApiError(404, "not_found", "no shelf");
    } catch (e) {
      if (e instanceof LabError || e instanceof AgentError) throw new ApiError(e.status, e.code, e.message);
      throw e;
    }
    throw new ApiError(404, "not_found", `no such route ${path}`);
  }
  return { api, lab, calls };
}

// Make the page's real api() (which calls fetch) talk to a test api.
export function fetchFrom(api) {
  return async (path, init = {}) => {
    try {
      const body = init.body ? JSON.parse(init.body) : undefined;
      const json = await api(path, { method: init.method || "GET", body });
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.code ?? "x", message: e.message }), { status: e.status ?? 500, headers: { "content-type": "application/json" } });
    }
  };
}
