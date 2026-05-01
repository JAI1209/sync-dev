/** Match Vite's Cross-Origin-Embedder-Policy: require-corp headers for WebContainer boot. */
const apiKey = typeof import.meta !== "undefined" && import.meta.env?.VITE_WEBCONTAINER_API_KEY;

const BOOT_OPTIONS = {
  coep: "require-corp",
  ...(apiKey ? { apiKey } : {}),
};

let bootPromise = null;

/**
 * WebContainer may only be booted once per page until teardown.
 * Loads @webcontainer/api on first call (code-split).
 */
export function getWebContainer() {
  if (!bootPromise) {
    bootPromise = import("@webcontainer/api").then(({ WebContainer }) =>
      WebContainer.boot(BOOT_OPTIONS),
    );
  }
  return bootPromise;
}
