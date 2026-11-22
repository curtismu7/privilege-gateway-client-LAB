// Hard guards for Mock sign-in (rule 11). Every refusal is a stable code and says nothing about secrets.
//   1. Config: IDP=mock AND ALLOW_MOCK_SIGNIN=1 (settings.mockSignin). Without both, the routes are not mounted at all.
//   2. Per request: the listener is loopback (or Docker with the loopback-only publish marker), the connection is local, no proxy header
//      is present (unless the Host is one of the LAB_ALLOWED_HOSTS names, which is how the shared lab-proxy reaches a lab), the Host is
//      loopback or allow-listed, and the lab is in Mock. NODE_ENV is NOT a guard: the Docker image sets it.
import { isLoopbackHost } from '../safety.js';

// Every common way a proxy or CDN tells the app who the real client is. Any one of them means the request did not come straight from this machine.
const PROXY_HEADERS = ['forwarded', 'true-client-ip', 'via', 'x-real-ip', 'x-client-ip', 'fastly-client-ip', 'x-cluster-client-ip'];
const PROXY_PREFIXES = ['x-forwarded-', 'cf-'];

export function proxyHeaderPresent(headers = {}) {
  return Object.keys(headers).some((raw) => {
    const h = raw.toLowerCase();
    return PROXY_HEADERS.includes(h) || PROXY_PREFIXES.some((p) => h.startsWith(p));
  });
}

const loopbackAddr = (a) => typeof a === 'string' && (a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.'));
const hostName = (h) => String(h || '').replace(/:\d+$/, '').toLowerCase().replace(/^\[|\]$/g, '');

// null when the request comes from this machine the way a loopback-only demo expects, else a refusal code.
export function localRequestRefusal(req, cfg) {
  const published = cfg.publish === 'loopback';
  if (!isLoopbackHost(cfg.host) && !published) return 'non_loopback_listener';
  // In Docker the peer is the bridge gateway, not 127.0.0.1: the loopback-only publish stands in for the address check.
  if (!published && (!loopbackAddr(req.socket?.localAddress) || !loopbackAddr(req.socket?.remoteAddress))) return 'non_loopback_connection';
  const host = hostName(req.headers?.host);
  const allowed = (cfg.allowedHosts ?? []).includes(host);
  if (proxyHeaderPresent(req.headers) && !allowed) return 'proxy_header';
  if (!isLoopbackHost(host) && !allowed) return 'non_loopback_host';
  return null;
}

// null when Mock sign-in may be used for this request.
export function mockRequestRefusal(req, cfg, source = 'mock') {
  if (!cfg.mockSignin) return 'disabled';
  if (source !== 'mock') return 'real_mode';
  return localRequestRefusal(req, cfg);
}

