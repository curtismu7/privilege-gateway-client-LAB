#!/usr/bin/env python3
"""Browser proof for the evidence panels (step 2b): real Chromium, real mouse and keyboard, a real second window for the pop-out.

Not part of `npm test` (jsdom has no layout and no second window). Run it against a started lab:

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7933 npm start            # Mock lab (any free port; never a real gateway)
    BASE=http://127.0.0.1:7933/ SHOTS=/some/dir python3 e2e/panels.py

Optional REAL_BASE=http://127.0.0.1:<port>/ checks the Real panels against a lab that talks to a loopback STUB gateway (never a real one).
Needs: python3, `pip install playwright`, `playwright install chromium`. Exit code 0 only when every check passed.
"""
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:7933/")
REAL = os.environ.get("REAL_BASE", "")
SHOTS = os.environ.get("SHOTS") or os.path.join(tempfile.gettempdir(), "pgc-shots")
os.makedirs(SHOTS, exist_ok=True)

N = 0
FAILS = []


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def shot(page, state, vp, theme):
    page.screenshot(path=os.path.join(SHOTS, f"2b-{state}-{vp}-{theme}.png"))


def rect(page, sel):
    return page.evaluate("""(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; }""", sel)


def overlap(a, b):
    if not a or not b:
        return 0
    w = min(a["r"], b["r"]) - max(a["x"], b["x"])
    h = min(a["b"], b["b"]) - max(a["y"], b["y"])
    return max(0, w) * max(0, h)


def text(page, sel):
    return page.evaluate("(s) => document.querySelector(s)?.textContent ?? null", sel)


def new_page(browser, w, h, theme, base=None):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    page = ctx.new_page()
    page.msgs = []
    page.dialogs = []
    page.on("console", lambda m: page.msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.msgs.append(("pageerror", str(e))))
    page.on("dialog", lambda d: (page.dialogs.append(d.message), d.dismiss()))
    page.goto(base or BASE)
    page.wait_for_selector('[data-testid="get-tools"]')
    return ctx, page


def pick_door(page, door):
    if not page.is_visible(f'[data-testid="door-{door}"]'):  # under 900px the rail is behind its toggle
        page.click('[data-testid="rail-toggle"]')
    page.click(f'[data-testid="door-{door}"]')


def run_tool(page, door, tool, args_text=None, scenario=None):
    pick_door(page, door)
    page.click('[data-testid="get-tools"]')
    page.wait_for_selector('[data-testid="tool-grid"]')
    if page.locator(f'[data-testid="tool-{tool}"]').count() == 0:
        # The gateway lists only what the grant allows, so a refused tool has no tile: run it by name.
        page.fill('[data-testid="by-name-input"]', tool)
        page.click('[data-testid="by-name-run"]')
        page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")
        return
    page.click(f'[data-testid="tool-{tool}"]')
    page.wait_for_selector('[data-testid="run"]')
    if args_text is not None:
        page.fill("#pgc-args", args_text)
    if scenario:  # chosen after discovery, so the scenario shapes the call and not the tool list
        page.evaluate("document.querySelector('[data-testid=advanced]').open = true")
        page.select_option("#pgc-scenario", scenario)
    page.click('[data-testid="run"]')
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")


def discover(page, door, scenario=None):
    pick_door(page, door)
    if scenario:
        page.evaluate("document.querySelector('[data-testid=advanced]').open = true")
        page.select_option("#pgc-scenario", scenario)
    page.click('[data-testid="get-tools"]')
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")


def counter(page, scope=None):
    return text(page, (scope + " " if scope else "") + '[data-testid="step-counter"]') if scope else text(page, '[data-testid="dock-counter"]')


def hit(page, x, y):
    return page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid^=\"panel-\"]')?.dataset.testid ?? null", [x, y])


RED_SCAN = """(rootSel) => {
  const root = document.querySelector(rootSel); if (!root) return ['no root'];
  const probe = document.createElement('div'); document.body.appendChild(probe);
  const norm = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
  const reds = new Set([norm('var(--accent)'), norm('var(--accent-deep)'), norm('var(--danger-text)')]);
  probe.remove();
  const hits = [];
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && reds.has(cs.color)) hits.push(el.tagName + '.' + el.className + ' color');
    if (reds.has(cs.backgroundColor)) hits.push(el.tagName + '.' + el.className + ' background');
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' && reds.has(cs['border' + side + 'Color'])) hits.push(el.tagName + '.' + el.className + ' border' + side);
    }
    if (el instanceof SVGElement && (reds.has(cs.fill) || reds.has(cs.stroke)) && !(el.tagName === 'svg')) hits.push(el.tagName + '.' + (el.getAttribute('class') || '') + ' svg');
  }
  return hits;
}"""

CONTRAST = """([fgSel, bgSel, prop]) => {
  const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const a = document.querySelector(fgSel), b = document.querySelector(bgSel);
  if (!a || !b) return null;
  const ca = getComputedStyle(a)[prop], cb = getComputedStyle(b).backgroundColor;
  const l1 = lum(ca), l2 = lum(cb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}"""


def open_panel(page, pid):
    page.click(f'[data-testid="dock-{pid}"]')
    page.wait_for_selector(f'[data-testid="panel-{pid}"]')
    page.wait_for_timeout(120)


def front(page, pid):
    """Bring an open panel to the front the way a person does: its dock button brings it forward when it is behind another."""
    if page.evaluate("(sel) => document.querySelector(sel)?.style.zIndex", f'[data-testid="panel-{pid}"]') != "1010":
        page.click(f'[data-testid="dock-{pid}"]')
        page.wait_for_function("(sel) => document.querySelector(sel)?.style.zIndex === '1010'", arg=f'[data-testid="panel-{pid}"]')


def close_all(page):
    """Tidy up between checks (a script click on each Close button: the panels may be stacked)."""
    page.evaluate("""() => { for (const b of document.querySelectorAll('[data-testid^="panel-"] button[aria-label^="Close "]')) b.click(); }""")
    page.wait_for_timeout(80)
    page.evaluate("""() => { for (const b of document.querySelectorAll('[data-testid^="panel-"] button[aria-label^="Close "]')) b.click(); }""")


def wide_checks(browser, theme):
    """1440x900: placement, the one walkthrough across three panels, red-free panels, keyboard, contrast, scenarios."""
    ctx, page = new_page(browser, 1440, 900, theme)
    vp = "1440"
    T = f"[{theme} {vp}]"

    # --- empty states, before any run
    for pid in ("reel", "tokens", "sequence", "trace"):
        open_panel(page, pid)
    check(f"{T} empty: reel, tokens, sequence say there is no run yet", all(page.query_selector(f'[data-testid="{x}"]') for x in ("reel-none", "tokens-none", "sequence-none")))
    check(f"{T} empty: trace says to press Run", page.query_selector('[data-testid="gateway-trace-empty"]') is not None)
    check(f"{T} empty: dock counter", counter(page) == "No run yet", counter(page))
    check(f"{T} empty: Simulate and Next are disabled (nothing to walk)", page.is_disabled('[data-testid="panel-reel"] [data-testid="step-toggle"]') and page.is_disabled('[data-testid="panel-reel"] [data-testid="step-next"]'))
    shot(page, "empty-all-open", vp, theme)
    close_all(page)

    # --- a run, then each panel on its own: placement and screenshots
    run_tool(page, "lab-banking-full", "list_entitlements")
    page.evaluate("window.scrollTo(0, 0)")
    screenshot_states = {"reel": "allowed-reel", "tokens": "allowed-tokens", "sequence": "allowed-sequence", "trace": "allowed-trace"}
    for pid in ("reel", "tokens", "sequence", "trace"):
        open_panel(page, pid)
        p = rect(page, f'[data-testid="panel-{pid}"]')
        card = rect(page, '[data-testid="verdict-card"]')
        dock = rect(page, '[data-testid="panel-dock"]')
        check(f"{T} {pid}: opens inside the window, above the dock", p and p["x"] >= 0 and p["y"] >= 0 and p["r"] <= 1440 and p["b"] <= dock["y"] + 1, f"{p} dock {dock}")
        check(f"{T} {pid}: does not cover the verdict card", overlap(p, card) == 0, f"overlap {overlap(p, card)} panel {p} card {card}")
        acts = page.evaluate("[...document.querySelectorAll('.pgc-actions button')].map((b) => { const r = b.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; })")
        check(f"{T} {pid}: does not cover the verdict's action buttons", acts and all(overlap(p, a) == 0 for a in acts))
        run = rect(page, '[data-testid="run"]')
        if run and 0 <= run["y"] < 900:
            check(f"{T} {pid}: does not cover the Run button", overlap(p, run) == 0)
        sidebar = rect(page, '[data-testid="rail"]')
        check(f"{T} {pid}: does not cover the identity rail and door picker", overlap(p, sidebar) == 0)
        check(f"{T} {pid}: red-free (the shared accent is ink inside a panel)", RED_SCAN and page.evaluate(RED_SCAN, f'[data-testid="panel-{pid}"]') == [], str(page.evaluate(RED_SCAN, f'[data-testid="panel-{pid}"]'))[:300])
        shot(page, screenshot_states[pid], vp, theme)
        page.click(f'[data-testid="dock-{pid}"]')
    check(f"{T} no hostile popups so far and no console errors", not page.dialogs and not page.msgs, str(page.msgs))

    # --- all four open: every title bar stays reachable (not covered by another panel)
    for pid in ("reel", "tokens", "sequence", "trace"):
        open_panel(page, pid)
    for pid in ("reel", "tokens", "sequence", "trace"):
        t = rect(page, f'[data-testid="panel-{pid}"] [data-testid="fd-titlebar"]')
        check(f"{T} all open: the {pid} title bar is not covered", hit(page, t["x"] + 30, t["y"] + t["h"] / 2) == f"panel-{pid}", str(hit(page, t["x"] + 30, t["y"] + t["h"] / 2)))
    shot(page, "all-open", vp, theme)

    # --- one walkthrough: reel, tokens and sequence in sync
    check(f"{T} fresh: counter says not started", counter(page) in ("Not started, 8 messages",), counter(page))
    front(page, "reel")
    page.click('[data-testid="panel-reel"] [data-testid="step-next"]')
    for pid in ("reel", "tokens", "sequence"):
        check(f"{T} Next from fresh: {pid} reads Message 1 of 8", text(page, f'[data-testid="panel-{pid}"] [data-testid="step-counter"]') == "Message 1 of 8")
    check(f"{T} Next from fresh starts PAUSED (button says Resume)", text(page, '[data-testid="panel-reel"] [data-testid="step-toggle"]').strip() == "Resume")
    check(f"{T} step 1 is the current frame, row and token hop", page.get_attribute('[data-testid="frame-1"]', "aria-current") == "step" and page.get_attribute('[data-testid="row-1"]', "aria-current") == "step" and page.get_attribute('[data-testid="tokhop-1"]', "data-on") == "true")
    # keyboard on the reel: arrows, End, Home
    page.focus('[data-testid="frame-1"]')
    page.keyboard.press("ArrowRight")
    check(f"{T} reel ArrowRight moves all three views to 2", page.get_attribute('[data-testid="row-2"]', "aria-current") == "step" and page.get_attribute('[data-testid="tokhop-2"]', "data-on") == "true" and counter(page) == "Message 2 of 8")
    page.keyboard.press("End")
    check(f"{T} reel End goes to the last message", counter(page) == "Message 8 of 8", counter(page))
    page.keyboard.press("Home")
    check(f"{T} reel Home goes to message 1", counter(page) == "Message 1 of 8", counter(page))
    # keyboard on the sequence rows
    page.focus('[data-testid="row-1"]')
    page.keyboard.press("ArrowDown")
    check(f"{T} sequence ArrowDown moves the reel too", page.get_attribute('[data-testid="frame-2"]', "aria-current") == "step")
    # keyboard on the token hops
    page.focus('[data-testid="tokhop-2"] button')
    page.keyboard.press("ArrowDown")
    check(f"{T} token hop ArrowDown moves the reel too", page.get_attribute('[data-testid="frame-3"]', "aria-current") == "step")
    # Simulate on the timer, fast, to the end
    front(page, "reel")
    page.select_option('[data-testid="panel-reel"] [data-testid="step-speed"]', "fast")
    page.click('[data-testid="panel-reel"] [data-testid="step-toggle"]')
    check(f"{T} Simulate restarts at message 1 playing (Pause is offered)", text(page, '[data-testid="panel-reel"] [data-testid="step-toggle"]').strip() == "Pause")
    page.wait_for_function("document.querySelector('[data-testid=\"panel-reel\"] [data-testid=\"step-toggle\"]').textContent.trim() === 'Replay'", timeout=15000)
    check(f"{T} an allowed run plays through to the reply and stops", counter(page) == "Message 8 of 8", counter(page))
    check(f"{T} the three views ended on the same hop", page.get_attribute('[data-testid="frame-8"]', "aria-current") == "step" and page.get_attribute('[data-testid="row-8"]', "aria-current") == "step")
    live = page.evaluate("[...document.querySelectorAll('[aria-live=polite]')].map((e) => e.dataset.testid)")
    check(f"{T} exactly one polite counter announces among the open panels and the dock", [x for x in live if x in ("step-counter", "dock-counter")] == ["step-counter"], str(live))
    shot(page, "allowed-all-open-end", vp, theme)

    # --- the step detail that follows the sequence: non-modal, no backdrop, the controls stay clickable
    front(page, "sequence")
    page.click('[data-testid="panel-sequence"] [data-testid="detail-toggle"]')
    page.wait_for_selector('[data-testid="panel-detail"]')
    check(f"{T} step detail is non-modal (no aria-modal, no backdrop)", page.get_attribute('[data-testid="panel-detail"]', "aria-modal") is None and page.query_selector(".fd-backdrop") is None)
    front(page, "sequence")
    page.click('[data-testid="panel-sequence"] [data-testid="step-prev"]')
    check(f"{T} Prev still works with the detail open and the detail follows", "Step 7 detail" in (page.get_attribute('[data-testid="panel-detail"] [data-testid="step-detail"]', "aria-label") or ""))
    shot(page, "allowed-sequence-detail", vp, theme)
    page.click('[data-testid="panel-detail"] button[aria-label^="Close Step detail"]')
    check(f"{T} closing the detail hides it", page.query_selector('[data-testid="panel-detail"]') is None)

    # --- control contrast (dark and light): unselected dock and stepper buttons, selected dock button text
    c1 = page.evaluate(CONTRAST, ['[data-testid="dock-trace"]', '[data-testid="panel-dock"]', "borderTopColor"])
    check(f"{T} dock button border is 3:1 or more against the dock", c1 is not None and c1 >= 3, str(c1))
    front(page, "reel")
    c2 = page.evaluate(CONTRAST, ['[data-testid="panel-reel"] [data-testid="step-prev"]', '[data-testid="panel-reel"] .fd-body', "borderTopColor"])
    check(f"{T} stepper button border is 3:1 or more against the panel", c2 is not None and c2 >= 3, str(c2))
    pressed = page.evaluate("""() => { const b = document.querySelector('[data-testid=dock-reel]'); const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor, b.getAttribute('aria-pressed')]; }""")
    check(f"{T} a pressed dock button is filled (ink) and still readable", pressed[2] == "true" and pressed[0] != pressed[1], str(pressed))
    c3 = page.evaluate("""() => { const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); }; const cs = getComputedStyle(document.querySelector('[data-testid=dock-reel]')); const a = lum(cs.color), b = lum(cs.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }""")
    check(f"{T} pressed dock button text is 4.5:1 or more on its fill", c3 >= 4.5, str(c3))
    close_all(page)
    check(f"{T} no hostile popups and no console errors", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def scenario_checks(browser, theme):
    """Each kind of run: where Simulate stops, what the frame says, amber with a lock for a refusal, nothing red."""
    ctx, page = new_page(browser, 1440, 900, theme)
    vp = "1440"
    T = f"[{theme} {vp}]"
    amber = page.evaluate("""() => { const p = document.createElement('div'); p.style.color = 'var(--status-warn)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }""")

    def play_to_stop(pid):
        open_panel(page, pid)
        page.select_option(f'[data-testid="panel-{pid}"] [data-testid="step-speed"]', "fast")
        page.click(f'[data-testid="panel-{pid}"] [data-testid="step-toggle"]')
        page.wait_for_function(f"document.querySelector('[data-testid=\"panel-{pid}\"] [data-testid=\"step-toggle\"]').textContent.trim() === 'Replay'", timeout=15000)

    cases = [
        ("blocked", dict(door="lab-banking-limited", tool="sensitive_tax_record"), "blocked", "Policy decision", "denied"),
        ("held", dict(door="lab-banking-full", tool="open_ticket"), "held", "Held", "held"),
        ("upstream", dict(door="lab-banking-full", tool="list_entitlements", scenario="upstream-error"), "upstream", "Tool", "failed"),
        ("mismatch", dict(door="lab-banking-full", tool="list_entitlements", scenario="identity-mismatch"), "allowed", "Verdict", "done"),
    ]
    for name, kw, verdict, stop_title, status_word in cases:
        close_all(page)
        page.goto(BASE)
        page.wait_for_selector('[data-testid="get-tools"]')
        run_tool(page, **kw)
        check(f"{T} {name}: verdict card says {verdict}", page.get_attribute('[data-testid="verdict-card"]', "data-verdict") == verdict)
        play_to_stop("reel")
        frame = page.query_selector('[data-testid="panel-reel"] .rl-f[aria-current="step"]')
        label = frame.get_attribute("aria-label")
        check(f"{T} {name}: the walk stops at {stop_title}", f", {stop_title}," in label, label)
        check(f"{T} {name}: the stop frame says '{status_word}' in words", status_word in label, label)
        if name == "blocked":
            st = page.evaluate("""() => { const e = document.querySelector('[data-testid=panel-reel] .rl-f[aria-current=step] .rl-f__st'); const cs = getComputedStyle(e); const b = getComputedStyle(e, '::before'); return {color: cs.color, content: b.content, w: b.width}; }""")
            check(f"{T} blocked: the denied status is amber, not red", st["color"] == amber, f"{st} amber {amber}")
            check(f"{T} blocked: the denied status carries a lock (a drawn mark, with the word beside it)", st["content"] not in ("none", "normal") and st["w"] != "auto", str(st))
            check(f"{T} blocked: the run note says where Simulate stopped", "Simulate stops at message" in (text(page, '[data-testid="run-note-stop"]') or ""))
            tag = page.evaluate("""() => { const e = document.querySelector('[data-testid=panel-reel] [data-testid=sdp-status]'); return e ? [getComputedStyle(e).color, getComputedStyle(e).borderTopColor] : null; }""")
            check(f"{T} blocked: the step-detail tag is amber and says denied", tag and tag[0] == amber and tag[1] == amber and "denied" in text(page, '[data-testid="panel-reel"] [data-testid="sdp-status"]'), str(tag))
        if name == "upstream":
            st = page.evaluate("""() => { const e = document.querySelector('[data-testid=panel-reel] .rl-f[aria-current=step] .rl-f__st'); return getComputedStyle(e, '::before').content; }""")
            check(f"{T} upstream: an upstream failure carries no lock (it is not a refusal)", st in ("none", "normal"), str(st))
            fr = page.evaluate("""() => { const f = document.querySelector('[data-testid=panel-reel] .rl-f[aria-current=step]'); const e = f.querySelector('.rl-f__st'); return {verdict: f.getAttribute('data-verdict'), color: getComputedStyle(e).color, any_deny: !!document.querySelector('[data-testid=panel-reel] .rl-f[data-verdict=deny]')}; }""")
            check(f"{T} upstream: the failed frame is verdict error, says failed (never denied) and is amber in Mock, not red", fr["verdict"] == "error" and fr["color"] == amber and not fr["any_deny"], f"{fr} amber {amber}")
            tag = page.evaluate("""() => { const e = document.querySelector('[data-testid=panel-reel] [data-testid=sdp-status]'); return e ? [getComputedStyle(e).color, e.textContent.trim()] : null; }""")
            check(f"{T} upstream: the step-detail tag says failed, in amber", tag and tag[1] == "failed" and tag[0] == amber, str(tag))
        if name == "mismatch":
            ids = text(page, '[data-testid="run-note-identities"]') or ""
            check(f"{T} mismatch: both identities shown, labelled simulated", "SIMULATED" in ids and "aidemo" in ids, ids)
        check(f"{T} {name}: red-free", page.evaluate(RED_SCAN, '[data-testid="panel-reel"]') == [], str(page.evaluate(RED_SCAN, '[data-testid="panel-reel"]'))[:300])
        shot(page, f"{name}-reel", vp, theme)
        close_all(page)
        play_to_stop("sequence")
        shot(page, f"{name}-sequence", vp, theme)
        if name == "held":
            check(f"{T} held: the sequence stops waiting on Human approval", "Human approval" in (page.get_attribute('[data-testid^="row-"][aria-current="step"]', "aria-label") or ""))
    close_all(page)
    # a blocked door (no tools listed) and the needs-sign-in scenario
    page.goto(BASE); page.wait_for_selector('[data-testid="get-tools"]')
    discover(page, "lab-banking-blocked")
    open_panel(page, "reel")
    check(f"{T} blocked door: the 'not in this run' chip is there and the walk has 4 messages", page.query_selector('[data-testid="panel-reel"] button[aria-expanded]') is not None and counter(page) == "Not started, 4 messages", counter(page))
    page.click('[data-testid="panel-reel"] button[aria-expanded]')
    check(f"{T} blocked door: the skipped hop appears faint when asked for", page.query_selector('[data-testid="panel-reel"] .rl-f[data-verdict="skip"]') is not None)
    shot(page, "blocked-door-reel", vp, theme)
    close_all(page)
    page.goto(BASE); page.wait_for_selector('[data-testid="get-tools"]')
    run_tool(page, "lab-banking-full", "list_entitlements", scenario="no-key")
    check(f"{T} no-key: needs sign-in", page.get_attribute('[data-testid="verdict-card"]', "data-verdict") == "needs-sign-in")
    play_to_stop("reel")
    check(f"{T} no-key: stops at the Privilege decision", ", Policy decision," in page.query_selector('[data-testid="panel-reel"] .rl-f[aria-current="step"]').get_attribute("aria-label"))
    check(f"{T} no-key: not red", page.evaluate(RED_SCAN, '[data-testid="panel-reel"]') == [])
    close_all(page)

    # tokens: decoded, labelled, with changes
    page.goto(BASE); page.wait_for_selector('[data-testid="get-tools"]')
    run_tool(page, "lab-banking-full", "list_entitlements")
    open_panel(page, "tokens")
    page.click('[data-testid="tokhop-4"] button')
    cards = page.query_selector_all('[data-testid="tokhop-4"] [data-testid="token-card"]')
    check(f"{T} tokens: hop 4 shows two cards (the token, then the introspection claims)", len(cards) == 2, str(len(cards)))
    check(f"{T} tokens: labelled MOCK", "MOCK" in (cards[0].text_content() or ""))
    check(f"{T} tokens: Same and Added with an icon each", page.query_selector('[data-testid="tokhop-4"] li[data-status="added"] svg') is not None and "Same" in (text(page, '[data-testid="tokhop-4"]') or ""))
    page.click('[data-testid="tokhop-3"] button')
    parts = page.evaluate("[...document.querySelectorAll('[data-testid=tokhop-3] .jdec__h')].map((e) => e.textContent)")
    check(f"{T} tokens: Header, Payload, Signature through the shared pane", parts[-3:] == ["Header", "Payload", "Signature"] or {"Header", "Payload", "Signature"} <= set(parts), str(parts))
    check(f"{T} tokens: no body overflows sideways", page.evaluate("(() => { const b = document.querySelector('[data-testid=panel-tokens] .fd-body'); return b.scrollWidth <= b.clientWidth + 1; })()"))
    shot(page, "tokens-hop3", vp, theme)
    page.click('[data-testid="tokhop-7"] button')
    check(f"{T} tokens: a hop without a token says so", page.query_selector('[data-testid="tokhop-none"]') is not None)
    check(f"{T} tokens: red-free", page.evaluate(RED_SCAN, '[data-testid="panel-tokens"]') == [], str(page.evaluate(RED_SCAN, '[data-testid="panel-tokens"]'))[:300])
    close_all(page)
    check(f"{T} scenarios: no hostile popups and no console errors", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def geometry_checks(browser):
    """Real mouse and keyboard: drag, keyboard move and resize, mouse resize, Escape, close keeps place, reload restores size."""
    theme = "light"
    ctx, page = new_page(browser, 1440, 900, theme)
    T = "[geometry 1440]"
    run_tool(page, "lab-banking-full", "list_entitlements")
    page.evaluate("window.scrollTo(0, 0)")
    open_panel(page, "reel")
    P = '[data-testid="panel-reel"]'
    before = rect(page, P)
    tb = rect(page, f"{P} [data-testid=\"fd-titlebar\"]")
    sx, sy = tb["x"] + 60, tb["y"] + tb["h"] / 2
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx - 150, sy + 40, steps=10); page.mouse.up()
    after = rect(page, P)
    check(f"{T} drag by the title bar moves the panel", abs((after["x"] - before["x"]) + 150) <= 2 and abs((after["y"] - before["y"]) - 40) <= 2, f"{before} -> {after}")
    # keyboard move
    page.focus(f"{P} [data-testid=\"fd-titlebar\"]")
    page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowLeft")
    k1 = rect(page, P)
    check(f"{T} ArrowLeft x2 moves 20px", abs((k1["x"] - after["x"]) + 20) <= 1, f"{after['x']} -> {k1['x']}")
    page.keyboard.press("Shift+ArrowUp")
    k2 = rect(page, P)
    check(f"{T} Shift+ArrowUp moves 50px", abs((k2["y"] - k1["y"]) + 50) <= 1, f"{k1['y']} -> {k2['y']}")
    page.keyboard.press("Alt+ArrowRight"); page.keyboard.press("Alt+ArrowDown")
    k3 = rect(page, P)
    check(f"{T} Alt+Arrow resizes by 10px", abs((k3["w"] - k2["w"]) - 10) <= 1 and abs((k3["h"] - k2["h"]) - 10) <= 1, f"{k2['w']}x{k2['h']} -> {k3['w']}x{k3['h']}")
    # mouse resize from the south-east corner
    h = rect(page, f"{P} .fd-handle-se")
    page.mouse.move(h["x"] + 6, h["y"] + 6); page.mouse.down(); page.mouse.move(h["x"] + 6 - 90, h["y"] + 6 - 50, steps=8); page.mouse.up()
    r1 = rect(page, P)
    check(f"{T} dragging the corner resizes", abs((r1["w"] - k3["w"]) + 90) <= 3 and abs((r1["h"] - k3["h"]) + 50) <= 3, f"{k3['w']}x{k3['h']} -> {r1['w']}x{r1['h']}")
    # resize from the west edge
    w = rect(page, f"{P} .fd-handle-w")
    page.mouse.move(w["x"] + 3, w["y"] + w["h"] / 2); page.mouse.down(); page.mouse.move(w["x"] + 3 - 60, w["y"] + w["h"] / 2, steps=6); page.mouse.up()
    r2 = rect(page, P)
    check(f"{T} dragging the west edge grows it leftwards", abs((r2["w"] - r1["w"]) - 60) <= 3 and r2["x"] < r1["x"], f"{r1} -> {r2}")
    # Escape with focus inside: hides; the dock says so; reopening keeps place and size
    page.focus(f"{P} [data-testid=\"fd-titlebar\"]")
    page.keyboard.press("Escape")
    page.wait_for_selector(P, state="detached")
    check(f"{T} Escape hides the panel and the dock button is no longer pressed", page.get_attribute('[data-testid="dock-reel"]', "aria-pressed") == "false")
    check(f"{T} focus returns to the dock button that opened it", page.evaluate("document.activeElement?.dataset?.testid") == "dock-reel")
    open_panel(page, "reel")
    r3 = rect(page, P)
    check(f"{T} close = hide: the panel comes back where it was, at the same size", all(abs(r3[k] - r2[k]) <= 1 for k in ("x", "y", "w", "h")), f"{r2} -> {r3}")
    # the x button does the same as its tooltip says
    btn = page.query_selector(f'{P} button[aria-label^="Close Movie reel"]')
    check(f"{T} the close button's name says it hides and keeps the place; its tooltip is Close", "hides" in btn.get_attribute("aria-label") and btn.get_attribute("title") == "Close")
    btn.click()
    page.wait_for_selector(P, state="detached")
    open_panel(page, "reel")
    r4 = rect(page, P)
    check(f"{T} close button: same place and size on reopen", all(abs(r4[k] - r2[k]) <= 1 for k in ("x", "y", "w", "h")), f"{r2} -> {r4}")
    # saved: move once more with the keyboard so it is saved, reload, run again, reopen
    page.focus(f"{P} [data-testid=\"fd-titlebar\"]")
    page.keyboard.press("ArrowUp")
    saved = rect(page, P)
    page.reload()
    page.wait_for_selector('[data-testid="get-tools"]')
    run_tool(page, "lab-banking-full", "list_entitlements")
    open_panel(page, "reel")
    r5 = rect(page, P)
    check(f"{T} reload restores the remembered size", abs(r5["w"] - saved["w"]) <= 1 and abs(r5["h"] - saved["h"]) <= 1, f"{saved} -> {r5}")
    check(f"{T} reload restores the remembered place", abs(r5["x"] - saved["x"]) <= 1 and abs(r5["y"] - saved["y"]) <= 1, f"{saved} -> {r5}")
    close_all(page)
    check(f"{T} no hostile popups and no console errors", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def popout_checks(browser):
    """A real same-origin pop-out window, a separate React root, that stays live while stepping."""
    theme = "light"
    ctx, page = new_page(browser, 1440, 900, theme)
    T = "[pop-out 1440]"
    run_tool(page, "lab-banking-full", "list_entitlements")
    page.evaluate("window.scrollTo(0, 0)")
    open_panel(page, "reel")
    open_panel(page, "sequence")
    front(page, "reel")
    page.click('[data-testid="panel-reel"] [data-testid="step-next"]')
    with page.expect_popup() as pop:
        page.click('[data-testid="panel-reel"] button[aria-label="Pop out to a new window"]')
    pw = pop.value
    pw.wait_for_selector('[data-testid="panel-reel-body"]')
    check(f"{T} the reel is drawn in a second window with its own root", pw is not page and pw.query_selector("#fd-root") is not None and pw.evaluate("window.opener !== null"))
    check(f"{T} the opener keeps a placeholder, not the panel", page.query_selector('[data-testid="fd-placeholder"]') is not None and page.query_selector('[data-testid="panel-reel"]') is None)
    check(f"{T} the popup shows the same walk position (Message 1 of 8)", text(pw, '[data-testid="step-counter"]') == "Message 1 of 8", str(text(pw, '[data-testid="step-counter"]')))
    check(f"{T} the popup has the page's stylesheets and theme (the frames are laid out)", pw.evaluate("document.querySelector('[data-testid=frame-1]').getBoundingClientRect().width") > 60)
    pw.click('[data-testid="step-next"]')
    page.wait_for_function("document.querySelector('[data-testid=dock-counter]').textContent === 'Message 2 of 8'")
    check(f"{T} Next in the popup moves the page (dock counter and the sequence panel)", counter(page) == "Message 2 of 8" and page.get_attribute('[data-testid="row-2"]', "aria-current") == "step")
    front(page, "sequence")
    page.click('[data-testid="panel-sequence"] [data-testid="step-next"]')
    pw.wait_for_function("document.querySelector('[data-testid=step-counter]').textContent === 'Message 3 of 8'")
    check(f"{T} Next in the page moves the popup (it stays live)", text(pw, '[data-testid="step-counter"]') == "Message 3 of 8" and pw.get_attribute('[data-testid="frame-3"]', "aria-current") == "step")
    check(f"{T} the popup's step detail follows", "Step 3 detail" in (pw.get_attribute('[data-testid="step-detail"]', "aria-label") or ""))
    # a frame click inside the popup
    pw.click('[data-testid="frame-6"]')
    page.wait_for_function("document.querySelector('[data-testid=dock-counter]').textContent === 'Message 6 of 8'")
    check(f"{T} clicking a frame in the popup steps everything", page.get_attribute('[data-testid="row-6"]', "aria-current") == "step")
    # Simulate on the timer in the popup
    pw.select_option('[data-testid="step-speed"]', "fast")
    pw.click('[data-testid="step-toggle"]')
    pw.wait_for_function("document.querySelector('[data-testid=step-toggle]').textContent.trim() === 'Replay'", timeout=15000)
    check(f"{T} Simulate in the popup plays through and the page agrees", counter(page) == "Message 8 of 8", counter(page))
    pw.screenshot(path=os.path.join(SHOTS, "2b-popout-reel-1440-light.png"))
    shot(page, "popout-page-placeholder", "1440", theme)
    # a new run in the page: the popup shows it (props, no shared context)
    page.click('[data-testid="tab-tools"]')
    page.click('[data-testid="tool-get_portfolio_summary"]')
    page.click('[data-testid="run"]')
    page.wait_for_function("document.querySelector('[data-testid=dock-counter]').textContent === 'Not started, 8 messages'", timeout=8000)
    pw.wait_for_function("document.querySelector('[data-testid=step-counter]').textContent === 'Not started, 8 messages'")
    check(f"{T} a new run in the page restarts the popup's walk", text(pw, '[data-testid="step-counter"]') == "Not started, 8 messages")
    # Escape in the popup closes the window and hides the panel in the page
    try:
        pw.keyboard.press("Escape")
    except Exception:
        pass  # the window closes itself while the key is still being delivered
    page.wait_for_function("!document.querySelector('[data-testid=fd-placeholder]')", timeout=8000)
    check(f"{T} Escape in the popup closes it and the panel is hidden in the page", pw.is_closed() and page.get_attribute('[data-testid="dock-reel"]', "aria-pressed") == "false")

    # the sequence view in a popup
    page.evaluate("window.scrollTo(0, 0)")
    front(page, "sequence")
    page.click('[data-testid="panel-sequence"] button[aria-label="Pop out to a new window"]')
    pw2 = ctx.pages[-1]
    pw2.wait_for_selector('[data-testid="sequence-view"]')
    pw2.click('[data-testid="row-4"]')
    page.wait_for_function("document.querySelector('[data-testid=dock-counter]').textContent === 'Message 4 of 8'")
    check(f"{T} sequence popup: a row click steps the page", pw2.get_attribute('[data-testid="row-4"]', "aria-current") == "step" and counter(page) == "Message 4 of 8")
    pw2.screenshot(path=os.path.join(SHOTS, "2b-popout-sequence-1440-light.png"))
    pw2.click('[data-testid="actor-privilege"]')
    pw2.wait_for_timeout(300)
    in_popup = pw2.query_selector('[data-testid="actor-card"]') is not None
    in_page = page.query_selector('[data-testid="actor-card"]') is not None
    print(f"INFO actor card opened from the sequence popup appears in: popup={in_popup} opener page={in_page}", flush=True)
    check(f"{T} sequence popup: the actor card opens somewhere visible", in_popup or in_page)
    pw2.close()
    page.wait_for_timeout(700)
    check(f"{T} no hostile popups and no console errors in the page", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def narrow_checks(browser, theme):
    ctx, page = new_page(browser, 375, 812, theme)
    T = f"[{theme} 375]"
    vp = "375"
    open_panel(page, "reel")
    shot(page, "empty-reel", vp, theme)
    close_all(page)
    run_tool(page, "lab-banking-limited", "sensitive_tax_record")
    check(f"{T} the dock fits in 375px with no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= 375"))
    dock = rect(page, '[data-testid="panel-dock"]')
    check(f"{T} the dock stays on screen", dock["r"] <= 376 and dock["b"] <= 813)
    for pid in ("reel", "tokens", "sequence", "trace"):
        open_panel(page, pid)
        p = rect(page, f'[data-testid="panel-{pid}"]')
        check(f"{T} {pid}: a full-width bottom sheet that stops above the dock (fix pass N11: the dock stays reachable)", p["x"] == 0 and abs(p["w"] - 375) <= 1 and abs(p["b"] - dock["y"]) <= 1 and p["h"] <= 812 * 0.86, str(p))
        check(f"{T} {pid}: only one panel open on a phone", len(page.query_selector_all('[role="dialog"]')) == 1)
        check(f"{T} {pid}: the sheet has no drag or resize handles", page.query_selector(f'[data-testid="panel-{pid}"] .fd-handle') is None)
        check(f"{T} {pid}: no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= 375"))
        check(f"{T} {pid}: panel body does not overflow sideways", page.evaluate("(sel) => { const b = document.querySelector(sel + ' .fd-body'); return b.scrollWidth <= b.clientWidth + 1; }", f'[data-testid="panel-{pid}"]'), "")
        if pid != "trace":
            before = text(page, '[data-testid="dock-counter"]')
            page.click(f'[data-testid="panel-{pid}"] [data-testid="step-next"]')
            after = text(page, f'[data-testid="panel-{pid}"] [data-testid="step-counter"]')
            check(f"{T} {pid}: Next works on the sheet", after.startswith("Message ") and after != before, f"{before} -> {after}")
        shot(page, f"blocked-{pid}", vp, theme)
        check(f"{T} {pid}: red-free", page.evaluate(RED_SCAN, f'[data-testid="panel-{pid}"]') == [], str(page.evaluate(RED_SCAN, f'[data-testid="panel-{pid}"]'))[:200])
        page.keyboard.press("Escape")
        page.wait_for_selector(f'[data-testid="panel-{pid}"]', state="detached")
    # the walk across panels on a phone: one counter, same position
    open_panel(page, "reel")
    page.click('[data-testid="panel-reel"] [data-testid="step-next"]')
    n1 = text(page, '[data-testid="panel-reel"] [data-testid="step-counter"]')
    page.keyboard.press("Escape")
    open_panel(page, "tokens")
    check(f"{T} the walk position carries from the reel to the token sheet", text(page, '[data-testid="panel-tokens"] [data-testid="step-counter"]') == n1, f"{n1}")
    check(f"{T} no hostile popups and no console errors", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def hostile_checks(browser):
    ctx, page = new_page(browser, 1440, 900, "light")
    T = "[hostile 1440]"
    hostile = "<img src=x onerror=alert(1)>"
    long_key = "k" + "x" * 150
    run_tool(page, "lab-banking-full", "list_entitlements", args_text='{"user": "%s", "%s": "v"}' % (hostile, long_key))
    for pid in ("reel", "tokens", "sequence", "trace"):
        open_panel(page, pid)
    front(page, "reel")
    page.click('[data-testid="panel-reel"] [data-testid="step-next"]')
    page.click('[data-testid="frame-5"]')
    front(page, "tokens")
    page.click('[data-testid="panel-tokens"] [data-testid="tokhop-5"] button')
    page.wait_for_timeout(300)
    for pid in ("reel", "tokens", "sequence", "trace"):
        check(f"{T} {pid}: hostile string is text, not an element", page.query_selector(f'[data-testid="panel-{pid}"] img') is None)
    check(f"{T} the hostile string is shown as text in the step detail", hostile in (text(page, '[data-testid="panel-reel"]') or ""))
    check(f"{T} no alert fired", not page.dialogs, str(page.dialogs))
    check(f"{T} a 150-character argument name wraps: the reel body does not scroll sideways", page.evaluate("(() => { const b = document.querySelector('[data-testid=panel-reel] .fd-body'); return b.scrollWidth <= b.clientWidth + 1; })()"))
    shot(page, "hostile-reel", "1440", "light")
    check(f"{T} no console errors", not page.msgs, str(page.msgs))
    ctx.close()


def real_checks(browser):
    if not REAL:
        print("INFO REAL_BASE not set: Real panels not checked", flush=True)
        return
    ctx, page = new_page(browser, 1440, 900, "light", base=REAL)
    T = "[real 1440]"
    check(f"{T} the source is Real", page.get_attribute('[data-testid="mode-status"]', "data-source") == "real")
    discover(page, "lab-banking-limited")
    page.click('[data-testid="tool-sensitive_tax_record"]'); page.click('[data-testid="run"]')
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")
    open_panel(page, "tokens"); open_panel(page, "trace"); open_panel(page, "reel")
    intro = text(page, '[data-testid="tokens-intro"]') or ""
    check(f"{T} tokens: says only an agent key is held and shows no MOCK label", "Real: this lab only holds an agent key" in intro and "MOCK" not in intro, intro[:160])
    check(f"{T} tokens: no illustrative hop in Real", page.query_selector('[data-testid="panel-tokens"] [data-testid^="tokhop-"]') is not None and "illustrative" not in (text(page, '[data-testid="panel-tokens"]') or ""))
    trace = text(page, '[data-testid="panel-trace"]') or ""
    check(f"{T} trace: Real says observed or inferred, never checked", ("observed" in trace.lower() or "inferred" in trace.lower()) and "checked" not in trace.lower().replace("not checked", ""), trace[:200])
    reel = text(page, '[data-testid="panel-reel"]') or ""
    check(f"{T} reel: no hop is called illustrative or simulated in Real", "illustrative" not in reel.lower() and "MOCK" not in reel)
    shot(page, "real-all-open", "1440", "light")
    check(f"{T} Real refusal panel is the amber kind (not red)", "pgc-fd--red" not in (page.get_attribute('[data-testid="panel-reel"]', "class") or ""))
    close_all(page)
    check(f"{T} no hostile popups and no console errors", not page.dialogs and not page.msgs, str(page.msgs))
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Real-or-mock modal (shared mode-modal): every context starts with it dismissed, so it never covers a click.
        _new_context = browser.new_context
        def _dismissed_context(*a, **k):
            c = _new_context(*a, **k)
            c.add_init_script("try{sessionStorage.setItem('pgc-mode-seen-mock','1');sessionStorage.setItem('pgc-mode-seen-real','1')}catch(e){}")
            return c
        browser.new_context = _dismissed_context
        for theme in ("light", "dark"):
            wide_checks(browser, theme)
            scenario_checks(browser, theme)
            narrow_checks(browser, theme)
        geometry_checks(browser)
        popout_checks(browser)
        hostile_checks(browser)
        real_checks(browser)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
