// Mock / Real, decided on the server (rule 19). The browser only asks. Real is never switched on or off silently (rule 26):
// the start mode and why are reported by /api/info, and a request for Real when it is not configured is a 409, not a quiet Mock.
import { HOWTO } from './realDoor.js';

export const SOURCES = ['mock', 'real'];

// wanted: the MODE setting ('mock' | 'real' | '' ). Default: Real when it is configured, else Mock.
export function createMode({ wanted = '', realAvailable, realReason }) {
  const want = String(wanted || '').toLowerCase();
  let current;
  let startNote;
  if (want === 'mock') { current = 'mock'; startNote = 'MODE=mock: started in Mock on purpose.'; }
  else if (want === 'real' && !realAvailable) { current = 'mock'; startNote = `MODE=real was asked for, but Real is not configured, so this lab started in Mock. ${realReason ?? HOWTO}`; }
  else if (want === 'real') { current = 'real'; startNote = 'MODE=real: started in Real.'; }
  else if (want && want !== '') { current = realAvailable ? 'real' : 'mock'; startNote = `MODE=${want.slice(0, 20)} is not mock or real and was ignored.`; }
  else { current = realAvailable ? 'real' : 'mock'; startNote = realAvailable ? 'Real is configured, so it is the default.' : `Real is not configured, so this lab started in Mock. ${realReason ?? HOWTO}`; }

  return {
    get: () => current,
    // -> { ok:true, source } | { ok:false, status, error, message }. Body shape is checked by the route.
    set(next) {
      if (!SOURCES.includes(next)) return { ok: false, status: 400, error: 'bad_source', message: 'source must be "mock" or "real"' };
      if (next === 'real' && !realAvailable) return { ok: false, status: 409, error: 'real_not_configured', message: realReason ?? HOWTO };
      current = next;
      return { ok: true, source: current };
    },
    startNote: () => startNote,
    // The person (or the settings) asked for Real. With the mode on Mock and Real unavailable, the page shows that Real was wanted but is missing (rule 26).
    realWanted: want === 'real',
  };
}
