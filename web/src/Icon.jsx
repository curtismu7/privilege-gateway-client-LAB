import React from "react";

// A small set of stroke icons. Every one is decoration: the word beside it carries the meaning (never an icon or a colour alone).
const PATHS = {
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  hourglass: <path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4" />,
  unplug: <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5M3 3l18 18" />,
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></>,
  swap: <path d="M5 8h13M14 4l4 4-4 4M19 16H6M10 12l-4 4 4 4" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  shield: <path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z" />,
  down: <path d="M6 9l6 6 6-6" />,
  film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  seq: <path d="M5 4v16M19 4v16M5 8h12M13 5l4 3-4 3M19 15H7M11 12l-4 3 4 3" />,
  diagram: <><rect x="3" y="4" width="7" height="5" rx="1" /><rect x="14" y="4" width="7" height="5" rx="1" /><rect x="8.500" y="15" width="7" height="5" rx="1" /><path d="M10 6.500h4M6.500 9v3h5M17.500 9v3h-5M12 12v3" /></>,
  doc: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  equals: <path d="M5 9h14M5 15h14" />,
  play: <path d="M7 5l12 7-12 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
};

export default function Icon({ name, spin = false, className = "" }) {
  return (
    <svg className={`pgc-ico${spin ? " pgc-spin" : ""} ${className}`.trim()} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name] ?? PATHS.alert}
    </svg>
  );
}
