import React, { useEffect, useRef, useState } from "react";
import TopMenu from "./top-menu/TopMenu.jsx";
import ShelfLink from "./components/ShelfLink.jsx";
import SimulationBanner from "./Banner.jsx";
import VerdictCard from "./VerdictCard.jsx";
import IdentityRail from "./IdentityRail.jsx";
import ToolsTab from "./ToolsTab.jsx";
import ArgsTab from "./ArgsTab.jsx";
import EvidenceTab from "./EvidenceTab.jsx";
import ChatTab from "./ChatTab.jsx";
import SignIn from "./SignIn.jsx";
import StoryPanel from "./StoryPanel.jsx";
import ModeStatus from "./ModeStatus.jsx";
import TalkTrack from "./TalkTrack.jsx";
import { seedTalkPlace, talkPlace } from "./panels/talkPlace.js";
import { releaseDialogFocus } from "./panels/autoFocus.js";
import { useContent } from "./useContent.js";
import { workspace } from "./api.js";
import { badStoryParam, storyBlock, storyIdFromSearch } from "./storyView.js";
import EvidenceTabs from "./panels/EvidenceTabs.jsx";
import { useRunStepper } from "./panels/useRunStepper.js";
import { useLab } from "./useLab.js";
import { useTheme } from "./useTheme.js";
import { cardFor, runLook } from "./verdictView.js";

const TALK_KEY = "pgc.panel.talk";
// Agent chat is first and the tab the lab opens on (owner 2026-11-23): the demo starts by talking to the agent.
const TABS = [
  { id: "chat", label: "Agent chat" },
  { id: "tools", label: "Tools" },
  { id: "args", label: "Arguments and response" },
  { id: "evidence", label: "Evidence" },
];

// Tabs with the WAI-ARIA keyboard model: one tab stop, arrows and Home/End move between tabs.
function Tabs({ tab, onTab, look, children }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    let next = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onTab(TABS[next].id);
    refs.current[TABS[next].id]?.focus();
  };
  return (
    <section className={`pgc-tabs pgc-calm${look.refusal ? " pgc-calm--refusal" : ""}${look.red ? " pgc-calm--red" : ""}`} aria-label="Details">
      <div role="tablist" aria-label="Details" className="pgc-tablist">
        {TABS.map((t, i) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { refs.current[t.id] = el; }} onClick={() => onTab(t.id)} onKeyDown={(e) => onKey(e, i)} data-testid={`tab-${t.id}`}>{t.label}</button>
        ))}
      </div>
      {children}
    </section>
  );
}

const Panel = ({ id, tab, children }) => (
  <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tab !== id} className="pgc-panel" data-testid={`panel-${id}`}>{children}</div>
);

const DEFAULT_NAME = "Privilege Gateway Client Lab";
// The skip link is the page's first tab stop. A plain #fragment would also work, but this keeps the address clean and moves focus to <main> itself.
function skipToMain(e) {
  e.preventDefault();
  const m = document.getElementById("pgc-main");
  m?.focus();
  m?.scrollIntoView?.({ block: "start" });
}
function Shell({ children, topMenu, brand }) {
  return (
    <>
      <a className="pgc-skip" href="#pgc-main" onClick={skipToMain} data-testid="skip-link">Skip to main content</a>
      <header className="shell-bar">
        <div className="shell-brand" data-testid="brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="shell-brand__text"><span className="shell-brand__name" data-testid="brand-name">{brand?.name ?? DEFAULT_NAME}</span>{brand?.tagline && <span className="shell-brand__tag" data-testid="brand-tagline">{brand.tagline}</span>}</span>
          {workspace.id !== "default" && <span className="pgc-chip pgc-chip--ws" data-testid="workspace-chip" title="This page keeps its own run history and sign-in under this workspace id">Workspace: {workspace.id}</span>}
        </div>
        {topMenu}
      </header>
      <main className="pgc-main" id="pgc-main" tabIndex={-1}>{children}</main>
    </>
  );
}

export default function App() {
  const lab = useLab();
  const content = useContent();
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  const [tab, setTab] = useState("chat");
  const [railOpen, setRailOpen] = useState(false);
  const [railW, setRailW] = useState(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("pgc.railW");
    return saved ? Number(saved) : null;
  });
  const railDragging = useRef(false);
  const layoutRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      if (!railDragging.current || !layoutRef.current) return;
      e.preventDefault();
      const rect = layoutRef.current.getBoundingClientRect();
      const gap = 16;
      const w = Math.min(40 * 16, Math.max(16 * 16, e.clientX - rect.left - gap / 2));
      setRailW(w);
    };
    const onUp = () => { railDragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);
  useEffect(() => {
    if (railW != null) window.localStorage.setItem("pgc.railW", String(railW));
  }, [railW]);
  const [signinOpen, setSigninOpen] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const filterRef = useRef(null);
  // ONE walkthrough over the hops of the latest run: the movie reel, the token sequence and the sequence view all follow it.
  const stepper = useRunStepper(lab.lastRun?.hops, lab.lastRun?.verdict?.id);

  // Presenter mode (rule 3): larger type, the banner stays, the talk track and the Movie reel are arranged side by side. On from the lab's own
  // setting (PGC_PRESENTER=1) or ?presenter=1, and the P key toggles it.
  const urlPresenter = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("presenter") === "1";
  const [present, setPresent] = useState(urlPresenter);
  const presentStart = useRef(urlPresenter);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkSeen, setTalkSeen] = useState(false);
  const [panelGen, setPanelGen] = useState(0);
  const [dockGen, setDockGen] = useState(0); // a Mock/Real switch closes the open panels (the card above them changes height)
  const [talkAt, setTalkAt] = useState(null);
  const openTalk = () => {
    const where = { headerBottom: document.querySelector(".shell-bar")?.getBoundingClientRect().bottom ?? 72, dockH: 56 };
    seedTalkPlace(TALK_KEY, where);
    setTalkAt((at) => at ?? talkPlace(where)); // the place is also the dialog's default, so it holds when storage is unavailable
    setTalkSeen(true); setTalkOpen(true);
  };
  const toggleTalk = () => { if (talkOpen) setTalkOpen(false); else openTalk(); };
  useEffect(() => { if (content.presenter && !presentStart.current) { presentStart.current = true; setPresent(true); } }, [content.presenter]);
  useEffect(() => {
    document.documentElement.dataset.presenter = present ? "1" : "0";
    return () => { delete document.documentElement.dataset.presenter; };
  }, [present]);
  useEffect(() => {
    document.documentElement.dataset.talk = talkOpen ? "open" : "closed";
    return () => { delete document.documentElement.dataset.talk; };
  }, [talkOpen]);
  useEffect(() => {
    if (!(present && lab.boot === "ready")) return undefined;
    openTalk();
    const id = setTimeout(releaseDialogFocus, 120); // the page opened it, not the person: one Escape must still leave presenter mode
    return () => clearTimeout(id);
  }, [present, panelGen, lab.boot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t?.closest?.("input,textarea,select,[contenteditable='true']")) return;
      if (e.key === "p" || e.key === "P") setPresent((v) => !v);
      else if (e.key === "Escape" && !t?.closest?.('[role="dialog"],.fd-panel')) setPresent(false);
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  // Branding (rule 12): the lab's name is the page title.
  const brand = content.customer ? { name: content.customer.name, tagline: content.customer.tagline } : null;
  useEffect(() => { document.title = brand?.name ?? DEFAULT_NAME; }, [brand?.name]);

  // Stories (rule 10): ?story=S0n opens one and starts its run; the picker does the same. The URL follows the choice so a link can be shared.
  const [activeStory, setActiveStory] = useState(null);
  const [urlNote, setUrlNote] = useState(workspace.problem);
  const storiesHandled = useRef(false);
  const syncUrl = (id) => {
    try {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set("story", id); else u.searchParams.delete("story");
      window.history.replaceState(null, "", u);
    } catch { /* the address is only a convenience */ }
  };
  const runStory = (spec, story) => {
    setTab(spec.action === "call" ? "args" : "tools");
    return lab.runSpec(spec, { persona: story?.persona });
  };
  const selectStory = (id) => { setActiveStory(id); setUrlNote(workspace.problem); syncUrl(id); };
  useEffect(() => {
    if (storiesHandled.current || lab.boot !== "ready" || !Array.isArray(content.stories)) return;
    storiesHandled.current = true;
    const search = window.location.search;
    const id = storyIdFromSearch(search);
    if (id) {
      const s = content.stories.find((x) => x.id === id);
      if (s) { setActiveStory(id); if (!storyBlock(s, lab.info)) runStory(s.run, s); }
      else if (content.stories.length) setUrlNote(`There is no story ${id} here. Pick one below.`);
    } else if (badStoryParam(search)) setUrlNote("The story in the address is not a story id (S01 to S06). Pick one below.");
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset (rule 3): the lab's state on the server, and on this page the walk, the panels' places and sizes, the story and the talk track. Presenter
  // mode returns to how the lab was started.
  const resetAll = async () => {
    const ok = await lab.reset();
    if (!ok) return;
    stepper.reset();
    try { Object.keys(window.localStorage).filter((k) => k.startsWith("pgc.panel.")).forEach((k) => window.localStorage.removeItem(k)); } catch { /* nothing stored */ }
    setActiveStory(null); syncUrl(null); setUrlNote(workspace.problem);
    setTalkOpen(false); setTalkSeen(false); setTalkAt(null);
    setPresent(urlPresenter || content.presenter);
    setPanelGen((g) => g + 1);
    setTab("chat");
  };

  // The verdict word takes focus when a run finishes (not on first load): a counter changes once per finished run.
  const finished = lab.lastRun?.id ?? lab.failure;
  const seen = useRef(null);
  useEffect(() => { if (finished && finished !== seen.current) setFocusSignal((n) => n + 1); seen.current = finished; }, [finished]);

  const source = lab.info?.source ?? "mock";
  const modeProps = lab.info ? {
    value: lab.info.source,
    onChange: async (v) => { const ok = await lab.setMode(v); setTab("chat"); if (ok) setDockGen((g) => g + 1); },
    realAvailable: lab.info.realAvailable,
    realHint: lab.info.realReason ?? "Real is not configured. Add this lab's own .env settings and restart; Mock keeps working.",
  } : undefined;
  const signInAvailable = lab.authConfig && (source === "mock" ? lab.authConfig.mock?.available : lab.authConfig.real?.configured);
  const topMenu = (
    <TopMenu
      mode={modeProps}
      theme={{ value: theme, onChange: setTheme }}
      fontSize={{ value: fontSize, onChange: setFontSize }}
      vertical={content.customer && content.vertical ? { value: content.vertical, onChange: content.setVertical, options: content.customer.verticals.map((v) => v.id) } : undefined}
      present={{ active: present, onToggle: () => setPresent((v) => !v) }}
      talkTrack={{ active: talkOpen, onToggle: toggleTalk }}
      onReset={lab.info ? resetAll : undefined}
      showSignIn={Boolean(signInAvailable)}
      signedIn={{ subject: lab.me?.name ?? lab.me?.username ?? lab.me?.sub ?? null, onSignIn: () => setSigninOpen(true), onSignOut: lab.signOut }}
    >
      <ShelfLink />
    </TopMenu>
  );

  if (lab.boot !== "ready") {
    return (
      <Shell topMenu={topMenu} brand={brand}>
        <SimulationBanner source="mock" />
        {lab.boot === "loading"
          ? <p className="pgc-note" data-testid="boot-loading">Loading…</p>
          : (
            <section className="pgc-verdict" data-tone="danger" data-testid="boot-error">
              <div className="pgc-verdict__main"><div className="pgc-verdict__body">
                <h1 className="pgc-verdict__word">Could not load the lab</h1>
                <p className="pgc-verdict__sentence">{lab.bootError?.message}</p>
                <div className="pgc-actions"><button type="button" className="pgc-go" onClick={lab.reload}>Try again</button></div>
              </div></div>
            </section>
          )}
      </Shell>
    );
  }

  const selected = lab.hasTools ? lab.discovery.tools.find((t) => t.name === lab.selectedTool) ?? null : null;
  const card = cardFor({ busy: lab.busy, failure: lab.failure, lastRun: lab.lastRun, door: lab.door, info: lab.info, tool: lab.selectedTool, hasTools: lab.hasTools });

  const goChoose = () => { setTab("tools"); setTimeout(() => filterRef.current?.focus(), 0); };
  const goDoor = () => {
    setRailOpen(true);
    setTimeout(() => document.querySelector('[data-testid="door-picker"] [aria-checked="true"]')?.focus(), 0);
  };
  const onAction = (id) => {
    if (id === "discover") { setTab("tools"); lab.discover(); }
    else if (id === "choose") goChoose();
    else if (id === "door") goDoor();
    else if (id === "repeat") lab.repeat();
    else if (id === "args") setTab("args");
    else if (id === "clear-scenario") { lab.setScenario("none"); lab.repeat("none"); }
  };
  const pick = (name) => { lab.setSelectedTool(name); setTab("args"); };

  return (
    <Shell topMenu={topMenu} brand={brand}>
      <SimulationBanner source={source} origin={source === "real" ? lab.info.gateway?.origin : null} />
      <ModeStatus info={lab.info} signedIn={lab.me?.source === "real-login"} />
      {lab.modeError && (
        <p className="pgc-note pgc-note--hold" role="alert" data-testid="mode-error">{lab.modeError.message}</p>
      )}
      <div className="pgc-layout" ref={layoutRef} style={railW != null ? { "--rail-w": `${railW}px` } : undefined}>
        <IdentityRail lab={lab} onSignIn={() => setSigninOpen(true)} open={railOpen} onToggle={() => setRailOpen((o) => !o)} />
        <div
          className="pgc-rail-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left panel"
          data-dragging={railDragging.current ? "1" : "0"}
          onPointerDown={(e) => { e.preventDefault(); railDragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }}
        />
        <div className="pgc-stage">
          <VerdictCard card={card} onAction={onAction} focusSignal={focusSignal} />
          <StoryPanel stories={content.stories} info={lab.info} lastRun={lab.lastRun} activeId={activeStory} onSelect={selectStory} onRun={runStory} busy={lab.busy}
            error={content.error} urlNote={urlNote} vertical={content.customer?.verticals.find((v) => v.id === content.vertical)?.label} />
          <Tabs tab={tab} onTab={setTab} look={runLook(lab.lastRun)}>
            <Panel id="tools" tab={tab}><ToolsTab lab={lab} onPick={pick} filterRef={filterRef} onDiscover={() => lab.discover()} onRunByName={(n) => lab.callTool(n, {})} /></Panel>
            <Panel id="args" tab={tab}><ArgsTab lab={lab} tool={selected} onBack={() => setTab("tools")} /></Panel>
            <Panel id="evidence" tab={tab}><EvidenceTab lab={lab} /></Panel>
            <Panel id="chat" tab={tab}><ChatTab key={`${source}:${lab.door}`} lab={lab} stepper={stepper} /></Panel>
          </Tabs>
        </div>
      </div>
      <SignIn mode={source} isOpen={signinOpen} onClose={() => setSigninOpen(false)} lab={lab} />
      <EvidenceTabs key={`${panelGen}-${dockGen}`} run={lab.lastRun} stepper={stepper} presenter={present} />
      {talkSeen && (
        <TalkTrack key={`talk-${panelGen}`} isOpen={talkOpen} onClose={() => setTalkOpen(false)} storageKey={TALK_KEY} place={talkAt}
          title={`Talk track${content.customer ? ` · ${content.customer.verticals.find((v) => v.id === content.vertical)?.label ?? ""}` : ""}`}
          talk={(content.talk ?? []).map((t) => ({ id: t.id ?? t.title, title: t.title, say: t.say }))} />
      )}
    </Shell>
  );
}
