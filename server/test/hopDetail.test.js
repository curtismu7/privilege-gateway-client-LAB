// Runs the shared hop-detail tests against the vendored copy. The vendored test file is unchanged and finds its files by relative path:
// hop-catalog.json and README.md beside it, and evidence/lanes.js one level up (shared/hop-detail and shared/evidence are siblings). This lab keeps
// those in server/src/vendor and web/src/evidence, so the test is imported from a temporary folder laid out like shared/ (the copies are byte
// for byte; the byte-identity check against origin/main is in vendored-pins.test.js). It is imported here rather than copied into test/
// because node --test test/*.test.js only globs .js.
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'pgc-hop-detail-'));
process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(join(tmp, 'hop-detail'));
mkdirSync(join(tmp, 'evidence'));
for (const f of ['hopDetail.mjs', 'hop-catalog.json', 'hopDetail.test.mjs', 'README.md']) copyFileSync(join(root, 'server/src/vendor', f), join(tmp, 'hop-detail', f));
copyFileSync(join(root, 'web/src/evidence/lanes.js'), join(tmp, 'evidence', 'lanes.js'));
await import(pathToFileURL(join(tmp, 'hop-detail', 'hopDetail.test.mjs')).href);
