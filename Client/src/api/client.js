/** Prefix for API calls. Set `VITE_API_URL` (e.g. http://localhost:3000) to talk to the Express server directly and avoid dev-proxy issues. */
export function apiUrl(path) {
  const raw = import.meta.env.VITE_API_URL || "";
  const base = String(raw).replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${base}${p}`;
  return p;
}
