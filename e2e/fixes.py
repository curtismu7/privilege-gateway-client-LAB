#!/usr/bin/env python3
"""Fix pass N3 to N10: small behaviour fixes, proven in real Chromium at 1440x900 and 375x812, light and dark (screenshots as fix-<what>-<vp>-<theme>.png).

Against a Mock lab (never a real gateway), plus an optional Real lab on the loopback stub (e2e/real-stub.mjs):

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7971 npm start
    PORT=7972 node e2e/real-stub.mjs
    BASE=http://127.0.0.1:7971/ REAL_BASE=http://127.0.0.1:7972/ SHOTS=/some/dir python3 e2e/fixes.py

Exit code 0 only when every check passed.
"""
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:7971/")
REAL = os.environ.get("REAL_BASE", "")
SHOTS = os.environ.get("SHOTS") or os.path.join(tempfile.gettempdir(), "pgc-shots")
os.makedirs(SHOTS, exist_ok=True)
N = 0
FAILS = []
NO_STORAGE = """
for (const k of ['localStorage', 'sessionStorage']) {
  Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
}
"""


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def shot(page, what, w, theme):
    page.screenshot(path=os.path.join(SHOTS, f"fix-{what}-{w}-{theme}.png"))


def new_page(browser, w, h, theme, base=None, no_storage=False, query=""):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    if no_storage:
        ctx.add_init_script(NO_STORAGE)
    page = ctx.new_page()
    page.msgs = []
    page.on("console", lambda m: page.msgs.append((m.type, m.text)) if m.type in ("error",) else None)
    page.on("pageerror", lambda e: page.msgs.append(("pageerror", str(e))))
    page.goto((base or BASE) + query)
    page.wait_for_selector('[data-testid="get-tools"], [data-testid="verdict-card"]')
    return ctx, page


def rect(page, sel):
    return page.evaluate("""(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; }""", sel)


def overlap(a, b):
    if not a or not b:
        return 0
    w = min(a["r"], b["r"]) - max(a["x"], b["x"])
    h = min(a["b"], b["b"]) - max(a["y"], b["y"])
    return max(0, w) * max(0, h)


def wait_done(page):
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")


# ---- N3: the Talk track opens below the header, with or without browser storage -----------------------------------------------------------
def n3_talk_place(browser, w, h, theme):
    for no_storage in (False, True):
        tag = "no storage" if no_storage else "storage"
        ctx, page = new_page(browser, w, h, theme, no_storage=no_storage)
        page.click('[data-testid="dock-talk"]')
        page.wait_for_selector('[data-testid="talk-track-dialog"]')
        page.wait_for_timeout(150)
        hb = rect(page, ".shell-bar")["b"]
        d = rect(page, '[data-testid="talk-track-dialog"]')
        controls = rect(page, ".top-menu")
        if w > 600:
            check(f"[N3 {tag} {w} {theme}] the Talk track opens below the header (dialog y {d['y']:.0f} >= header bottom {hb:.0f})", d["y"] >= hb - 1, str(d))
            check(f"[N3 {tag} {w} {theme}] it does not cover the header controls", overlap(d, controls) == 0, f"{d} {controls}")
        else:
            check(f"[N3 {tag} {w} {theme}] on a phone it is a sheet inside the viewport", d["y"] >= 0 and d["b"] <= h + 1 and d["w"] <= w + 1, str(d))
        tt = page.inner_text('[data-testid="talk-track-dialog"]')
        check(f"[N4 {tag} {w} {theme}] the talk track shows no literal Markdown asterisks", "**" not in tt and "`" not in tt, tt[:80])
        if no_storage:
            shot(page, "talk-place-nostorage", w, theme)
        ctx.close()


# ---- N7: Escape leaves presenter mode in one press (dialog-first only when a dialog is focused) -----------------------------------------------
def n7_presenter_escape(browser, w, h, theme):
    ctx, page = new_page(browser, w, h, theme, query="?presenter=1")
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.evaluate("document.querySelector('[data-testid=action-discover]').click()")  # on a phone the talk-track sheet covers the button
    wait_done(page)
    page.wait_for_timeout(500)  # the Movie reel opens beside the Talk track once there is a run
    on = page.evaluate("document.documentElement.dataset.presenter")
    check(f"[N7 {w} {theme}] presenter mode is on at the start", on == "1", str(on))
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    now = page.evaluate("document.documentElement.dataset.presenter")
    check(f"[N7 {w} {theme}] one Escape leaves presenter mode (auto-opened dialogs do not hold focus)", now == "0", f"presenter={now}")
    ctx.close()
    # a focused dialog still closes first
    ctx, page = new_page(browser, w, h, theme, query="?presenter=1")
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_timeout(300)
    page.focus('[data-testid="talk-track-dialog"]')  # the person works inside the Talk track: focus is inside the dialog
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    still = page.evaluate("document.documentElement.dataset.presenter")
    gone = page.query_selector('[data-testid="talk-track-dialog"]:not([hidden])') is None or not page.is_visible('[data-testid="talk-track-dialog"]')
    check(f"[N7 {w} {theme}] with a dialog focused, Escape closes that dialog first and presenter stays on", still == "1" and gone, f"presenter={still} dialog closed={gone}")
    ctx.close()


# ---- N5: a Mock/Real switch closes the open panels; reopened, they sit clear of the card and its buttons --------------------------------------
def n5_mode_switch(browser, w, h, theme):
    if not REAL:
        return
    ctx, page = new_page(browser, w, h, theme, base=REAL)
    page.click('[data-testid="get-tools"]')
    wait_done(page)
    if w > 600:
        page.click('[data-testid="dock-reel"]')
        page.click('[data-testid="dock-trace"]')
        page.wait_for_selector('[data-testid="panel-reel"]')
    else:
        page.click('[data-testid="dock-reel"]')
        page.wait_for_selector('[data-testid="panel-reel"]')
    page.select_option('[data-testid="mode-select"]', "mock")
    page.wait_for_function("!document.querySelector('[data-testid=sim-banner]')?.dataset.state")
    page.wait_for_timeout(300)
    open_now = page.evaluate("[...document.querySelectorAll('[data-testid^=panel-]')].filter((e) => e.matches('.fd-panel') && getComputedStyle(e).display !== 'none').length")
    check(f"[N5 {w} {theme}] after Real to Mock no panel is left open", open_now == 0, f"{open_now} open")
    page.click('[data-testid="dock-reel"]')
    page.wait_for_selector('[data-testid="panel-reel"]')
    page.wait_for_timeout(200)
    card = rect(page, '[data-testid="verdict-card"]')
    panel = rect(page, '[data-testid="panel-reel"]')
    if w > 600:
        check(f"[N5 {w} {theme}] a reopened panel does not cover the verdict card", overlap(panel, card) == 0, f"{panel} {card}")
        btn = rect(page, '[data-testid="action-discover"]')
        check(f"[N5 {w} {theme}] nor its button", overlap(panel, btn) == 0, f"{panel} {btn}")
    shot(page, "mode-switch-panels", w, theme)
    page.evaluate("fetch('/api/mode', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'real'})})")  # the stub lab's mode is process-wide: leave it in Real
    page.wait_for_timeout(200)
    ctx.close()


# ---- N6: the Real rail heading matches its data -------------------------------------------------------------------------------------------
def n6_real_rail(browser, w, h, theme):
    if not REAL:
        return
    ctx, page = new_page(browser, w, h, theme, base=REAL)
    if not page.is_visible('[data-testid="gateway-identity"]'):
        page.click('[data-testid="rail-toggle"]')
    heading = page.inner_text("#pgc-who-h")
    check(f"[N6 {w} {theme}] the Real rail heading is 'Identity this lab declares' (got {heading!r})", heading.strip().lower() == "identity this lab declares")
    check(f"[N6 {w} {theme}] the Real avatar is not a '?'", "?" not in page.inner_text('[data-testid="gateway-identity"] .pgc-avatar'))
    page.evaluate("document.querySelector('[data-testid=rail]').scrollIntoView({block:'start'})")
    shot(page, "real-rail", w, theme)
    ctx.close()
    ctx, page = new_page(browser, w, h, theme)
    if not page.is_visible('[data-testid="gateway-identity"]'):
        page.click('[data-testid="rail-toggle"]')
    check(f"[N6 {w} {theme}] Mock keeps 'Who the gateway evaluates'", page.inner_text("#pgc-who-h").strip().lower() == "who the gateway evaluates")
    ctx.close()


# ---- N8: the Mock upstream card does not claim a real observation ---------------------------------------------------------------------------
def n8_mock_basis(browser, w, h, theme):
    ctx, page = new_page(browser, w, h, theme)
    if not page.is_visible('[data-testid="door-picker"]'):
        page.click('[data-testid="rail-toggle"]')
    page.evaluate("document.querySelector('[data-testid=advanced]').open = true")
    page.select_option("#pgc-scenario", "upstream-error")
    page.click('[data-testid="get-tools"]')
    wait_done(page)
    facts = page.inner_text('[data-testid="verdict-facts"]')
    check(f"[N8 {w} {theme}] 'Simulated by this lab' under the SIMULATED line", "Simulated by this lab" in facts and "Observed: read directly" not in facts, facts[:200])
    page.evaluate("document.querySelector('[data-testid=verdict-card]').scrollIntoView({block:'start'})")
    shot(page, "mock-basis", w, theme)
    ctx.close()


# ---- N9: the skip link ---------------------------------------------------------------------------------------------------------------------
def n9_skip_link(browser, w, h, theme):
    ctx, page = new_page(browser, w, h, theme)
    page.keyboard.press("Tab")
    first = page.evaluate("document.activeElement?.getAttribute('data-testid')")
    check(f"[N9 {w} {theme}] the first Tab stop is the skip link", first == "skip-link", str(first))
    r = rect(page, '[data-testid="skip-link"]')
    check(f"[N9 {w} {theme}] it is visible while focused (inside the viewport)", r and r["y"] >= 0 and r["b"] <= h and r["x"] >= 0 and r["r"] <= w, str(r))
    shot(page, "skip-link", w, theme)
    page.keyboard.press("Enter")
    now = page.evaluate("document.activeElement?.id")
    check(f"[N9 {w} {theme}] Enter moves focus to main", now == "pgc-main", str(now))
    page.keyboard.press("Tab")
    nxt = page.evaluate("document.activeElement?.closest('main') !== null")
    check(f"[N9 {w} {theme}] the next Tab stop is inside main (the header was skipped)", nxt)
    page.goto(BASE)
    page.wait_for_selector('[data-testid="get-tools"]')
    off = rect(page, '[data-testid="skip-link"]')
    check(f"[N9 {w} {theme}] unfocused it is off screen", off and off["b"] <= 0, str(off))
    ctx.close()


# ---- N10: security headers hold in the real build: no violations, popout works, the page cannot be framed ---------------------------------
def n10_headers(browser, w, h, theme):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme)
    ctx.add_init_script("window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' ' + e.blockedURI));")
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    resp = page.goto(BASE)
    csp = resp.headers.get("content-security-policy", "")
    check(f"[N10 {w} {theme}] the page is served with a CSP, X-Frame-Options DENY and nosniff", "frame-ancestors 'none'" in csp and resp.headers.get("x-frame-options") == "DENY" and resp.headers.get("x-content-type-options") == "nosniff", str(resp.headers))
    page.wait_for_selector('[data-testid="get-tools"]')
    page.click('[data-testid="get-tools"]')
    page.wait_for_selector('[data-testid="verdict-card"][data-verdict="allowed"]')  # no wait_for_function: it evals, which the CSP refuses
    for pid in ("reel", "tokens", "sequence", "diagram", "trace"):
        if w > 600 or pid == "trace":
            page.click(f'[data-testid="dock-{pid}"]'); page.wait_for_selector(f'[data-testid="panel-{pid}"]')
            page.wait_for_timeout(120)
    if w > 600:
        with page.expect_popup() as pop:
            page.click('[data-testid="panel-reel"] button[aria-label="Pop out to a new window"]')
        pw = pop.value
        pw.wait_for_selector('[data-testid="panel-reel-body"]')
        check(f"[N10 {w} {theme}] the pop-out window is styled under the CSP", pw.evaluate("document.querySelector('[data-testid=frame-1]').getBoundingClientRect().width") > 60)
        pv = pw.evaluate("window.__v || []")
        check(f"[N10 {w} {theme}] no CSP violation in the pop-out", not pv, str(pv))
        pw.close()
    v = page.evaluate("window.__v")
    check(f"[N10 {w} {theme}] no CSP violation while using the page and every panel", not v, str(v))
    check(f"[N10 {w} {theme}] no console error", not errs, str(errs[:3]))
    shot(page, "csp-page", w, theme)
    # framing is refused
    host = ctx.new_page()
    host.set_content(f'<iframe id="f" src="{BASE}" style="width:400px;height:300px"></iframe>')
    host.wait_for_timeout(800)
    fr = [f for f in host.frames if f != host.main_frame]
    url = fr[0].url if fr else ""
    ok = (not fr) or url.startswith("chrome-error") or (fr[0].evaluate("document.querySelector('#root')") is None if not url.startswith("chrome-error") else True)
    check(f"[N10 {w} {theme}] the page cannot be framed (frame url {url!r})", ok)
    ctx.close()


# ---- N11: a short viewport (200% zoom: 720x450) and the phone sheet vs the dock -------------------------------------------------------------
def n11_short_and_sheet(browser, theme):
    # 720x450 is a 1440x900 window at 200% zoom
    ctx, page = new_page(browser, 720, 450, theme)
    page.click('[data-testid="get-tools"]'); wait_done(page)
    page.click('[data-testid="dock-sequence"]')
    page.wait_for_selector('[data-testid="panel-sequence"]')
    page.wait_for_timeout(250)
    pr = rect(page, '[data-testid="panel-sequence"]')
    dock = rect(page, ".pgc-dock")
    body = page.evaluate("""() => { const p = document.querySelector('[data-testid=panel-sequence]'); const bar = p.querySelector('.pgc-stepbar'); const view = [...p.querySelectorAll('[data-testid]')].find((e) => /^row-|sequence-view|seq/.test(e.getAttribute('data-testid'))); const r = p.getBoundingClientRect(); const b = p.querySelector('.fd-body, .fd-content') ; return { bodyH: b ? b.getBoundingClientRect().height : null, barB: bar ? bar.getBoundingClientRect().bottom : null, scrollH: b ? b.scrollHeight : null }; }""")
    check(f"[N11 720x450 {theme}] the Sequence panel is at least 320px tall (got {pr['h']:.0f})", pr["h"] >= 320, str(pr))
    check(f"[N11 720x450 {theme}] it stays clear of the dock", pr["b"] <= dock["y"] + 1, f"{pr} {dock}")
    check(f"[N11 720x450 {theme}] the first rows of the sequence are visible below the toolbars (body {body})", body["bodyH"] is not None and body["barB"] is not None and (pr["b"] - body["barB"]) >= 150, str(body))
    shot(page, "short-viewport-sequence", 720, theme)
    ctx.close()
    # 375: a bottom sheet must leave the dock reachable
    ctx, page = new_page(browser, 375, 812, theme)
    page.click('[data-testid="get-tools"]'); wait_done(page)
    page.click('[data-testid="dock-reel"]')
    page.wait_for_selector('[data-testid="panel-reel"]')
    page.wait_for_timeout(250)
    pr = rect(page, '[data-testid="panel-reel"]')
    dock = rect(page, ".pgc-dock")
    check(f"[N11 375 {theme}] the bottom sheet does not cover the dock", overlap(pr, dock) == 0, f"{pr} {dock}")
    top = page.evaluate("(() => { const b = document.querySelector('[data-testid=dock-sequence]').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-testid]')?.getAttribute('data-testid'); })()")
    check(f"[N11 375 {theme}] the other dock buttons can be pressed while a sheet is open (hit {top!r})", top == "dock-sequence", str(top))
    shot(page, "sheet-over-dock", 375, theme)
    page.click('[data-testid="dock-sequence"]')
    page.wait_for_selector('[data-testid="panel-sequence"]')
    page.wait_for_timeout(200)
    check(f"[N11 375 {theme}] pressing another dock button swaps the sheet", page.query_selector('[data-testid="panel-sequence"]') is not None)
    ctx.close()


if __name__ == "__main__":
    only = sys.argv[1:]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for (w, h) in ((1440, 900), (375, 812)):
            for theme in ("light", "dark"):
                n3_talk_place(browser, w, h, theme)
                n7_presenter_escape(browser, w, h, theme)
                n5_mode_switch(browser, w, h, theme)
                n6_real_rail(browser, w, h, theme)
                n8_mock_basis(browser, w, h, theme)
                n9_skip_link(browser, w, h, theme)
                n10_headers(browser, w, h, theme)
                if w == 1440:
                    n11_short_and_sheet(browser, theme)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f[:300])
    sys.exit(1 if FAILS else 0)
