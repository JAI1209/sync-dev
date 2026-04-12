/** Matches Vite `Cross-Origin-Embedder-Policy: credentialless` (see vite.config.js). */
const BOOT_OPTIONS = { coep: "credentialless" };

let bootPromise = null;

/**
 * WebContainer may only be booted once per page until teardown.
 * Loads `@webcontainer/api` on first call (code-split).
 */
export async function getWebContainer() {
  if (!bootPromise) {
    const { WebContainer } = await import("@webcontainer/api");
    bootPromise = WebContainer.boot(BOOT_OPTIONS);
  }
  return bootPromise;
}
