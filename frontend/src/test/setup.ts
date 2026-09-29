import '@testing-library/jest-dom/vitest';

// jsdom lacks these browser APIs used by the app shell.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
}
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

// Headless UI transitions query getAnimations; provide a quiet no-op instead of its warning polyfill.
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
