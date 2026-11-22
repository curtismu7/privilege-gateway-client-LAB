// The one way the page talks to this lab's server. Every failure becomes an ApiError with a plain message (rule 23: the server answers JSON,
// and a server that cannot be reached is named, never a blank page). Every request carries a W3C traceparent (rule 14): one trace id per page
// load, a new span id per request.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const TRACE_ID = hex(16);
export const pageTraceparent = () => `00-${TRACE_ID}-${hex(8)}-01`;

// Rule 13: the workspace id. Default "default"; ?workspace=<id> picks another, and every request then carries it as X-Workspace. A malformed id is
// never silently the default: the page keeps "default" and says so (workspace.problem), because the server would refuse the header.
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export function readWorkspace(search) {
  let raw = null;
  try { raw = new URLSearchParams(search).get("workspace"); } catch { raw = null; }
  if (raw === null || raw === "") return { id: "default", problem: null };
  if (WORKSPACE.test(raw)) return { id: raw, problem: null };
  return { id: "default", problem: "The workspace id in the address is not valid (1 to 32 lowercase letters, digits and dashes, starting with a letter or digit), so the default workspace is used." };
}
export const workspace = readWorkspace(typeof window === "undefined" ? "" : window.location.search);

// Behind the lab-proxy this page is served at /privilege-gateway-client/. The proxy sends a bare /api/... call to whichever lab last set its shared
// `lab=` cookie, so another lab or the shelf opened in between can take the call and answer 404. Calling through the lab's own path prefix cannot
// be redirected that way. On http://127.0.0.1:7833 the page is at the root and there is no prefix.
const PROXY_PREFIX = "/privilege-gateway-client";
export const apiPrefix = (pathname) => (pathname === PROXY_PREFIX || String(pathname).startsWith(`${PROXY_PREFIX}/`) ? PROXY_PREFIX : "");

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(apiPrefix(typeof window === "undefined" ? "" : window.location.pathname) + path, {
      method,
      credentials: "same-origin",
      signal,
      headers: { Accept: "application/json", traceparent: pageTraceparent(), ...(workspace.id !== "default" ? { "X-Workspace": workspace.id } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, "unreachable", "This lab's server could not be reached. Check that it is still running, then try again.");
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `http_${res.status}`, json?.message ?? json?.reason ?? `This lab's server answered HTTP ${res.status}.`);
  if (json === null) throw new ApiError(res.status, "not_json", "This lab's server answered with something that is not JSON.");
  return json;
}
