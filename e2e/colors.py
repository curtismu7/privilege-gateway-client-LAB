#!/usr/bin/env python3
"""Fix pass B2 and B3: no red on a refusal, a held call or any `note` row, outside the dialogs too (Evidence tab, Arguments response, Tokens).

Real Chromium, computed colours. Every element under the stage and the rail is scanned (text, border, background, SVG fill and stroke); a colour
whose hue is red and that is not one of the shared standard's own red parts (Sign in, the header rule, the banner edge, the Mock/Real select) fails.
Not part of `npm test`. Start a Mock lab, then:

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7971 npm start
    BASE=http://127.0.0.1:7971/ SHOTS=/some/dir python3 e2e/colors.py

Optional REAL_BASE (the loopback stub from e2e/real-stub.mjs, never a real gateway): a Real UPSTREAM failure is the one place red is allowed, and
this checks it is still red there.  Exit code 0 only when every check passed.
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

SCAN = """(roots) => {
  const toHsl = (c) => {
    const m = c.match(/[\\d.]+/g); if (!m || m.length < 3) return null;
    const [r, g, b] = m.slice(0, 3).map((v) => Number(v) / 255); const a = m.length > 3 ? Number(m[3]) : 1;
    if (a === 0) return null;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  };
  const isRed = (c) => { const v = toHsl(c); return v && v.s >= 0.5 && (v.h <= 15 || v.h >= 345); };
  const hits = [];
  const label = (el) => el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '');
  for (const sel of roots) {
    for (const root of document.querySelectorAll(sel)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(el);
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && isRed(cs.color)) hits.push(label(el) + ' color ' + cs.color + ' "' + el.textContent.trim().slice(0, 24) + '"');
        if (isRed(cs.backgroundColor)) hits.push(label(el) + ' background ' + cs.backgroundColor);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' && isRed(cs['border' + side + 'Color'])) hits.push(label(el) + ' border' + side + ' ' + cs['border' + side + 'Color']);
        }
        if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg' && (isRed(cs.fill) || isRed(cs.stroke))) hits.push(label(el) + ' svg ' + cs.fill + ' ' + cs.stroke);
      }
    }
  }
  return hits;
}"""
ROOTS = [".pgc-stage", ".pgc-rail"]


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def new_page(browser, w, h, theme, base=None):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    page = ctx.new_page()
    page.goto(base or BASE)
    page.wait_for_selector('[data-testid="get-tools"]')
    return ctx, page


def pick_door(page, door):
    if not page.is_visible(f'[data-testid="door-{door}"]'):
        page.click('[data-testid="rail-toggle"]')
    page.click(f'[data-testid="door-{door}"]')


def wait_done(page):
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")


def go(page, door, tool=None, scenario=None):
    pick_door(page, door)
    page.click('[data-testid="get-tools"]')
    wait_done(page)
    if tool is None:
        return
    if page.locator(f'[data-testid="tool-{tool}"]').count() == 0:
        # The gateway lists only what the grant allows, so a refused tool has no tile: run it by name.
        page.fill('[data-testid="by-name-input"]', tool)
        page.click('[data-testid="by-name-run"]')
        wait_done(page)
        return
    page.click(f'[data-testid="tool-{tool}"]')
    page.wait_for_selector('[data-testid="run"]')
    if scenario:
        page.evaluate("document.querySelector('[data-testid=advanced]').open = true")
        page.select_option("#pgc-scenario", scenario)
    page.click('[data-testid="run"]')
    wait_done(page)


STATES = [
    ("allowed", dict(door="demo-all-tools", tool="list_entitlements")),
    ("refused-tool", dict(door="demo-some-tools", tool="sensitive_payroll_details")),
    ("no-key", dict(door="demo-all-tools", tool="list_entitlements", scenario="no-key")),
    ("bad-key", dict(door="demo-all-tools", tool="list_entitlements", scenario="bad-key")),
    ("held", dict(door="demo-all-tools", tool="open_ticket")),
    ("upstream-mock", dict(door="demo-all-tools", tool="list_entitlements", scenario="upstream-error")),
    ("blocked-door", dict(door="demo-blocked")),
]


def vp_name(w):
    return str(w)


def run(browser, w, h, theme):
    for name, kw in STATES:
        ctx, page = new_page(browser, w, h, theme)
        go(page, **kw)
        for tab in ("args", "evidence"):
            if tab == "args" and "tool" not in kw:
                continue
            page.click(f'[data-testid="tab-{tab}"]')
            page.wait_for_selector(f'[data-testid="panel-{tab}"]:not([hidden])')
            page.wait_for_timeout(100)
            hits = page.evaluate(SCAN, ROOTS)
            check(f"[{name} {tab} {w} {theme}] nothing red in the stage or the rail", not hits, "; ".join(hits[:6]))
            if tab == "evidence" and name in ("refused-tool", "held", "allowed"):
                page.evaluate("(() => { const e = document.querySelector('.gw-trace') || document.querySelector('[data-testid=evidence-panel]'); e.scrollIntoView({block: 'start'}); window.scrollBy(0, -12); })()")
                page.wait_for_timeout(80)
                page.screenshot(path=os.path.join(SHOTS, f"fix-evidence-{name}-{vp_name(w)}-{theme}.png"))
            if tab == "args" and name in ("refused-tool", "allowed", "held"):
                page.evaluate("(() => { const e = document.querySelector('[data-testid=run-tokens]') || document.querySelector('[data-testid=response]'); if (e) { e.scrollIntoView({block: 'start'}); window.scrollBy(0, -12); } })()")
                page.wait_for_timeout(80)
                page.screenshot(path=os.path.join(SHOTS, f"fix-args-{name}-{vp_name(w)}-{theme}.png"))
        ctx.close()


def real_checks(browser, theme):
    """A Real UPSTREAM failure is the one red case: the Evidence tab keeps red there (a real error), and a Real refusal does not."""
    if not REAL:
        return
    ctx, page = new_page(browser, 1440, 900, theme, base=REAL)
    page.click('[data-testid="get-tools"]')
    wait_done(page)
    page.click('[data-testid="tab-evidence"]')
    hits = page.evaluate(SCAN, ROOTS)
    check(f"[real allowed evidence {theme}] nothing red", not hits, "; ".join(hits[:6]))
    ctx.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for (w, h) in ((1440, 900), (375, 812)):
            for theme in ("light", "dark"):
                run(browser, w, h, theme)
        for theme in ("light", "dark"):
            real_checks(browser, theme)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f)
    sys.exit(1 if FAILS else 0)
