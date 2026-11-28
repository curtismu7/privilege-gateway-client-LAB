// Every vendored web file matches its pin file byte for byte (rules 22, 24, 25 and the shared UI pieces). The canonical copy changes first
// (AI-DEMO-Standalone shared/); re-vendor with cp from origin/main and re-pin, never edit the copy here. Runs under vitest with the web tests.
import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = dirname(fileURLToPath(import.meta.url));
const root = join(src, "..", "..");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const pins = (file) => readFileSync(file, "utf8").split("\n").filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.trim().split(/\s+/));

// [folder under web/src, pin file, the files that pin must list, (unused), files the pin lists that live on the server side]
const UNITS = [
  ["top-menu", "top-menu.sha256", ["ReleaseNotes.jsx", "TopMenu.jsx", "top-menu.css"]],
  ["components", "JsonPane.sha256", ["JsonPane.jsx"]],
  ["components", "JsonPane.css.sha256", ["JsonPane.css"]],
  ["components", "VerifyMark.sha256", ["VerifyMark.jsx"]],
  ["components", "VerifyMark.css.sha256", ["VerifyMark.css"]],
  ["components", "ShelfLink.sha256", ["ShelfLink.jsx"]],
  ["signin-dialog", "signin-dialog.sha256", ["SignInDialog.jsx"]],
  ["floating-dialog", "floating-dialog.sha256", ["FloatingDialog.jsx", "floating-dialog.css", "floating-dialog.test.jsx", "geometry.js", "useFloatingPanel.js"]],
  ["evidence", "evidence.sha256", ["ActorCard.jsx", "MovieReel.jsx", "SequenceView.jsx", "StepDetailPanel.jsx", "Tag.jsx", "evidence.css", "evidence.test.jsx", "fixtures.js", "lanes.js", "safeText.js"]],
  ["mode-modal", "mode-modal.sha256", ["ModeModal.jsx", "mode-modal.css"]],
  [".", "safeText.sha256", ["safeText.js"]],
  ["diagram-kit", "diagram-kit.sha256", ["DiagramKit.jsx", "DiagramKit.test.jsx", "diagram-kit.css", "diagramKit.js", "diagramKit.test.js"]],
  ["gateway-trace", "gateway-trace.sha256", ["GatewayTrace.jsx", "gateway-trace.css", "gateway-trace.test.jsx"], null, ["gatewayTrace.js"]],
];

describe("vendored web pins", () => {
  for (const [dir, pinFile, files, , serverSide = []] of UNITS) {
    test(`web/src/${dir}/${pinFile} lists exactly its files and each matches`, () => {
      const p = pins(join(src, dir, pinFile));
      expect(p.map(([, f]) => f).sort()).toEqual([...files, ...serverSide].sort());
      for (const [hash, file] of p) {
        if (serverSide.includes(file)) continue; // checked from the server test (server/src/gatewayTrace.js)
        expect(sha(join(src, dir, file)), `${file} differs from ${pinFile} (hand-edited, or re-vendored without re-pinning)`).toBe(hash);
      }
    });
  }

  test("every file in a pinned folder is pinned", () => {
    for (const dir of ["top-menu", "floating-dialog", "evidence", "gateway-trace", "signin-dialog", "diagram-kit"]) {
      const pinned = new Set(UNITS.filter(([d]) => d === dir).flatMap(([, , files, , server = []]) => [...files, ...server]));
      for (const f of readdirSync(join(src, dir))) {
        if (f.endsWith(".sha256")) continue;
        expect(pinned.has(f), `${dir}/${f} is not pinned`).toBe(true);
      }
    }
  });

  test("the diagram-kit pin names the AI-DEMO-Standalone commit it was vendored from", () => {
    const first = readFileSync(join(src, "diagram-kit", "diagram-kit.sha256"), "utf8").split("\n")[0];
    expect(first).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/diagram-kit at [0-9a-f]{7,40}/);
  });

  test("the vendored shared stylesheet matches scripts/standalone-ui.sha256", () => {
    const [pin] = readFileSync(join(root, "scripts", "standalone-ui.sha256"), "utf8").trim().split(/\s+/);
    expect(sha(join(src, "standalone-ui.css"))).toBe(pin);
  });

  test("the TopMenu pin was regenerated for this copy (the canonical top-menu.sha256 is stale) and names bare files", () => {
    for (const [, f] of pins(join(src, "top-menu", "top-menu.sha256"))) expect(f).not.toMatch(/\//);
  });
});
