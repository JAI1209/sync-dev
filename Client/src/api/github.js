import { authFetch } from "./client";

export async function importGitHubRepo(owner, repo, ref) {
  const res = await authFetch("/api/github/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, ref: ref || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res._sessionExpired) {
      throw new Error("Session expired (401).");
    }
    const msg = data.msg || data.message || `Import failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * FIX: Commit calls already pass a single object payload, so the API helper must
 * destructure that object instead of reading positional arguments.
 * @param {{
 *   owner: string,
 *   repo: string,
 *   branch: string,
 *   message: string,
 *   files: { path: string, content: string }[]
 * }} params
 */
export async function commitGitHubRepo({ owner, repo, branch, message, files }) {
  const res = await authFetch("/api/github/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, branch, message, files }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.msg || data.message || `Commit failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}
