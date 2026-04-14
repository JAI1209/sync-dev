/**
 * Prefix for API calls. Set `VITE_API_URL` (e.g. http://localhost:3000)
 * to talk to the Express server directly and avoid dev-proxy issues.
 */
export function apiUrl(path) {
  const raw = import.meta.env.VITE_API_URL || "";
  const base = String(raw).replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

const ACCESS_TOKEN_KEY = "token";
const REFRESH_TOKEN_KEY = "refreshToken";

let refreshInFlight = null;

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveAuthTokens(token, refreshToken) {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearAuthTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

async function requestRefreshToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuthTokens();
      return null;
    }

    const data = await parseJsonSafe(res);
    if (!data.token) {
      clearAuthTokens();
      return null;
    }

    saveAuthTokens(data.token, data.refreshToken || refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

export async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = requestRefreshToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function authFetch(path, options = {}) {
  const { headers = {}, retryOnUnauthorized = true, ...rest } = options;

  const token = getAccessToken();
  const firstHeaders = {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res = await fetch(apiUrl(path), { ...rest, headers: firstHeaders });
  if (res.status !== 401 || !retryOnUnauthorized) return res;

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) return res;

  const retryHeaders = {
    ...headers,
    Authorization: `Bearer ${refreshedToken}`,
  };
  res = await fetch(apiUrl(path), { ...rest, headers: retryHeaders });
  return res;
}
