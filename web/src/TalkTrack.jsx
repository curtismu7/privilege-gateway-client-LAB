import React from "react";
import FloatingDialog from "./floating-dialog/FloatingDialog.jsx";

// The Talk track (rule 3, section 8d.1): the presenter script in the shared FloatingDialog, so it is movable, resizable and can pop out.
// It is the same panel as shared/talk-track/TalkTrackDialog.jsx (same props, same test ids, same singleton key) with one difference: it is
// NON-MODAL (`noBackdrop`). The shared dialog as it stands on origin/main is modal (a backdrop dims the page and Tab is held inside), which is
// the opposite of its own README ("docked beside the page") and of section 8f (nothing that opens during a walkthrough may block the controls).
// A presenter talks while stepping through the reel, so this lab cannot use the modal one. The one-line upstream fix is
// docs/upstream/talk-track-no-backdrop.patch; once it lands, replace this file with the vendored TalkTrackDialog.
export default function TalkTrack({ isOpen, onClose, talk, title = "Talk track", storageKey = "talk-track-dialog", place = null }) {
  const steps = Array.isArray(talk) ? talk : [];
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title={title} ariaLabel="Talk track" defaultWidth={place?.w ?? 430} defaultHeight={place?.h ?? null} defaultX={place?.x ?? null} defaultY={place?.y ?? null} placement="right"
      storageKey={storageKey} singletonKey="talk-track" testId="talk-track-dialog" noBackdrop>
      {steps.length === 0 ? (
        <p className="note">No script for this view.</p>
      ) : (
        <ol className="talk" data-testid="talk-track">
          {steps.map((t) => (
            <li key={t.id ?? t.title}>
              <h2>{t.title}</h2>
              <p>{t.say}</p>
            </li>
          ))}
        </ol>
      )}
    </FloatingDialog>
  );
}
