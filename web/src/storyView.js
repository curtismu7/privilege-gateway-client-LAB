// Pure helpers for the story picker (rule 10). The story data and its {{cast}} words come from the server; nothing here decides a verdict.

export const STORY_ID = /^S\d{2}$/;

// ?story=S03 -> "S03"; anything else (missing, malformed, hostile) -> null. The id is only ever compared with the server's list.
export function storyIdFromSearch(search) {
  try {
    const v = new URLSearchParams(search).get("story");
    return typeof v === "string" && STORY_ID.test(v) ? v : null;
  } catch { return null; }
}
// A ?story= value that is present but not a story id, so the page can say so instead of ignoring it silently.
export function badStoryParam(search) {
  try {
    const v = new URLSearchParams(search).get("story");
    return v !== null && !STORY_ID.test(v);
  } catch { return false; }
}

// Why a story cannot run right now (a sentence), or null. A Mock-only story is never run in Real (Real never claims a simulated outcome), and a
// story's door must be one of the active mode's doors.
export function storyBlock(story, info) {
  if (!story || !info) return "The lab's settings have not loaded yet.";
  if (info.source === "real" && story.mockOnly) return "This story is simulated, so it runs in Mock only. Switch Mode to Mock to run it; Real never claims a held call, an injected failure or a mismatch it did not observe.";
  if (!info.doors.some((d) => d.id === story.door)) return `This story uses the door ${story.door}, which is not one of the doors this lab offers in ${info.source === "real" ? "Real" : "Mock"}.`;
  return null;
}

// Does a finished run answer this spec ({action, door, tool, scenario})?
export function runMatches(run, spec) {
  if (!run || !spec) return false;
  return run.action === spec.action && run.door === spec.door && (run.tool ?? null) === (spec.tool ?? null) && (run.scenario ?? "none") === (spec.scenario ?? "none");
}

// What the story says should happen, against what happened. null until the matching run exists.
export function storyCheck(run, spec, expect) {
  if (!runMatches(run, spec) || !expect) return null;
  const got = run.verdict?.id;
  const sameVerdict = got === expect.verdict;
  const sameMismatch = expect.mismatch === undefined || Boolean(run.identity?.mismatch) === expect.mismatch;
  const ok = sameVerdict && sameMismatch;
  return { ok, got, want: expect.verdict, word: run.verdict?.word ?? got };
}

export function storyOptionLabel(story, info) {
  const real = info?.source === "real";
  return `${story.id}  ${story.title}${real && story.mockOnly ? " (Mock only)" : ""}`;
}
