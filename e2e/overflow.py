#!/usr/bin/env python3
"""Fix pass N1 and N2: hostile long text must wrap, never widen the page, and nothing may be cut without saying so.

Real Chromium at 1440x900 and 375x812, light and dark. Against a Mock lab (never a real gateway):

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7971 npm start
    BASE=http://127.0.0.1:7971/ SHOTS=/some/dir python3 e2e/overflow.py

N1: a 300-character unbroken tool filter (the "No tools match" echo) and a 600-character unbroken identity name and email (the tool-count line, the
rail badge and name, the verdict facts, the Evidence identity table) must leave scrollWidth equal to the viewport width.
N2: the long upstream message is shown whole inside the lab's size cap, or the cut is marked ("shortened").
"""
import json
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:7971/")
SHOTS = os.environ.get("SHOTS") or os.path.join(tempfile.gettempdir(), "pgc-shots")
os.makedirs(SHOTS, exist_ok=True)
N = 0
FAILS = []
LONG = "W" * 600
LONG_MAIL = "w" * 590 + "@example.com"


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def widen(route):
    """Answer the real request, then make the identity hostile (a 600-character unbroken name and email)."""
    resp = route.fetch()
    body = resp.text()
    body = body.replace("aidemo@example.com", LONG_MAIL).replace('"aidemo"', json.dumps(LONG))
    route.fulfill(response=resp, body=body)


def new_page(browser, w, h, theme, hostile_identity=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    page = ctx.new_page()
    if hostile_identity:
        page.route("**/api/**", widen)
    page.goto(BASE)
    page.wait_for_selector('[data-testid="get-tools"]')
    return ctx, page


def overflow(page):
    return page.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })")


def no_overflow(page, name, w):
    o = overflow(page)
    check(f"{name}: no horizontal overflow ({o})", o["sw"] <= o["cw"] + 1 and o["bw"] <= o["cw"] + 1, str(o))


def run(browser, w, h, theme):
    vp = f"{w}"
    # N1a: the tool filter
    ctx, page = new_page(browser, w, h, theme)
    page.click('[data-testid="get-tools"]')
    page.wait_for_selector('[data-testid="tool-grid"]')
    page.fill('[data-testid="tool-filter"]', "x" * 300)
    page.wait_for_selector('[data-testid="tools-nomatch"]')
    no_overflow(page, f"[filter 300 chars {vp} {theme}]", w)
    page.evaluate("document.querySelector('[data-testid=tool-filter]').scrollIntoView({block:'start'}); window.scrollBy(0, -12)")
    page.screenshot(path=os.path.join(SHOTS, f"fix-overflow-filter-{vp}-{theme}.png"))
    ctx.close()
    # N1b: a hostile identity everywhere it is shown
    ctx, page = new_page(browser, w, h, theme, hostile_identity=True)
    no_overflow(page, f"[identity 600 chars, ready {vp} {theme}]", w)
    page.click('[data-testid="get-tools"]')
    page.wait_for_selector('[data-testid="tool-grid"]')
    no_overflow(page, f"[identity 600 chars, tool count line {vp} {theme}]", w)
    page.screenshot(path=os.path.join(SHOTS, f"fix-overflow-identity-tools-{vp}-{theme}.png"))
    if not page.is_visible('[data-testid="door-picker"]'):
        page.click('[data-testid="rail-toggle"]')
    no_overflow(page, f"[identity 600 chars, rail open {vp} {theme}]", w)
    page.screenshot(path=os.path.join(SHOTS, f"fix-overflow-identity-rail-{vp}-{theme}.png"))
    page.click('[data-testid="tool-list_entitlements"]')
    page.wait_for_selector('[data-testid="run"]')
    page.click('[data-testid="run"]')
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")
    no_overflow(page, f"[identity 600 chars, args response {vp} {theme}]", w)
    page.click('[data-testid="tab-evidence"]')
    page.wait_for_selector('[data-testid="identity-table"]')
    no_overflow(page, f"[identity 600 chars, evidence {vp} {theme}]", w)
    page.evaluate("document.querySelector('[data-testid=identity-table]').scrollIntoView({block:'start'})")
    page.screenshot(path=os.path.join(SHOTS, f"fix-overflow-identity-evidence-{vp}-{theme}.png"))
    ctx.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for (w, h) in ((1440, 900), (375, 812)):
            for theme in ("light", "dark"):
                run(browser, w, h, theme)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f[:300])
    sys.exit(1 if FAILS else 0)
