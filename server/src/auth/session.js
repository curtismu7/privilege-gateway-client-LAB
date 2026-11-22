// A signed cookie session (HMAC-SHA256): a persona id (Mock) or a few verified claims (Real page login), a workspace id and an expiry.
// No token is ever stored in it. One cookie per workspace, so signing in to one workspace never signs anyone in to another.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const cookieName = (workspace) => `pgc_session_${workspace}`;

// The value of the cookie called `name` in a Cookie header, or null. Whole-name compare, so "xpgc_session_a" is not "pgc_session_a".
export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value) return value;
  }
  return null;
}

export function createSessions({ secret, ttlMs, now = Date.now }) {
  const key = secret || randomBytes(32).toString('hex'); // no secret configured: sessions die with the process
  const sign = (b) => createHmac('sha256', key).update(b).digest('base64url');
  const pack = (payload) => { const body = Buffer.from(JSON.stringify({ ...payload, e: now() + ttlMs })).toString('base64url'); return `${body}.${sign(body)}`; };
  return {
    issuePersona: (persona, workspace) => pack({ p: persona, w: workspace }),
    issueClaims: (claims, workspace) => pack({ c: claims, w: workspace }),
    // -> { persona } | { claims } | null
    read(cookieHeader, workspace) {
      const raw = cookieValue(cookieHeader, cookieName(workspace));
      if (!raw) return null;
      const [body, sig, extra] = raw.split('.');
      if (!body || !sig || extra !== undefined) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const v = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (v.w !== workspace || !(v.e > now())) return null;
        if (v.c && typeof v.c === 'object' && typeof v.c.sub === 'string') return { claims: v.c };
        return typeof v.p === 'string' ? { persona: v.p, expiresAt: v.e } : null;
      } catch { return null; }
    },
    cookie: (value, maxAgeSec, workspace) => `${cookieName(workspace)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`,
  };
}
