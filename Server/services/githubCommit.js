// Create a single commit on a branch using the Git Data API (blobs + tree + commit + ref).

async function ghFetch(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || "GitHub API error");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * @param {{ token: string, owner: string, repo: string, branch: string, message: string, files: { path: string, content: string }[] }} opts
 */
async function commitFilesToBranch(opts) {
  const { token, owner, repo, branch, message, files } = opts;
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const b = encodeURIComponent(branch);

  const base = `https://api.github.com/repos/${o}/${r}`;

  const refData = await ghFetch("GET", `${base}/git/ref/heads/${b}`, token);
  const parentCommitSha = refData.object.sha;

  const parentCommit = await ghFetch("GET", `${base}/git/commits/${parentCommitSha}`, token);
  const baseTreeSha =
    typeof parentCommit.tree === "string"
      ? parentCommit.tree
      : parentCommit.tree?.sha;
  if (!baseTreeSha) {
    const err = new Error("Could not read Git tree from the latest commit.");
    err.status = 502;
    throw err;
  }

  const byPath = new Map();
  for (const f of files) {
    const p = String(f.path || "").replace(/^\/+/, "").replace(/\\/g, "/");
    if (!p) continue;
    byPath.set(p, f.content ?? "");
  }
  const unique = [...byPath.entries()].map(([path, content]) => ({ path, content }));

  if (!unique.length) {
    const err = new Error("No file paths to commit.");
    err.status = 400;
    throw err;
  }

  const maxCommit = Number(process.env.GITHUB_COMMIT_MAX_FILES) || 8000;
  if (unique.length > maxCommit) {
    const err = new Error(
      `Too many files in one commit (${unique.length}). Max ${maxCommit}. Split or raise GITHUB_COMMIT_MAX_FILES.`
    );
    err.status = 400;
    throw err;
  }

  const blobConcurrency = Math.min(12, Math.max(4, Math.ceil(unique.length / 50)));
  const shas = await mapPool(unique, blobConcurrency, async ({ path, content }) => {
    const blob = await ghFetch("POST", `${base}/git/blobs`, token, {
      content,
      encoding: "utf-8",
    });
    return { path, sha: blob.sha };
  });

  const tree = shas.map(({ path, sha }) => ({
    path,
    mode: "100644",
    type: "blob",
    sha,
  }));

  const newTree = await ghFetch("POST", `${base}/git/trees`, token, {
    base_tree: baseTreeSha,
    tree,
  });

  const newCommit = await ghFetch("POST", `${base}/git/commits`, token, {
    message,
    parents: [parentCommitSha],
    tree: newTree.sha,
  });

  await ghFetch("PATCH", `${base}/git/refs/heads/${b}`, token, {
    sha: newCommit.sha,
  });

  return {
    commitSha: newCommit.sha,
    htmlUrl: newCommit.html_url,
    message: newCommit.message,
  };
}

module.exports = { commitFilesToBranch };
