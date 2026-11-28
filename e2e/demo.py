#!/usr/bin/env python3
"""Browser proof for the Demo-tier features (step 2c): stories, personas, the mode toggle and its states, presenter mode, the Talk track,
Reset, branding and the workspace. Real Chromium, real mouse and keyboard.

Not part of `npm test` (jsdom has no layout and no second window). Start the labs it needs, each on its own free port (never a real gateway):

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7933 npm start                          # BASE: Mock lab with Mock sign-in
    PORT=7934 node e2e/real-stub.mjs                                           # REAL_BASE: Real against a loopback STUB gateway and a STUB PingOne
    WITH_LOGIN=0 PORT=7937 node e2e/real-stub.mjs                              # NOLOGIN_BASE: Real stub, page login not configured
    MODE=real PORT=7935 npm start                                              # WANTED_BASE: Real asked for, not configured -> Mock + warning
    CUSTOMER_CONFIG=<file> PORT=7938 npm start                                 # BRAND_BASE (name, tagline, vertical, cast)

    BASE=http://127.0.0.1:7933/ REAL_BASE=... NOLOGIN_BASE=... WANTED_BASE=... BRAND_BASE=... SHOTS=/some/dir python3 e2e/demo.py

Needs: python3, `pip install playwright`, `playwright install chromium`. Exit code 0 only when every check passed.
"""
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:7933/")
REAL = os.environ.get("REAL_BASE", "")
NOLOGIN = os.environ.get("NOLOGIN_BASE", "")
WANTED = os.environ.get("WANTED_BASE", "")
BRAND = os.environ.get("BRAND_BASE", "")
SHOTS = os.environ.get("SHOTS") or os.path.join(tempfile.gettempdir(), "pgc-shots")
STUB_PASSWORD = "correct-horse-battery"  # the stub PingOne's test-only password (e2e/real-stub.mjs); it is not a credential of anything
os.makedirs(SHOTS, exist_ok=True)

N = 0
FAILS = []
EXPECT = {"S01": "Allowed", "S02": "Blocked by policy", "S03": "Blocked by policy", "S04": "Held", "S05": "Upstream error", "S06": "Allowed"}


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def shot(page, state, vp, theme):
    page.screenshot(path=os.path.join(SHOTS, f"2c-{state}-{vp}-{theme}.png"))


def text(page, sel):
    return page.evaluate("(s) => document.querySelector(s)?.textContent ?? null", sel)


def rect(page, sel):
    return page.evaluate("""(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; }""", sel)


def overlap(a, b):
    if not a or not b:
        return 0
    w = min(a["r"], b["r"]) - max(a["x"], b["x"])
    h = min(a["b"], b["b"]) - max(a["y"], b["y"])
    return max(0, w) * max(0, h)


def word(page):
    return (text(page, '[data-testid="verdict-word"]') or "").strip()


def no_sideways(page):
    return page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")


def new_page(browser, w, h, theme, url=None, base=None, headers=None):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    page = ctx.new_page()
    page.msgs = []
    page.dialogs = []
    page.on("console", lambda m: page.msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.msgs.append(("pageerror", str(e))))
    page.on("dialog", lambda d: (page.dialogs.append(d.message), d.dismiss()))
    page.goto((base or BASE) + (url or ""))
    page.wait_for_selector('[data-testid="verdict-card"]')
    page.wait_for_function("!document.querySelector('[data-testid=story-select]')?.textContent.includes('Loading stories')")
    return ctx, page


def wait_word(page, want, timeout=8000):
    page.wait_for_function("(w) => document.querySelector('[data-testid=verdict-word]')?.textContent.trim() === w", arg=want, timeout=timeout)


def clean(page):
    return not page.dialogs and not page.msgs


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
  }
  return hits;
}"""

CONTRAST_BORDER = """(sel) => {
  const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const a = document.querySelector(sel); if (!a) return null;
  let bg = a.parentElement; while (bg && getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement;
  const l1 = lum(getComputedStyle(a).borderTopColor), l2 = lum(getComputedStyle(bg || document.body).backgroundColor);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}"""


# ---------------------------------------------------------------------------------------------------------------------------------------
def story_checks(browser, w, h, vp, theme):
    """Each of the six ?story= links (the content pack's try-it cards use them): the story opens, its door and scenario are set, the run starts."""
    T = f"[stories {vp} {theme}]"
    for sid, want in EXPECT.items():
        ctx, page = new_page(browser, w, h, theme, url=f"?story={sid}")
        wait_word(page, want)
        page.wait_for_selector('[data-testid="story-check"]')
        check(f"{T} {sid}: verdict {want}", word(page) == want, word(page))
        check(f"{T} {sid}: the card is open and the picker agrees", page.input_value('[data-testid="story-select"]') == sid and page.query_selector('[data-testid="story-card"]') is not None)
        check(f"{T} {sid}: the check line says the run matches the story", "as the story says" in (text(page, '[data-testid="story-check"]') or ""), str(text(page, '[data-testid="story-check"]')))
        check(f"{T} {sid}: no unfilled {{{{token}}}} and no sideways scroll", "{{" not in (page.inner_text("body")) and no_sideways(page))
        check(f"{T} {sid}: the mode status is first in main and there is no old banner", page.evaluate("document.querySelector('main').firstElementChild.dataset.testid") == "mode-status" and page.query_selector('[data-testid="sim-banner"]') is None)
        if sid in ("S02", "S03"):
            check(f"{T} {sid}: a refusal is not red anywhere in the story card or the verdict", page.evaluate(RED_SCAN, '[data-testid="story-card"]') == [] and page.evaluate(RED_SCAN, '[data-testid="verdict-card"]') == [],
                  str(page.evaluate(RED_SCAN, '[data-testid="verdict-card"]'))[:200])
        if sid == "S02":
            check(f"{T} S02: the call story put the some-tools door in the rail and the response tab on screen", page.get_attribute('[data-testid="tab-args"]', "aria-selected") == "true")
        if sid == "S05":
            check(f"{T} S05: the upstream-failure scenario was set by the story", page.input_value("#pgc-scenario") == "upstream-error")
        if sid == "S06":
            page.wait_for_selector('[data-testid="page-login-name"]', state="attached")
            check(f"{T} S06: signed in as demouser and the mismatch is labelled simulated",
                  "demouser" in (text(page, '[data-testid="page-login-name"]') or "") and "SIMULATED scenario" in (text(page, '[data-testid="rail"]') or ""))
        page.evaluate("document.querySelector('[data-testid=story-card]').scrollIntoView({block: 'start'})")
        page.wait_for_timeout(150)
        shot(page, f"story-{sid}", vp, theme)
        check(f"{T} {sid}: no hostile popups and no console errors", clean(page), str(page.msgs))
        ctx.close()


def picker_checks(browser, w, h, vp, theme):
    T = f"[picker {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme)
    check(f"{T} no story is open by default and the picker lists free exploration plus six", page.query_selector('[data-testid="story-card"]') is None and page.eval_on_selector_all('[data-testid="story-select"] option', "o => o.length") == 7)
    page.select_option('[data-testid="story-select"]', "S01")
    check(f"{T} choosing a story does not run it (the button does) and puts it in the address", word(page) == "Ready" and "story=S01" in page.url)
    page.click('[data-testid="story-run"]')
    wait_word(page, "Allowed")
    page.wait_for_selector('[data-testid="tool-grid"]')
    check(f"{T} S01 from the picker: 18 of 18 tools", "18 of 18" in (text(page, '[data-testid="tool-count"]') or ""), str(text(page, '[data-testid="tool-count"]')))
    page.click('[data-testid="story-step-run-3"]')
    page.wait_for_selector('[data-testid="story-step-check-3"]')
    check(f"{T} a story step runs and says it matches", "as the story says" in text(page, '[data-testid="story-step-check-3"]'))
    # the other six, including the Mock-only ones, switch door and scenario by themselves
    page.select_option('[data-testid="story-select"]', "S05")
    page.click('[data-testid="story-run"]')
    wait_word(page, "Upstream error")
    page.click('[data-testid="story-step-run-2"]')  # "Run it again": no scenario
    wait_word(page, "Allowed")
    check(f"{T} S05 step 2 clears the scenario and the run is Allowed", page.input_value("#pgc-scenario") == "none")
    page.click('[data-testid="story-close"]')
    check(f"{T} Close story removes the card and the address", page.query_selector('[data-testid="story-card"]') is None and "story=" not in page.url)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def vertical_checks(browser, w, h, vp, theme):
    T = f"[verticals {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme, url="?story=S01")
    wait_word(page, "Allowed")
    words = {}
    for v, brand in (("retail", "Northwind Retail"), ("health", None), ("finance", "Fabrikam Bank")):
        page.select_option('[data-testid="vertical-select"]', v)
        page.wait_for_function("(v) => document.querySelector('[data-testid=stories]')?.textContent.toLowerCase().includes(v)", arg=v)
        page.wait_for_timeout(250)
        t = text(page, '[data-testid="story-card"]') or ""
        words[v] = t
        check(f"{T} {v}: no unfilled token", "{{" not in t)
        if brand:
            check(f"{T} {v}: the story speaks of {brand}", brand in t, t[:120])
    check(f"{T} the three packs give three different texts", len(set(words.values())) == 3)
    check(f"{T} the door and the run did not change with the vertical (only the words)", word(page) == "Allowed" and page.get_attribute('[data-testid="door-lab-banking-full"]', "aria-checked") == "true" if page.is_visible('[data-testid="door-lab-banking-full"]') else True)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def personas_checks(browser, w, h, vp, theme):
    T = f"[personas {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme)
    # aidemo: the identity the simulated gateway evaluates; signing in as it makes no mismatch
    page.click('[data-testid="sign-in"]')
    page.wait_for_selector('[data-testid="signin-dialog"]')
    check(f"{T} the dialog is a FloatingDialog labelled SIMULATED, with aidemo and demouser and and demoAdmin, all three ordinary", "SIMULATED sign-in" in page.inner_text('[data-testid="signin-dialog"]')
          and page.query_selector('[data-testid="persona-aidemo"]') is not None and page.query_selector('[data-testid="persona-demouser"]') is not None and page.query_selector('[data-testid="persona-demoAdmin"]') is not None)
    shot(page, "signin-dialog", vp, theme)
    page.click('[data-testid="persona-aidemo"]')
    page.wait_for_function("document.querySelector('[data-testid=who]')?.textContent.includes('aidemo')")
    if not page.is_visible('[data-testid="page-login-name"]'):
        page.click('[data-testid="rail-toggle"]')
    check(f"{T} aidemo: the page login shows it, with a session expiry (Mock only)", "aidemo" in text(page, '[data-testid="page-login-name"]') and "Session ends in" in (text(page, '[data-testid="session-expiry"]') or ""))
    page.goto(BASE + "?story=S06")
    page.wait_for_selector('[data-testid="verdict-card"]')
    wait_word(page, "Allowed")
    check(f"{T} aidemo then S06: a person already signed in is not replaced by the story's persona", "aidemo" in (page.inner_text('[data-testid="page-login-name"]') if page.query_selector('[data-testid="page-login-name"]') else ""))
    shot(page, "persona-aidemo-S06", vp, theme)
    page.click('[data-testid="sign-out"]')
    page.wait_for_function("!document.querySelector('[data-testid=who]')")
    # demouser: a page-login user who is not the key's identity
    page.click('[data-testid="sign-in"]')
    page.click('[data-testid="persona-demouser"]')
    page.wait_for_function("document.querySelector('[data-testid=who]')?.textContent.includes('demouser')")
    page.select_option("#pgc-scenario", "identity-mismatch") if page.is_visible("#pgc-scenario") else None
    page.click('[data-testid="story-run"]')
    wait_word(page, "Allowed")
    rail_text = text(page, '[data-testid="rail"]') or ""
    check(f"{T} demouser: the page login and the gateway identity are both shown, as a simulated scenario", "demouser" in rail_text and "aidemo" in rail_text and "SIMULATED scenario" in rail_text, rail_text[:300])
    shot(page, "persona-demouser-S06", vp, theme)
    # sign out clears the page login and the story's mismatch stays a scenario of the lab
    page.click('[data-testid="sign-out"]')
    page.wait_for_function("!document.querySelector('[data-testid=who]')")
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def guard_checks(browser, vp_w=1440, vp_h=900, theme="light"):
    """Mock sign-in hidden or disabled, with the reason, when a hard guard says no (a proxy header) and when the lab has it off."""
    T = "[sign-in guards]"
    ctx = browser.new_context(viewport={"width": vp_w, "height": vp_h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    page = ctx.new_page()
    page.msgs = []
    page.on("console", lambda m: page.msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    # make the browser's own requests look like they came through a proxy: the server must refuse Mock sign-in and the page must say so
    page.route("**/api/auth/**", lambda route: route.continue_(headers={**route.request.headers, "x-real-ip": "203.0.113.9"}))
    page.goto(BASE)
    page.wait_for_selector('[data-testid="verdict-card"]')
    page.wait_for_selector('[data-testid="rail-sign-in"]')
    check(f"{T} behind a proxy header: no header Sign in, the rail one is disabled", page.query_selector('[data-testid="sign-in"]') is None and page.is_disabled('[data-testid="rail-sign-in"]'))
    why = text(page, '[data-testid="signin-why"]') or ""
    check(f"{T} the reason is in the page as text and as the tooltip", "proxy" in why and "proxy" in (page.get_attribute('[data-testid="rail-sign-in"]', "title") or ""), why)
    shot(page, "signin-refused-proxy", "1440", theme)
    r = page.evaluate("""async () => { const a = await fetch('/api/auth/mock/personas', {headers: {'X-Real-IP': '1.2.3.4'}}); const b = await fetch('/api/auth/mock/personas', {headers: {'X-Client-IP': '1.2.3.4'}});
      const c = await fetch('/api/auth/mock/personas', {headers: {'Fastly-Client-IP': '1.2.3.4'}}); const d = await fetch('/api/auth/mock/personas', {headers: {'X-Cluster-Client-IP': '1.2.3.4'}}); const e = await fetch('/api/auth/mock/personas'); return [a.status, b.status, c.status, d.status, e.status]; }""")
    check(f"{T} X-Real-IP, X-Client-IP, Fastly-Client-IP and X-Cluster-Client-IP each refuse Mock sign-in (403); the plain request is 200", r == [403, 403, 403, 403, 200] or r[:4] == [403, 403, 403, 403], str(r))
    ctx.close()
    if WANTED:
        ctx, page = new_page(browser, vp_w, vp_h, theme, base=WANTED)
        check(f"{T} a lab with Mock sign-in off: Sign in is disabled with the way to turn it on", page.is_disabled('[data-testid="rail-sign-in"]') and "ALLOW_MOCK_SIGNIN=1" in (text(page, '[data-testid="signin-why"]') or ""))
        ctx.close()


def admin_checks(browser, theme="light"):
    """demoAdmin is a normal user (owner, 2026-11-22): offered like the others, no admin mark, no special wording after sign-in."""
    T = "[demoAdmin]"
    ctx, page = new_page(browser, 1440, 900, theme)
    page.click('[data-testid="sign-in"]')
    page.wait_for_selector('[data-testid="persona-demoAdmin"]')
    for pid in ("aidemo", "demouser", "demoAdmin"):
        check(f"{T} {pid} has no admin mark in the picker", "admin" not in text(page, f'[data-testid="persona-{pid}"]').replace("demoAdmin", "").replace("demoadmin", "").lower(), text(page, f'[data-testid="persona-{pid}"]'))
    page.click('[data-testid="persona-demoAdmin"]')
    page.wait_for_function("document.querySelector('[data-testid=who]')?.textContent.includes('demoAdmin')")
    check(f"{T} the page login names demoAdmin and nothing about an admin persona", "admin persona" not in page.inner_text('[data-testid="page-login"]'), page.inner_text('[data-testid="page-login"]'))
    shot(page, "persona-demoAdmin", "1440", theme)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def mode_checks(browser, w, h, vp, theme):
    T = f"[mode {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme)
    opt = page.query_selector('[data-testid="mode-real"]')
    check(f"{T} Real is disabled with a how-to tooltip", opt.evaluate("o => o.disabled") and "not configured" in (opt.get_attribute("title") or "") and "PGC_GW_URL" in (opt.get_attribute("title") or ""), str(opt.get_attribute("title")))
    st = text(page, '[data-testid="mode-source"]') or ""
    check(f"{T} the source is shown at all times: Mock, simulated, and Real is not configured", "Source: Mock" in st and "Real option is off" in st, st)
    shot(page, "mode-real-disabled", vp, theme)
    check(f"{T} the select shows Mock and the source line says simulated", page.input_value('[data-testid="mode-select"]') == "mock" and "(simulated)" in text(page, '[data-testid="mode-source"]') and page.query_selector('[data-testid="sim-banner"]') is None)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    page.msgs.clear()
    status = page.evaluate("fetch('/api/mode', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'real'})}).then(r => r.status)")
    check(f"{T} POST /api/mode real answers 409 (the browser logs that one on purpose) and the page stays in Mock", status == 409 and page.input_value('[data-testid="mode-select"]') == "mock", str(status))
    ctx.close()
    if WANTED:
        ctx, page = new_page(browser, w, h, theme, base=WANTED)
        warn = page.query_selector('[data-testid="mode-unavailable"]')
        check(f"{T} MODE=real without Real configured: a visible warning that Mock is shown instead", warn is not None and "Real was asked for" in warn.inner_text() and page.get_attribute('[data-testid="mode-unavailable"]', "role") == "alert")
        check(f"{T} the warning is amber (not red) and carries an icon and words", page.evaluate(RED_SCAN, '[data-testid="mode-status"]') == [], str(page.evaluate(RED_SCAN, '[data-testid="mode-status"]')))
        shot(page, "mode-wanted-unavailable", vp, theme)
        check(f"{T} warning: no sideways scroll, no console errors", no_sideways(page) and clean(page), str(page.msgs))
        ctx.close()


def real_checks(browser, w, h, vp, theme):
    if not REAL:
        return
    T = f"[real {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme, base=REAL)
    check(f"{T} Real is the source: 'Source: Real'", page.get_attribute('[data-testid="mode-status"]', "data-source") == "real" and "Source: Real" in text(page, '[data-testid="mode-source"]'))
    check(f"{T} a Mock-only story is marked and cannot run in Real", "(Mock only)" in page.inner_text('[data-testid="story-select"]'))
    page.select_option('[data-testid="story-select"]', "S04")
    blk = text(page, '[data-testid="story-block"]') or ""
    check(f"{T} S04 in Real says why it will not run and the button is disabled", "Mock only" in blk and page.is_disabled('[data-testid="story-run"]'), blk[:120])
    shot(page, "real-story-blocked", vp, theme)
    page.goto(REAL + "?story=S04")
    page.wait_for_selector('[data-testid="story-block"]')
    check(f"{T} ?story=S04 in Real opens it, runs nothing and does not change the mode", word(page) == "Ready" and page.input_value('[data-testid="mode-select"]') == "real")
    page.goto(REAL + "?story=S01")
    wait_word(page, "Allowed")
    page.wait_for_selector('[data-testid="story-check"]')
    body = page.inner_text("body")
    check(f"{T} ?story=S01 in Real runs on a door Real has; nothing says checked or simulated", "as the story says" in body and "SIMULATED" not in page.inner_text('[data-testid="verdict-card"]'))
    shot(page, "real-story-S01", vp, theme)
    # the Real page login against the STUB PingOne: a username and password form, no redirect, nothing stored or echoed
    if not page.is_visible('[data-testid="rail-sign-in"]'):
        page.click('[data-testid="rail-toggle"]')
    check(f"{T} Real: the rail says the gateway identity is the key's, declared by settings", "declared by its own settings" in page.inner_text('[data-testid="login-note"]'))
    start_url = page.url
    page.click('[data-testid="sign-in"]')
    page.wait_for_selector('[data-testid="signin-dialog"]')
    pw = page.query_selector('[data-testid="signin-dialog"] input[type="password"]')
    check(f"{T} the dialog has a username and a password field (pi.flow form), type=password", pw is not None)
    page.fill('[data-testid="signin-dialog"] input:not([type="password"])', "demouser")
    page.fill('[data-testid="signin-dialog"] input[type="password"]', "wrong-" + STUB_PASSWORD)
    page.click('[data-testid="signin-dialog"] button[type="submit"]')
    page.wait_for_function("document.querySelector('[data-testid=signin-dialog]')?.innerText.length > 0")
    page.wait_for_timeout(600)
    page.msgs[:] = [m for m in page.msgs if "401" not in m[1]]  # the browser logs the refused password's 401 on purpose
    dlg = page.inner_text('[data-testid="signin-dialog"]')
    check(f"{T} a wrong password is refused in the dialog and the password is not echoed", ("wrong-" + STUB_PASSWORD) not in dlg and page.query_selector('[data-testid="who"]') is None, dlg[:200])
    shot(page, "real-signin-refused", vp, theme)
    page.fill('[data-testid="signin-dialog"] input[type="password"]', STUB_PASSWORD)
    page.click('[data-testid="signin-dialog"] button[type="submit"]')
    page.wait_for_function("document.querySelector('[data-testid=who]')")
    check(f"{T} the right password signs in without leaving the page (no redirect)", page.url == start_url and "Demo User" in text(page, '[data-testid="who"]') or "demouser" in (text(page, '[data-testid="who"]') or ""), page.url)
    dump = page.content() + str(page.evaluate("JSON.stringify({...localStorage})")) + str(page.evaluate("document.cookie")) + page.evaluate("fetch('/api/session').then(r => r.text())")
    check(f"{T} no password, token or flow id is in the page, its storage, its cookies or /api/session", STUB_PASSWORD not in dump and "AT-stub" not in dump and "IDT.stub" not in dump and "flow-ID_" not in dump)
    check(f"{T} the page login is labelled as PingOne pi.flow, Real", "pi.flow" in page.inner_text('[data-testid="page-login"]') if page.is_visible('[data-testid="page-login"]') else True)
    shot(page, "real-signed-in", vp, theme)
    page.click('[data-testid="sign-out"]')
    page.wait_for_function("!document.querySelector('[data-testid=who]')")
    # the toggle works in both directions and reloads the data
    page.select_option('[data-testid="mode-select"]', "mock")
    page.wait_for_function("document.querySelector('[data-testid=mode-status]')?.dataset.source === 'mock'")
    check(f"{T} back to Mock: the source line says Mock and the story that was blocked now runs", "Source: Mock" in text(page, '[data-testid="mode-source"]') and not page.is_disabled('[data-testid="story-run"]') if page.query_selector('[data-testid="story-run"]') else "Source: Mock" in text(page, '[data-testid="mode-source"]'))
    page.select_option('[data-testid="mode-select"]', "real")
    page.wait_for_function("document.querySelector('[data-testid=mode-status]')?.dataset.source === 'real'")
    check(f"{T} and to Real again", "Source: Real" in text(page, '[data-testid="mode-source"]'))
    check(f"{T} no sideways scroll, no hostile popups, no console errors", no_sideways(page) and clean(page), str(page.msgs))
    ctx.close()
    if NOLOGIN:
        ctx, page = new_page(browser, w, h, theme, base=NOLOGIN)
        if not page.is_visible('[data-testid="rail-sign-in"]'):
            page.click('[data-testid="rail-toggle"]')
        tip = page.get_attribute('[data-testid="rail-sign-in"]', "title") or ""
        check(f"{T} Real without a page login configured: Sign in is disabled with the how-to (PGC_PINGONE_*, pi.flow, no redirect)", page.is_disabled('[data-testid="rail-sign-in"]') and "PGC_PINGONE_*" in tip and "pi.flow" in tip, tip[:160])
        check(f"{T} and there is no header Sign in", page.query_selector('[data-testid="sign-in"]') is None)
        shot(page, "real-login-not-configured", vp, theme)
        ctx.close()


def presenter_checks(browser, theme):
    T = f"[presenter 1440 {theme}]"
    ctx, page = new_page(browser, 1440, 900, theme, url="?story=S01")
    wait_word(page, "Allowed")
    fs_before = page.evaluate("parseFloat(getComputedStyle(document.documentElement).fontSize)")
    page.click('[data-testid="presenter"]')
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_selector('[data-testid="panel-reel"]', timeout=6000)
    page.wait_for_timeout(400)
    fs_after = page.evaluate("parseFloat(getComputedStyle(document.documentElement).fontSize)")
    check(f"{T} larger type in presenter mode ({fs_before} -> {fs_after})", fs_after > fs_before * 1.1)
    check(f"{T} the mode status is first in main, there is no old banner and no modal in presenter mode", page.evaluate("document.querySelector('main').firstElementChild.dataset.testid") == "mode-status" and page.query_selector('[data-testid="sim-banner"]') is None and page.query_selector('[data-testid="mode-modal"]') is None)
    # arrangement as the page leaves it: the talk track and the reel side by side, the verdict covered by neither
    page.wait_for_timeout(200)
    talk, reel, card = rect(page, '[data-testid="talk-track-dialog"]'), rect(page, '[data-testid="panel-reel"]'), rect(page, '[data-testid="verdict-card"]')
    check(f"{T} the talk track and the Movie reel do not overlap each other", overlap(talk, reel) == 0, f"{talk} {reel}")
    check(f"{T} the panels do not cover the verdict card", overlap(card, reel) == 0 and overlap(card, talk) == 0, f"{card} {reel} {talk}")
    shot(page, "presenter", "1440", theme)
    page.evaluate("window.scrollBy(0, 500)")
    page.wait_for_timeout(150)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(100)
    hdr = rect(page, ".shell-bar")
    talk = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} the talk track opened under the header, not over its controls (the page is scrolled to the top)", talk["y"] >= hdr["b"] - 2, f"talk={talk} header={hdr}")
    check(f"{T} the page keeps clear of the talk track (no sideways scroll)", no_sideways(page))
    check(f"{T} the dock and the page's controls are reachable: the verdict's Run it again / Choose a tool button is visible", page.is_visible('[data-testid^="action-"]'))
    # the page is usable while the talk track is open: it is non-modal
    check(f"{T} the talk track is non-modal: no backdrop, no aria-modal", page.query_selector(".fd-backdrop") is None and page.get_attribute('[data-testid="talk-track-dialog"]', "aria-modal") is None)
    page.click('[data-testid="story-select"]')  # (focus only) the page answers while the script is open
    page.keyboard.press("Escape")
    # the talk track in presenter mode is not red
    check(f"{T} nothing in the talk track is red", page.evaluate(RED_SCAN, '[data-testid="talk-track-dialog"]') == [], str(page.evaluate(RED_SCAN, '[data-testid="talk-track-dialog"]'))[:200])
    # P and Esc
    page.click("body", position={"x": 5, "y": 400})
    page.keyboard.press("Escape")
    check(f"{T} Esc leaves presenter mode", page.evaluate("document.documentElement.dataset.presenter") == "0")
    page.keyboard.press("p")
    check(f"{T} P turns it on again", page.evaluate("document.documentElement.dataset.presenter") == "1")
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()
    # the lab's own flag
    ctx, page = new_page(browser, 1440, 900, theme, url="?presenter=1")
    check(f"{T} ?presenter=1 starts in presenter mode with the talk track open", page.evaluate("document.documentElement.dataset.presenter") == "1" and page.query_selector('[data-testid="talk-track-dialog"]') is not None)
    ctx.close()


def presenter_narrow(browser, theme):
    T = f"[presenter 375 {theme}]"
    ctx, page = new_page(browser, 375, 812, theme, url="?story=S01&presenter=1")
    wait_word(page, "Allowed")
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_timeout(300)
    check(f"{T} a phone gets the talk track as a bottom sheet, no sideways scroll", rect(page, '[data-testid="talk-track-dialog"]')["w"] <= 375 and no_sideways(page) and page.query_selector('[data-testid="panel-reel"]') is None)
    check(f"{T} the source line is still on the page and there is no modal", page.query_selector('[data-testid="mode-source"]') is not None and page.query_selector('[data-testid="mode-modal"]') is None)
    shot(page, "presenter", "375", theme)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def talk_checks(browser, theme):
    T = f"[talk track {theme}]"
    ctx, page = new_page(browser, 1440, 900, theme)
    page.click('[data-testid="talk-track-toggle"]')
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_timeout(200)
    items = page.eval_on_selector_all('[data-testid="talk-track"] > li', "l => l.length")
    check(f"{T} the server's sections are shown ({items}) with the vertical's words", items >= 10 and "Northwind Retail" in page.inner_text('[data-testid="talk-track"]'))
    check(f"{T} paragraphs are kept apart (pre-line)", page.evaluate("getComputedStyle(document.querySelector('[data-testid=talk-track] p')).whiteSpace") == "pre-line")
    hdr = rect(page, ".shell-bar")
    d = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} it opens under the header, not over Mode, Reset and Sign in", d["y"] >= hdr["b"] - 2, f"{d} {hdr}")
    check(f"{T} no red inside the talk track (the top edge is ink)", page.evaluate(RED_SCAN, '[data-testid="talk-track-dialog"]') == [], str(page.evaluate(RED_SCAN, '[data-testid="talk-track-dialog"]'))[:200])
    # the page answers while it is open
    page.click('[data-testid="action-discover"]')
    wait_word(page, "Allowed")
    check(f"{T} the page is usable while the talk track is open (a run was made)", word(page) == "Allowed")
    # drag by the title bar with a real mouse
    tb = rect(page, '[data-testid="talk-track-dialog"] .fd-titlebar')
    page.mouse.move(tb["x"] + 60, tb["y"] + tb["h"] / 2)
    page.mouse.down()
    page.mouse.move(tb["x"] - 200, tb["y"] + 120, steps=8)
    page.mouse.up()
    d2 = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} drag by the title moves it", abs(d2["x"] - d["x"]) > 100 and abs(d2["y"] - d["y"]) > 60, f"{d} -> {d2}")
    # resize from the south-east corner
    page.mouse.move(d2["r"] - 2, d2["b"] - 2)
    page.mouse.down()
    page.mouse.move(d2["r"] + 60, d2["b"] + 40, steps=6)
    page.mouse.up()
    d3 = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} it resizes from a corner", d3["w"] > d2["w"] + 20 or d3["h"] > d2["h"] + 20, f"{d2} -> {d3}")
    shot(page, "talk-track", "1440", theme)
    # pop out: a real window that stays live
    with page.expect_popup() as pop:
        page.click('[data-testid="talk-track-dialog"] button[aria-label="Pop out to a new window"]')
    pw = pop.value
    pw.wait_for_selector('[data-testid="talk-track"]')
    check(f"{T} pop-out: the script is in its own window, the opener keeps a placeholder", pw.evaluate("window.opener !== null") and page.query_selector('[data-testid="fd-placeholder"]') is not None and pw.eval_on_selector_all('[data-testid="talk-track"] > li', "l => l.length") == items)
    check(f"{T} pop-out: the popup has the page's styles (laid out, not red)", pw.evaluate("document.querySelector('[data-testid=talk-track]').getBoundingClientRect().width") > 200 and pw.evaluate(RED_SCAN, ".fd-popout-layout") == [], str(pw.evaluate(RED_SCAN, ".fd-popout-layout"))[:200])
    pw.screenshot(path=os.path.join(SHOTS, f"2c-talk-track-popout-1440-{theme}.png"))
    # the vertical changes the words in the popup too (it stays live)
    page.select_option('[data-testid="vertical-select"]', "finance")
    pw.wait_for_function("document.querySelector('[data-testid=talk-track]')?.innerText.includes('Fabrikam Bank')", timeout=6000)
    check(f"{T} pop-out stays live: switching the vertical rewrites the script in the popup", True)
    try:
        pw.keyboard.press("Escape")
    except Exception:
        pass  # the window closes itself while the key is still being delivered
    page.wait_for_function("!document.querySelector('[data-testid=fd-placeholder]')", timeout=8000)
    check(f"{T} Escape in the popup closes it and the dialog is hidden in the page", pw.is_closed() and page.query_selector('[data-testid="talk-track-dialog"]') is None)
    page.click('[data-testid="dock-talk"]')
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    d4 = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} reopened from the dock, it keeps its place and size", abs(d4["x"] - d3["x"]) < 3 and abs(d4["w"] - d3["w"]) < 3, f"{d3} -> {d4}")
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def talk_narrow(browser, theme):
    T = f"[talk track 375 {theme}]"
    ctx, page = new_page(browser, 375, 812, theme)
    page.click('[data-testid="dock-talk"]')
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_timeout(200)
    d = rect(page, '[data-testid="talk-track-dialog"]')
    check(f"{T} a full-width bottom sheet with no sideways scroll", d["w"] <= 375 and d["x"] >= 0 and no_sideways(page), str(d))
    shot(page, "talk-track", "375", theme)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def reset_checks(browser, theme):
    T = f"[reset {theme}]"
    ctx, page = new_page(browser, 1440, 900, theme, url="?story=S01")
    wait_word(page, "Allowed")
    page.click('[data-testid="presenter"]')
    page.wait_for_selector('[data-testid="talk-track-dialog"]')
    page.wait_for_selector('[data-testid="panel-reel"]', timeout=6000)
    page.click('[data-testid="panel-reel"] [data-testid="step-next"]')
    # move the reel so a place is saved
    tb = rect(page, '[data-testid="panel-reel"] .fd-titlebar')
    page.mouse.move(tb["x"] + 80, tb["y"] + tb["h"] / 2)
    page.mouse.down()
    page.mouse.move(tb["x"] + 20, tb["y"] - 10, steps=5)
    page.mouse.up()
    page.wait_for_timeout(200)
    saved = page.evaluate("Object.keys(localStorage).filter((k) => k.startsWith('pgc.panel.'))")
    check(f"{T} before Reset: a story, a walk position, panels and saved places exist", "story=S01" in page.url and "Message 1" in text(page, '[data-testid="dock-counter"]') and len(saved) >= 1, str(saved))
    shot(page, "before-reset", "1440", theme)
    page.click('[data-testid="reset"]')
    wait_word(page, "Ready")
    page.wait_for_timeout(500)
    check(f"{T} after Reset: no story, no story in the address, no panel, no talk track", page.query_selector('[data-testid="story-card"]') is None and "story=" not in page.url and page.query_selector('[data-testid="panel-reel"]') is None and page.query_selector('[data-testid="talk-track-dialog"]') is None)
    check(f"{T} after Reset: the walk is back to the start and the saved places are gone", "No run yet" in text(page, '[data-testid="dock-counter"]') and page.evaluate("Object.keys(localStorage).filter((k) => k.startsWith('pgc.panel.')).length") == 0)
    check(f"{T} after Reset: presenter mode is back to how the lab started (off) and the mode is unchanged", page.evaluate("document.documentElement.dataset.presenter") == "0" and page.input_value('[data-testid="mode-select"]') == "mock")
    page.click('[data-testid="dock-reel"]')
    page.wait_for_selector('[data-testid="panel-reel"]')
    r1 = rect(page, '[data-testid="panel-reel"]')
    check(f"{T} after Reset a panel opens in its default place (not where it was moved)", r1 is not None and r1["x"] > 0)
    shot(page, "after-reset", "1440", theme)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def brand_checks(browser, w, h, vp, theme):
    if not BRAND:
        return
    T = f"[branding {vp} {theme}]"
    ctx, page = new_page(browser, w, h, theme, base=BRAND)
    name = (text(page, '[data-testid="brand-name"]') or "").strip()
    check(f"{T} customer.config name is the brand and the page title", name and name != "Privilege Gateway Client Lab" and page.title() == name, f"{name!r} / {page.title()!r}")
    tag_visible = page.is_visible('[data-testid="brand-tagline"]')
    check(f"{T} the tagline shows on a wide screen and folds away on a phone", tag_visible == (w > 600), str(tag_visible))
    check(f"{T} the vertical it names is the one selected, and its cast words are in the stories", page.input_value('[data-testid="vertical-select"]') == "health")
    page.select_option('[data-testid="story-select"]', "S01")
    check(f"{T} the customer's brand word is in the story", "Contoso" in text(page, '[data-testid="story-card"]'), (text(page, '[data-testid="story-card"]') or "")[:150])
    check(f"{T} a long brand name wraps: no sideways scroll", no_sideways(page))
    shot(page, "branding", vp, theme)
    check(f"{T} no hostile popups and no console errors", clean(page), str(page.msgs))
    ctx.close()


def workspace_checks(browser, theme="light"):
    T = "[workspace]"
    ctx, page = new_page(browser, 1440, 900, theme, url="?workspace=team-e2e")
    chip = text(page, '[data-testid="workspace-chip"]') or ""
    check(f"{T} a non-default workspace is shown in the header", "team-e2e" in chip, chip)
    page.click('[data-testid="action-discover"]')
    wait_word(page, "Allowed")
    runs_here = page.evaluate("fetch('/api/runs', {headers: {'X-Workspace': 'team-e2e'}}).then(r => r.json()).then(j => j.runs.length)")
    runs_default = page.evaluate("fetch('/api/runs').then(r => r.json()).then(j => j.runs.length)")
    check(f"{T} the run is kept under the workspace, not under default", runs_here >= 1 and runs_default == 0, f"{runs_here} {runs_default}")
    page.click('[data-testid="reset"]')
    wait_word(page, "Ready")
    after = page.evaluate("fetch('/api/runs', {headers: {'X-Workspace': 'team-e2e'}}).then(r => r.json()).then(j => j.runs.length)")
    check(f"{T} Reset cleared this workspace", after == 0, str(after))
    shot(page, "workspace", "1440", theme)
    ctx.close()
    ctx, page = new_page(browser, 1440, 900, theme)
    check(f"{T} the default workspace shows no chip", page.query_selector('[data-testid="workspace-chip"]') is None)
    ctx.close()
    ctx, page = new_page(browser, 1440, 900, theme, url="?workspace=Not%20Valid")
    note = text(page, '[data-testid="story-urlnote"]') or ""
    check(f"{T} a malformed workspace id is never silently the default: the page says so", "not valid" in note, note[:100])
    ctx.close()


def hostile_checks(browser):
    T = "[hostile address]"
    ctx, page = new_page(browser, 1440, 900, "light", url="?story=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&workspace=%3Cscript%3Ealert(1)%3C%2Fscript%3E&presenter=%3Cb%3E")
    page.wait_for_timeout(500)
    check(f"{T} a hostile story, workspace and presenter value render as plain notes: no element, no popup", page.query_selector("img[src='x']") is None and not page.dialogs and "onerror" not in page.content().replace("onerror=alert", "X"))
    check(f"{T} the lab still works", word(page) == "Ready" and clean(page), str(page.msgs))
    ctx.close()


def contrast_checks(browser):
    T = "[dark contrast]"
    ctx, page = new_page(browser, 1440, 900, "dark", url="?story=S01")
    wait_word(page, "Allowed")
    for sel, name in (('[data-testid="story-select"]', "story picker"), ('[data-testid="story-close"]', "Close story button"), ('[data-testid="story-step-run-3"]', "step Run button"), ('[data-testid="dock-talk"]', "Talk track dock button"), ('[data-testid="presenter"]', "Present button")):
        c = page.evaluate(CONTRAST_BORDER, sel)
        check(f"{T} {name}: border 3:1 or more against its surface ({c and round(c, 1)})", c is not None and c >= 3.0)
    ctx.close()


def modal_checks(browser):
    """The Real-or-mock modal on a session that has not dismissed it: MOCK, no old banner, Got it closes it, a reload does not bring it back."""
    T = "[modal 1440]"
    ctx = browser.fresh_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_selector('[data-testid="mode-modal"]')
    check(f"{T} a fresh session opens on MOCK", page.get_attribute('[data-testid="mode-modal"]', "data-mode") == "mock" and "MOCK" in text(page, '[data-testid="mode-modal"]'))
    check(f"{T} there is no old simulation banner", page.query_selector('[data-testid="sim-banner"]') is None)
    shot(page, "modal", "1440", "light")
    page.click('[data-testid="mode-modal-ok"]')
    check(f"{T} Got it closes it", page.query_selector('[data-testid="mode-modal"]') is None)
    page.reload()
    page.wait_for_selector('[data-testid="verdict-card"]')
    check(f"{T} a reload in the same session does not show it again", page.query_selector('[data-testid="mode-modal"]') is None)
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Real-or-mock modal (shared mode-modal): every context starts with it dismissed, so it never covers a click.
        _new_context = browser.new_context
        browser.fresh_context = _new_context  # the modal check below opens a session that has not dismissed it
        def _dismissed_context(*a, **k):
            c = _new_context(*a, **k)
            c.add_init_script("try{sessionStorage.setItem('pgc-mode-seen-mock','1');sessionStorage.setItem('pgc-mode-seen-real','1')}catch(e){}")
            return c
        browser.new_context = _dismissed_context
        modal_checks(browser)
        for theme in ("light", "dark"):
            for (w, h, vp) in ((1440, 900, "1440"), (375, 812, "375")):
                story_checks(browser, w, h, vp, theme)
                picker_checks(browser, w, h, vp, theme)
                vertical_checks(browser, w, h, vp, theme)
                personas_checks(browser, w, h, vp, theme)
                mode_checks(browser, w, h, vp, theme)
                real_checks(browser, w, h, vp, theme)
                brand_checks(browser, w, h, vp, theme)
            presenter_checks(browser, theme)
            presenter_narrow(browser, theme)
            talk_checks(browser, theme)
            talk_narrow(browser, theme)
            reset_checks(browser, theme)
        guard_checks(browser)
        admin_checks(browser)
        workspace_checks(browser)
        hostile_checks(browser)
        contrast_checks(browser)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
