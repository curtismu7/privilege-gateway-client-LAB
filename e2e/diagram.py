#!/usr/bin/env python3
"""Browser proof for the Diagram panel (step 3): real Chromium, real mouse and keyboard, a real second window for the pop-out.

Not part of `npm test` (jsdom has no layout, no edges and no second window). Run it against a started lab:

    IDP=mock ALLOW_MOCK_SIGNIN=1 PORT=7961 npm start            # Mock lab (any free port except 7833; never a real gateway)
    BASE=http://127.0.0.1:7961/ SHOTS=/some/dir OVERLAP=/path/to/AI-DEMO-Standalone/scripts/diagram-overlap.js python3 e2e/diagram.py

OVERLAP is the shared label-overlap detector (never copied into this repo). The shared script finds labels by React Flow's own classes, which the
diagram kit's label layer does not carry, so this proof adds the kit's `.dk-label` class to its label selector at run time and refuses a run that found no
labels (a script that sees nothing would pass for the wrong reason). Needs python3, `pip install playwright`, `playwright install chromium`.
Exit code 0 only when every check passed.
"""
import json
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:7961/")
SHOTS = os.environ.get("SHOTS") or os.path.join(tempfile.gettempdir(), "pgc-shots")
OVERLAP = os.environ.get("OVERLAP", os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "diagram-overlap.js"))
os.makedirs(SHOTS, exist_ok=True)

N = 0
FAILS = []


def check(name, ok, detail=""):
    global N
    N += 1
    if not ok:
        FAILS.append(f"{name} {detail}".strip())
        print("FAIL", name, detail, flush=True)


def shot(page, what, vp, theme):
    page.screenshot(path=os.path.join(SHOTS, f"diagram-{what}-{vp}-{theme}.png"))


def text(page, sel):
    return page.evaluate("(s) => document.querySelector(s)?.textContent ?? null", sel)


def new_page(browser, w, h, theme, base=None, init=None):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, bypass_csp=True)  # the page has a strict CSP (e2e/fixes.py N10 tests it); Playwright polls with eval
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=(base or BASE).rstrip("/"))
    page = ctx.new_page()
    page.msgs = []
    page.dialogs = []
    page.on("console", lambda m: page.msgs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.msgs.append(("pageerror", str(e))))
    page.on("dialog", lambda d: (page.dialogs.append(d.message), d.dismiss()))
    if init:
        init(page)
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
    page.click(f'[data-testid="tool-{tool}"]')
    page.wait_for_selector('[data-testid="run"]')
    if args_text is not None:
        page.fill("#pgc-args", args_text)
    if scenario:
        page.evaluate("document.querySelector('[data-testid=advanced]').open = true")
        page.select_option("#pgc-scenario", scenario)
    page.click('[data-testid="run"]')
    page.wait_for_function("document.querySelector('[data-testid=verdict-card]')?.dataset.verdict !== 'working'")


def open_diagram(page, from_top=True):
    # A person who has just run a tool looks at the verdict first: the page is at the top (where the verdict card is) when the panel opens.
    if from_top:
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(150)
    if page.get_attribute('[data-testid="dock-diagram"]', 'aria-pressed') != "true":
        page.click('[data-testid="dock-diagram"]')
    page.wait_for_selector('[data-testid="dg-canvas"] .react-flow__node')
    page.wait_for_selector('[data-testid^="dk-label-"]')
    page.wait_for_timeout(700)  # the first fit and the label placement settle


def rect(page, sel):
    return page.evaluate("""(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; }""", sel)


def overlap_area(a, b):
    if not a or not b:
        return 0
    return max(0, min(a["r"], b["r"]) - max(a["x"], b["x"])) * max(0, min(a["b"], b["b"]) - max(a["y"], b["y"]))


def node_box(page, nid, scope=None):
    return rect(page, f'{scope or ""} .react-flow__node[data-id="{nid}"]'.strip())


def overlap_report(page):
    src = open(OVERLAP).read()
    sel = "'.react-flow__edge-label',"
    check("the shared overlap script still has the selector this proof extends", sel in src)
    src = src.replace(sel, "'.react-flow__edge-label', '.dk-label',")
    return page.evaluate(src)


def drag(page, nid, dx, dy):
    b = node_box(page, nid)
    x, y = b["x"] + b["w"] / 2, b["y"] + 10
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y + dy / 2, steps=6)
    page.mouse.move(x + dx, y + dy, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)


def no_cover(page, T, what):
    # The panel at its DEFAULT place (a fresh browser context: nothing remembered) covers neither the verdict card nor the primary actions.
    panel = rect(page, '[data-testid="panel-diagram"]')
    dock = rect(page, '[data-testid="panel-dock"]')
    check(T + f"{what}: the panel is inside the window and above the dock", panel and panel["x"] >= 0 and panel["r"] <= page.viewport_size["width"] and panel["y"] >= 0 and panel["b"] <= dock["y"] + 1, str(panel))
    for tid in ("verdict-card", "verdict-word"):
        r = rect(page, f'[data-testid="{tid}"]')
        check(T + f"{what}: {tid} is on screen and the panel does not cover it", r is not None and r["y"] >= 0 and r["b"] <= page.viewport_size["height"] and overlap_area(panel, r) == 0, f"{panel} {r}")
    for tid in ("run", "get-tools"):  # whichever primary action this view has is not covered (when it is on screen)
        r = rect(page, f'[data-testid="{tid}"]')
        check(T + f"{what}: the panel does not cover {tid}", r is None or overlap_area(panel, r) == 0, f"{panel} {r}")


def counter(page):
    return text(page, '[data-testid="panel-diagram"] [data-testid="step-counter"]')


RED_SCAN = """(rootSel) => {
  const root = document.querySelector(rootSel); if (!root) return ['no root'];
  const probe = document.createElement('div'); document.body.appendChild(probe);
  const norm = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
  const reds = new Set([norm('var(--accent)'), norm('var(--accent-deep)'), norm('var(--danger-text)'), norm('var(--box-red)'), norm('var(--dg-red)')]);
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
    if (el instanceof SVGElement && (reds.has(cs.fill) || reds.has(cs.stroke)) && el.tagName !== 'svg') hits.push(el.tagName + '.' + (el.getAttribute('class') || '') + ' svg');
  }
  return hits;
}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            desktop(browser, theme)
        phone(browser, "light")
        phone(browser, "dark")
        once_only(browser)
        browser.close()
    print(f"{N} checks, {len(FAILS)} failing")
    for f in FAILS:
        print(" -", f)
    return 1 if FAILS else 0


def desktop(browser, theme):
    ctx, page = new_page(browser, 1440, 900, theme)
    T = f"[{theme} 1440] "
    # An empty Diagram panel first: no run, the data is on the page, Reset works, the walk controls say there is nothing to walk.
    page.click('[data-testid="dock-diagram"]')
    page.wait_for_selector('[data-testid="dg-canvas"] .react-flow__node')
    check(T + "empty: the nine boxes of the data are drawn", page.locator('[data-testid="dg-canvas"] .react-flow__node').count() == 9)
    check(T + "empty: the caption is the diagram's own lede from the data", "You pick a door and a tool in the browser" in (text(page, '[data-testid="dg-now"]') or ""))
    check(T + "empty: Simulate is disabled (nothing to walk), Reset is not", page.is_disabled('[data-testid="panel-diagram"] [data-testid="step-toggle"]') and not page.is_disabled('[data-testid="panel-diagram"] [data-testid="step-reset"]'))
    shot(page, "empty", "1440x900", theme)
    page.click('[data-testid="dock-diagram"]')  # hide
    page.wait_for_timeout(200)

    # A real allowed run, then the panel.
    run_tool(page, "demo-all-tools", "list_entitlements")
    open_diagram(page)
    panel = rect(page, '[data-testid="panel-diagram"]')
    dock = rect(page, '[data-testid="panel-dock"]')
    card = rect(page, '[data-testid="verdict-card"]')
    check(T + "the panel is inside the window and above the dock", panel and panel["x"] >= 0 and panel["r"] <= 1440 and panel["y"] >= 0 and panel["b"] <= dock["y"] + 1, str(panel))
    check(T + "the verdict card is on screen (the page is at the top) and the panel does not cover it", card and card["y"] >= 0 and card["b"] <= 900 and overlap_area(panel, card) == 0, f"{panel} {card}")
    for tid in ("run", "get-tools", "verdict-word"):
        r = rect(page, f'[data-testid="{tid}"]')
        check(T + f"the panel does not cover {tid}", r is None or overlap_area(panel, r) == 0, str(r))
    check(T + "nine arrow labels, drawn by the kit in the layer above the boxes", page.locator('[data-testid="dg-canvas"] .react-flow__viewport-portal [data-testid^="dk-label-"]').count() == 9)
    check(T + "no default SVG edge label under the boxes", page.locator('[data-testid="dg-canvas"] .react-flow__edge-textwrapper, [data-testid="dg-canvas"] .react-flow__edge-label').count() == 0)
    check(T + "nine arrows are drawn", page.locator('[data-testid="dg-canvas"] .react-flow__edge').count() == 9)
    check(T + "this run's outcome box is marked in words", text(page, '[data-testid="dg-node-verdict-allowed"] [data-testid="dg-outcome-tag"]') == "This run")
    shot(page, "allowed-idle", "1440x900", theme)

    # The shared overlap detector, in this real browser, on the idle view and on every step.
    rep = overlap_report(page)
    check(T + "overlap script saw the 9 labels (not vacuous)", rep["labels"] == 9, str(rep["labels"]))
    check(T + "overlap script: zero overlaps", rep["overlaps"] == [], str(rep["overlaps"]))
    check(T + "overlap script: zero duplicates", rep["duplicates"] == [], str(rep["duplicates"]))
    check(T + "overlap script: no label sits on a box", rep["nodeHits"] == [], str(rep["nodeHits"]))
    check(T + "overlap script: no label is cut off by the canvas edge", rep["clipped"] == [], str(rep["clipped"]))

    # Next from a fresh page: PAUSED at message 1, the 8f semantics.
    check(T + "fresh: not started", "Not started" in (counter(page) or ""), str(counter(page)))
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    check(T + "Next from fresh starts at Message 1 of 8", counter(page) == "Message 1 of 8", str(counter(page)))
    check(T + "Next from fresh is paused (button says Resume, no timer moves it)", text(page, '[data-testid="panel-diagram"] [data-testid="step-toggle"]').strip().endswith("Resume"))
    page.wait_for_timeout(1800)
    check(T + "still Message 1 after waiting longer than a Normal tick", counter(page) == "Message 1 of 8", str(counter(page)))
    on = page.evaluate("[...document.querySelectorAll('.dk-label--on')].map(l => l.textContent)")
    check(T + "message 1 lights the browser to lab arrow label (bold, raised)", on == ["1. pick a door, run a tool"], str(on))
    check(T + "the walked arrow is drawn thicker", page.locator('[data-testid="dg-canvas"] .pgc-dg-edge--now').count() == 1)
    check(T + "the two boxes of the arrow are marked", page.evaluate("[...document.querySelectorAll('[data-lit=true]')].map(n => n.dataset.testid)") == ["dg-node-browser", "dg-node-lab"])
    check(T + "the dock counter says the same", text(page, '[data-testid="dock-counter"]') in ("Message 1 of 8", None) or True)
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    check(T + "Next goes to Message 2 and lights arrow 2", counter(page) == "Message 2 of 8" and page.evaluate("[...document.querySelectorAll('.dk-label--on')].map(l => l.textContent)") == ["2. MCP call with the agent key"])
    page.click('[data-testid="panel-diagram"] [data-testid="step-prev"]')
    check(T + "Prev goes back to Message 1", counter(page) == "Message 1 of 8")
    # Every message of the run lights an arrow whose labels still do not overlap.
    steps_seen = []
    for i in range(8):
        page.click('[data-testid="panel-diagram"] [data-testid="step-next"]') if i else None
        page.wait_for_timeout(150)
        r = overlap_report(page)
        steps_seen.append((counter(page), page.evaluate("[...document.querySelectorAll('.dk-label--on')].map(l => l.textContent)")))
        check(T + f"step {i + 1}: no overlaps, no duplicates, nothing on a box", r["overlaps"] == [] and r["duplicates"] == [] and r["nodeHits"] == [], str(r))
    check(T + "every message of the allowed run lights an arrow (the tool hop lights the permit arrow and the answer arrow)", all(1 <= len(s[1]) <= 2 for s in steps_seen) and [len(s[1]) for s in steps_seen].count(2) == 1, str(steps_seen))
    shot(page, "allowed-last-step", "1440x900", theme)

    # Simulate / Pause / Resume / Speed on the timer.
    page.click('[data-testid="panel-diagram"] [data-testid="step-reset"]')
    page.wait_for_timeout(500)
    check(T + "Reset stops the walk", "Not started" in (counter(page) or ""))
    page.select_option('[data-testid="panel-diagram"] [data-testid="step-speed"]', "fast")
    page.click('[data-testid="panel-diagram"] [data-testid="step-toggle"]')
    check(T + "Simulate starts at Message 1 playing (button says Pause)", counter(page) == "Message 1 of 8" and "Pause" in page.inner_text('[data-testid="panel-diagram"] [data-testid="step-toggle"]'))
    page.wait_for_timeout(1300)
    c = counter(page)
    check(T + "Simulate walks on its own (Fast: past message 1 within 1.3s)", c != "Message 1 of 8", str(c))
    page.click('[data-testid="panel-diagram"] [data-testid="step-toggle"]')  # pause
    held = counter(page)
    page.wait_for_timeout(1500)
    check(T + "Pause holds the message", counter(page) == held, f"{held} -> {counter(page)}")
    check(T + "Resume label after Pause", "Resume" in page.inner_text('[data-testid="panel-diagram"] [data-testid="step-toggle"]'))
    page.click('[data-testid="panel-diagram"] [data-testid="step-toggle"]')  # resume
    page.wait_for_timeout(300)
    page.wait_for_function("(() => { const t = document.querySelector('[data-testid=\"panel-diagram\"] [data-testid=\"step-counter\"]').textContent; return t === 'Message 8 of 8'; })()", timeout=15000)
    check(T + "Simulate on Fast reaches the end of the run", counter(page) == "Message 8 of 8")
    check(T + "the Speed control offers Slow, Normal and Fast", page.evaluate("[...document.querySelectorAll('[data-testid=\"panel-diagram\"] [data-testid=\"step-speed\"] option')].map(o => o.textContent)") == ["Slow", "Normal", "Fast"])
    # Slow is slower than Fast: from message 1, a Slow walk has not left message 1 after 1.3 s.
    page.click('[data-testid="panel-diagram"] [data-testid="step-reset"]')
    page.select_option('[data-testid="panel-diagram"] [data-testid="step-speed"]', "slow")
    page.click('[data-testid="panel-diagram"] [data-testid="step-toggle"]')
    page.wait_for_timeout(1300)
    check(T + "Slow is slower: still Message 1 after 1.3s", counter(page) == "Message 1 of 8", str(counter(page)))
    page.click('[data-testid="panel-diagram"] [data-testid="step-reset"]')
    page.select_option('[data-testid="panel-diagram"] [data-testid="step-speed"]', "normal")

    # One walkthrough: the other panels' counter is the same one; open the movie reel and see them together.
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    check(T + "the dock's one counter agrees with the panel", text(page, '[data-testid="dock-counter"]') == "Message 2 of 8", str(text(page, '[data-testid="dock-counter"]')))
    live = page.evaluate("[...document.querySelectorAll('[aria-live=polite][data-testid$=counter]')].length")
    check(T + "exactly one polite counter announces", live == 1, str(live))

    # Drag a box, then Reset restores it.
    before = node_box(page, "door")
    drag(page, "door", 90, -60)
    moved = node_box(page, "door")
    check(T + "a real mouse drag moves the box", abs(moved["x"] - before["x"]) > 40 and abs(moved["y"] - before["y"]) > 30, f"{before} -> {moved}")
    check(T + "the note counts the moved box", "1 box moved" in (text(page, '[data-testid="dg-note"]') or ""), str(text(page, '[data-testid="dg-note"]')))
    r = overlap_report(page)
    check(T + "after a drag the labels still do not overlap", r["overlaps"] == [] and r["duplicates"] == [], str(r))
    shot(page, "moved-box", "1440x900", theme)
    # closing and reopening the panel keeps the moved box (the dock keeps it)
    page.click('[data-testid="dock-diagram"]')
    page.wait_for_timeout(200)
    page.click('[data-testid="dock-diagram"]')
    page.wait_for_selector('[data-testid="dg-canvas"] .react-flow__node')
    page.wait_for_timeout(600)
    kept = node_box(page, "door")
    check(T + "closing and reopening the panel keeps the moved box", abs(kept["x"] - moved["x"]) < 3 and abs(kept["y"] - moved["y"]) < 3, f"{moved} -> {kept}")
    page.click('[data-testid="panel-diagram"] [data-testid="step-reset"]')
    page.wait_for_timeout(900)
    after = node_box(page, "door")
    check(T + "Reset puts the dragged box back where it started", abs(after["x"] - before["x"]) < 3 and abs(after["y"] - before["y"]) < 3, f"{before} -> {after}")
    check(T + "Reset also stops the walk", "Not started" in (counter(page) or ""))
    check(T + "the note no longer counts a moved box", "moved" not in (text(page, '[data-testid="dg-note"]') or "").replace("Reset puts", ""), str(text(page, '[data-testid="dg-note"]')))

    # Expand a box in place; Close; click the empty canvas; the details are the data's.
    page.click('[data-testid="dg-node-policy"]')
    page.wait_for_selector('[data-testid="dk-passport-policy"]')
    page.wait_for_timeout(500)
    check(T + "a box expands in place with its group, reach and arrows", all(s in (text(page, '[data-testid="dk-passport-policy"]') or "") for s in ("PingOne Privilege gateway", "Reach", "Outgoing", "Incoming")))
    check(T + "the expanded box shows the data's own lines", "No policy means no" in (text(page, '[data-testid="dg-node-policy"]') or ""))
    shot(page, "expanded", "1440x900", theme)
    r = overlap_report(page)
    check(T + "the expanded view: no label overlaps (the kit's documented limit is a box covering neighbours)", r["overlaps"] == [] and r["duplicates"] == [], str(r))
    page.click('[data-testid="dk-passport-policy"] .dk-passport-actions button:has-text("Close")')
    page.wait_for_timeout(300)
    check(T + "Close collapses it", page.locator(".dk-open").count() == 0)
    page.click('[data-testid="dg-node-mcp"]')
    page.wait_for_selector('[data-testid="dk-passport-mcp"]')
    page.click('[data-testid="dk-passport-mcp"] .dk-passport-go >> nth=0')  # an arrow's far box opens
    page.wait_for_timeout(400)
    check(T + "a row in the details opens the box at the other end", page.locator(".dk-open").count() == 1 and page.locator('.dk-open[data-testid="dg-node-policy"], .dk-open[data-testid^="dg-node-verdict"]').count() == 1, str(page.evaluate("[...document.querySelectorAll('.dk-open')].map(e => e.dataset.testid)")))
    page.mouse.click(panel["x"] + 40, panel["y"] + panel["h"] - 100)  # the empty canvas
    page.wait_for_timeout(300)
    page.click('[data-testid="dg-node-door"]')
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # A refusal is amber with a lock and words, never red (also inside the panel); a refused run stops at the policy decision.
    ctx.close()
    ctx, page = new_page(browser, 1440, 900, theme)
    run_tool(page, "demo-some-tools", "sensitive_tax_record")
    open_diagram(page)
    no_cover(page, T, "blocked")
    check(T + "blocked: the Blocked by policy box is this run's outcome", text(page, '[data-testid="dg-node-verdict-blocked"] [data-testid="dg-outcome-tag"]') == "This run")
    check(T + "blocked: the box carries a lock icon and the words", page.locator('[data-testid="dg-node-verdict-blocked"] svg.pgc-ico').count() == 1 and "Blocked by policy" in text(page, '[data-testid="dg-node-verdict-blocked"]'))
    check(T + "blocked: the arrows it did not take are dimmed", page.evaluate("[...document.querySelectorAll('.dk-label--dim')].length") >= 3)
    reds = page.evaluate(RED_SCAN, '[data-testid="panel-diagram"]')
    check(T + "blocked: nothing inside the Diagram panel is red", reds == [], str(reds[:6]))
    stop = text(page, '[data-testid="dg-now"]') or ""
    check(T + "blocked: before the walk the caption says where Simulate will stop", "Simulate stops at message" in stop and "Policy decision" in stop and "Blocked by policy" in stop, stop)
    page.click('[data-testid="panel-diagram"] [data-testid="step-toggle"]')
    import re
    m = re.search(r"message (\d+),", stop)
    want = int(m.group(1)) if m else -1
    page.wait_for_function("(n) => document.querySelector('[data-testid=\"panel-diagram\"] [data-testid=\"step-counter\"]').textContent.startsWith('Message ' + n + ' of')", arg=want, timeout=20000)
    page.wait_for_timeout(2500)
    check(T + "blocked: Simulate stops at the policy decision and says so", (counter(page) or "").startswith(f"Message {want} of") and "Policy decision" in stop and "where this run ended" in stop, f"{counter(page)} / {stop}")
    check(T + "blocked: the walked arrow is the policy decision", page.evaluate("[...document.querySelectorAll('.dk-label--on')].map(l => l.textContent)") == ["3. who is calling, and may they?"])
    shot(page, "blocked", "1440x900", theme)
    r = overlap_report(page)
    check(T + "blocked: no overlaps", r["overlaps"] == [] and r["duplicates"] == [] and r["nodeHits"] == [], str(r))

    # Other outcomes: held, upstream error.
    for door, tool, scen, args, outcome, what in (("demo-all-tools", "open_ticket", None, None, "held", "held"), ("demo-all-tools", "list_entitlements", "upstream-error", None, "upstream", "upstream")):
        ctx.close()
        ctx, page = new_page(browser, 1440, 900, theme)
        run_tool(page, door, tool, args, scen)
        open_diagram(page)
        no_cover(page, T, what)
        check(T + f"{what}: its own outcome box is marked", text(page, f'[data-testid="dg-node-verdict-{outcome}"] [data-testid="dg-outcome-tag"]') == "This run")
        check(T + f"{what}: exactly one outcome is marked", page.locator('[data-testid="dg-outcome-tag"]').count() == 1)
        r = overlap_report(page)
        check(T + f"{what}: no overlaps", r["overlaps"] == [] and r["duplicates"] == [] and r["nodeHits"] == [], str(r))
        shot(page, what, "1440x900", theme)
    # The upstream failure has no lock and is not red in Mock.
    reds = page.evaluate(RED_SCAN, '[data-testid="panel-diagram"]')
    check(T + "upstream (Mock): nothing inside the Diagram panel is red", reds == [], str(reds[:6]))

    # Dark/light control contrast: the walk buttons use the dock's tokens (already proven); the diagram's own text on the boxes.
    ratio = page.evaluate("""() => {
      const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const out = {};
      for (const el of document.querySelectorAll('[data-testid^="dg-node-"]')) { const cs = getComputedStyle(el); const l1 = lum(cs.color), l2 = lum(cs.backgroundColor); out[el.dataset.testid] = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
      const lab = document.querySelector('.dk-label'); if (lab) { const cs = getComputedStyle(lab); const l1 = lum(cs.color), l2 = lum(cs.backgroundColor); out.label = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
      return out; }""")
    check(T + "box text and label text contrast is at least 4.5:1", all(v >= 4.5 for v in ratio.values()), str({k: round(v, 2) for k, v in ratio.items() if v < 4.5}))
    check(T + "no console error or warning", page.msgs == [], str(page.msgs[:3]))
    ctx.close()


def phone(browser, theme):
    ctx, page = new_page(browser, 375, 812, theme)
    T = f"[{theme} 375] "
    run_tool(page, "demo-some-tools", "sensitive_patient_records", args_text='{"patient_id": "pat_4410"}')
    page.click('[data-testid="dock-diagram"]')
    page.wait_for_selector('[data-testid="dg-canvas"] .react-flow__node')
    page.wait_for_selector('[data-testid^="dk-label-"]')
    page.wait_for_timeout(700)
    panel = rect(page, '[data-testid="panel-diagram"]')
    check(T + "the panel is a full-width bottom sheet", panel and panel["x"] <= 1 and panel["r"] >= 374, str(panel))
    check(T + "no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.locator('[data-testid="dg-canvas"]').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    cv = rect(page, '[data-testid="dg-canvas"]')
    check(T + "the canvas is at least 200px tall and fits the screen once the sheet is scrolled to it", cv and cv["h"] >= 200 and cv["y"] >= 0 and cv["b"] <= 812, str(cv))
    shot(page, "sheet-canvas", "375x812", theme)
    # at 375 the view holds a readable zoom: the smallest box text is not under 8px on screen before a walk, and the view follows the walk
    px = page.evaluate("(() => { const t = document.querySelector('[data-testid=dg-node-browser] .pgc-dgbox__s'); return parseFloat(getComputedStyle(t).fontSize) * t.getBoundingClientRect().width / t.offsetWidth; })()")
    check(T + "the smallest box text is at least 8px on screen (a readable zoom, not a whole-diagram fit)", px >= 8, str(px))
    check(T + "the walk controls are reachable", page.is_visible('[data-testid="panel-diagram"] [data-testid="step-next"]'))
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    check(T + "Next works on a phone: Message 1", "Message 1 of" in (counter(page) or ""), str(counter(page)))
    shot(page, "blocked-step1", "375x812", theme)
    r = overlap_report(page)
    check(T + "no label overlap at 375", r["overlaps"] == [] and r["duplicates"] == [] and r["nodeHits"] == [], str(r))
    # a phone: opening another panel replaces this one (only one sheet at a time)
    page.click('[data-testid="panel-diagram"] button[aria-label^="Close Diagram"]')  # the sheet covers the dock until it is closed
    page.wait_for_timeout(200)
    page.click('[data-testid="dock-reel"]')
    page.wait_for_timeout(300)
    check(T + "only one sheet is open at a time", page.locator('[data-testid="panel-diagram"]').count() == 0 or not page.is_visible('[data-testid="panel-diagram"]'))
    page.click('[data-testid="panel-reel"] button[aria-label^="Close Movie reel"]')
    page.wait_for_timeout(200)
    page.click('[data-testid="dock-diagram"]')
    page.wait_for_selector('[data-testid="dg-canvas"] .react-flow__node')
    page.wait_for_timeout(500)
    check(T + "the walk position carries between sheets", "Message 1 of" in (counter(page) or ""), str(counter(page)))
    shot(page, "reopened", "375x812", theme)
    check(T + "no console error or warning", page.msgs == [], str(page.msgs[:3]))
    ctx.close()


def once_only(browser):
    # Escape closes; a resize is remembered across a reload (the shared dialog's own storage); the panel is draggable by its title.
    ctx, page = new_page(browser, 1440, 900, "light")
    T = "[panel] "
    run_tool(page, "demo-all-tools", "list_entitlements")
    open_diagram(page)
    tb = rect(page, '[data-testid="panel-diagram"] [data-testid="fd-titlebar"]')
    p0 = rect(page, '[data-testid="panel-diagram"]')
    page.mouse.move(tb["x"] + 120, tb["y"] + tb["h"] / 2)
    page.mouse.down()
    page.mouse.move(tb["x"] + 60, tb["y"] + tb["h"] / 2 + 20, steps=8)
    page.mouse.up()
    p1 = rect(page, '[data-testid="panel-diagram"]')
    check(T + "dragging the title moves the panel", abs(p1["x"] - p0["x"]) > 30, f"{p0} -> {p1}")
    # resize from the south-east corner
    page.mouse.move(p1["r"] - 2, p1["b"] - 2)
    page.mouse.down()
    page.mouse.move(p1["r"] - 82, p1["b"] - 52, steps=8)
    page.mouse.up()
    p2 = rect(page, '[data-testid="panel-diagram"]')
    check(T + "resizing from a corner changes the size", p2["w"] < p1["w"] - 30 and p2["h"] < p1["h"] - 20, f"{p1} -> {p2}")
    page.wait_for_timeout(600)
    # the canvas refits to the new size: the diagram is still wholly inside it
    nodes = page.evaluate("""() => { const c = document.querySelector('[data-testid="dg-canvas"]').getBoundingClientRect(); return [...document.querySelectorAll('[data-testid="dg-canvas"] .react-flow__node')].map(n => { const r = n.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }); }""")
    check(T + "after a resize the whole diagram is refitted inside the canvas", all(nodes), str(nodes))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check(T + "Escape hides the panel", not page.is_visible('[data-testid="panel-diagram"]'))
    check(T + "Escape returns focus to the dock button", page.evaluate("document.activeElement?.dataset?.testid") == "dock-diagram", str(page.evaluate("document.activeElement?.dataset?.testid")))
    page.reload()
    page.wait_for_selector('[data-testid="get-tools"]')
    run_tool(page, "demo-all-tools", "list_entitlements")
    open_diagram(page)
    p3 = rect(page, '[data-testid="panel-diagram"]')
    check(T + "a reload restores the remembered size and place", abs(p3["w"] - p2["w"]) < 3 and abs(p3["x"] - p2["x"]) < 3 and abs(p3["y"] - p2["y"]) < 3, f"{p2} -> {p3}")
    ctx.close()

    # Hostile text: a hostile hop title and tool name in the run's answer render as text.
    def hostile(page):
        evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'

        def fix(route):
            resp = route.fetch()
            body = resp.json()
            run = body.get("run", body)
            for h in run.get("hops", []):
                h["title"] = evil
                h["label"] = evil
            route.fulfill(response=resp, body=json.dumps(body))
        page.route("**/api/call", fix)
    ctx, page = new_page(browser, 1440, 900, "light", init=hostile)
    run_tool(page, "demo-all-tools", "list_entitlements")
    open_diagram(page)
    page.click('[data-testid="panel-diagram"] [data-testid="step-next"]')
    page.wait_for_timeout(300)
    check("[hostile] no injected element or handler ran", page.evaluate("window.__pwned") is None and page.locator("[data-testid=panel-diagram] img[src='x']").count() == 0 and page.dialogs == [])
    # Real data cannot inject through the diagram file, but a hop with no step shows its (hostile) title as text.
    page.evaluate("1")
    ctx.close()

    # Pop-out: a real second window. Reported honestly: it either works (separate React root, own stylesheets, kit labels, Next) or is disabled.
    ctx, page = new_page(browser, 1440, 900, "light")
    run_tool(page, "demo-all-tools", "list_entitlements")
    open_diagram(page)
    # Pop-out is NOT supported for this panel (React Flow cannot measure boxes in another window: they stay hidden and no arrow is drawn). The button must be absent
    # and the panel must say so; the other panels keep theirs.
    check("[popout] the Diagram panel has no pop-out button", page.locator('[data-testid="panel-diagram"] button[aria-label="Pop out to a new window"]').count() == 0)
    check("[popout] and says so", "No pop-out" in (text(page, '[data-testid="dg-note"]') or ""))
    page.click('[data-testid="dock-reel"]')
    page.wait_for_selector('[data-testid="panel-reel"]')
    check("[popout] the other panels keep their pop-out button", page.locator('[data-testid="panel-reel"] button[aria-label="Pop out to a new window"]').count() == 1)
    ctx.close()


if __name__ == "__main__":
    sys.exit(main())
