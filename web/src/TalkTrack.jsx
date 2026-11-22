import React from "react";
import FloatingDialog from "./floating-dialog/FloatingDialog.jsx";

// The Talk track (rule 3, section 8d.1): the presenter script in the shared FloatingDialog, so it is movable, resizable and can pop out.
// It is the same panel as shared/talk-track/TalkTrackDialog.jsx (same props, same test ids, same singleton key, and non-modal `noBackdrop` just
// like the shared one since AI-DEMO-Standalone #488) with one addition: a `place` prop that sets the dialog's DEFAULT size and position. The
// shared TalkTrackDialog takes no such prop and opens at the top right of the window (y 16), over the header's Mode, Reset and Sign in controls.
// This lab opens it below the header (panels/talkPlace.js), also in a browser that cannot store anything, where the remembered place is not
// available and only the default counts (e2e/fixes.py N3, "talk-place-nostorage"). So the shared dialog is NOT adopted yet: it would regress
// that. Once the shared dialog accepts a default place, delete this file, vendor the shared one with a pin and import it in App.jsx.
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
