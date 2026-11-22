// Runs the shared hop-detail tests against the vendored copy. The vendored test file sits beside hopDetail.mjs and
// hop-catalog.json unchanged (it reads them by relative path), so it is imported here rather than copied into test/
// (node --test test/*.test.js only globs .js).
import '../src/vendor/hopDetail.test.mjs';
