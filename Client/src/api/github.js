import { apiUrl } from "./client";

export async function importGitHubRepo(owner, repo, ref) {
  const token = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/github/import"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ owner, repo, ref: ref || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.msg || data.message || `Import failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} message
 * @param {{ path: string, content: string }[]} files
 */
export async function commitGitHubRepo(owner, repo, branch, message, files) {
  const token = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/github/commit"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ owner, repo, branch, message, files }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.msg || data.message || `Commit failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}
