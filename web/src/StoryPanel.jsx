import React from "react";
import Icon from "./Icon.jsx";
import { visible } from "./safeText.js";
import { storyBlock, storyCheck, storyOptionLabel } from "./storyView.js";

// The story picker (rule 10). The stories are data on the server, with the vertical's words already filled in. Choosing one sets its door and
// scenario and runs it; the verdict that comes back is the server's, and the check line says whether it is the one the story expects.
function CheckLine({ check, testId }) {
  if (!check) return null;
  return (
    <p className={`pgc-story__check${check.ok ? "" : " pgc-story__check--off"}`} role="status" data-testid={testId}>
      <Icon name={check.ok ? "check" : "alert"} />
      {check.ok ? `This run gave ${visible(check.word)}, as the story says.` : `This run gave ${visible(check.word)}, but the story expects ${visible(check.want)}.`}
    </p>
  );
}

export default function StoryPanel({ stories, info, lastRun, activeId, onSelect, onRun, busy, error, urlNote, vertical }) {
  const list = stories ?? [];
  const story = list.find((s) => s.id === activeId) ?? null;
  const block = story ? storyBlock(story, info) : null;
  const real = info?.source === "real";
  return (
    <section className="pgc-stories" aria-labelledby="pgc-stories-h" data-testid="stories">
      <div className="pgc-stories__bar">
        <h2 id="pgc-stories-h">Stories{vertical ? <span className="pgc-stories__v"> · {visible(vertical)}</span> : null}</h2>
        <select id="pgc-story-select" aria-label="Choose a story" value={story ? story.id : ""} disabled={stories === null || list.length === 0} data-testid="story-select"
          onChange={(e) => onSelect(e.target.value || null)}>
          <option value="">{stories === null ? "Loading stories…" : "Explore freely (no story)"}</option>
          {list.map((s) => <option key={s.id} value={s.id}>{visible(storyOptionLabel(s, info))}</option>)}
        </select>
      </div>
      {urlNote && <p className="pgc-note pgc-note--hold" role="status" data-testid="story-urlnote">{urlNote}</p>}
      {error && <p className="pgc-note pgc-note--hold" role="status" data-testid="story-error">Stories could not be loaded: {visible(error.message)} The rest of the lab works.</p>}
      {!story && !error && stories !== null && <p className="pgc-stories__hint">Six short stories, each one run: a door that permits everything, one that permits some, one that permits none, a held call, an upstream failure and an identity mismatch.{real ? " The Mock-only ones are marked." : ""}</p>}
      {story && (
        <article className="pgc-story" aria-labelledby="pgc-story-h" data-testid="story-card">
          <h3 id="pgc-story-h">{visible(story.id)} · {visible(story.title)}{story.mockOnly && <span className="pgc-chip" data-testid="story-mockonly">Mock only</span>}</h3>
          {block && <p className="pgc-note pgc-note--hold" role="note" data-testid="story-block"><Icon name="lock" />{visible(block)}</p>}
          <dl className="pgc-story__facts">
            <div><dt>Goal</dt><dd>{visible(story.goal)}</dd></div>
            <div><dt>Obstacle</dt><dd>{visible(story.obstacle)}</dd></div>
            <div><dt>What the control does</dt><dd>{visible(story.control)}</dd></div>
          </dl>
          <p className="pgc-story__say"><b>Say:</b> {visible(story.say)}</p>
          {story.persona && <p className="pgc-story__persona" data-testid="story-persona">Told as <b>{visible(story.persona)}</b>, a simulated page login (Mock sign-in, when it is available here).</p>}
          <div className="pgc-actions">
            <button type="button" className="pgc-go" disabled={Boolean(block) || Boolean(busy)} onClick={() => onRun(story.run, story)} data-testid="story-run"><Icon name="play" />Run this story</button>
            <button type="button" onClick={() => onSelect(null)} data-testid="story-close">Close story</button>
          </div>
          <CheckLine check={storyCheck(lastRun, story.run, story.expect)} testId="story-check" />
          <ol className="pgc-story__steps" data-testid="story-steps">
            {story.steps.map((st) => {
              const check = st.run ? storyCheck(lastRun, st.run, st.expect) : null;
              return (
                <li key={st.n} data-testid={`story-step-${st.n}`}>
                  <b>{visible(st.title)}</b>
                  <p>{visible(st.tell)}</p>
                  <p className="pgc-story__stepsay"><i>Say:</i> {visible(st.say)}</p>
                  <p className="pgc-story__why"><i>Why:</i> {visible(st.why)}</p>
                  {st.run && <button type="button" disabled={Boolean(block) || Boolean(busy)} onClick={() => onRun(st.run, story)} data-testid={`story-step-run-${st.n}`}>Run this step</button>}
                  <CheckLine check={check} testId={`story-step-check-${st.n}`} />
                </li>
              );
            })}
          </ol>
        </article>
      )}
    </section>
  );
}
