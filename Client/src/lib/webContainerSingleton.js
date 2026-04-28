/** FIX: Match Vite's `Cross-Origin-Embedder-Policy: require-corp` headers for WebContainer boot. */
const BOOT_OPTIONS = { coep: "require-corp" };

let bootPromise = null;

/**
 * WebContainer may only be booted once per page until teardown.
 * Loads `@webcontainer/api` on first call (code-split).
 */
export function getWebContainer() {
  if (!bootPromise) {
    // FIX: Return the exact same promise object for concurrent callers, not per-call async wrappers.
    bootPromise = import("@webcontainer/api").then(({ WebContainer }) =>
      WebContainer.boot(BOOT_OPTIONS),
    );
  }
  return bootPromise;
}
