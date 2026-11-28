// jest-dom matchers (the vendored gateway-trace and evidence tests use them), cleanup between tests, and the few browser APIs jsdom lacks.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// The Real-or-mock modal remembers a dismissal in sessionStorage for the rest of the session: start every test with it showing.
afterEach(() => { cleanup(); try { sessionStorage.clear(); } catch { /* none */ } });

// Some Node versions expose a half-working global localStorage that shadows jsdom's; use a plain in-memory one.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  });
}

// jsdom has no layout or scrolling; the reel and the step scroll call these.
Element.prototype.scrollTo = Element.prototype.scrollTo || function scrollTo() {};
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function scrollIntoView() {};
window.scrollTo = () => {};

// matchMedia: the theme's "auto" mode asks the OS preference.
window.matchMedia = window.matchMedia || ((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));

// React Flow (the diagram kit) needs these two; jsdom has neither. It draws nothing here (nothing is measured), so a real browser proves the drawing.
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || RO;
globalThis.DOMMatrixReadOnly = globalThis.DOMMatrixReadOnly || class { constructor() { this.m22 = 1; } };
