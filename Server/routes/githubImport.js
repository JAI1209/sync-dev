const express = require("express");
const User = require("../models/User");
const config = require("../config");
const { importRepoFromGitHub } = require("../services/githubRepoImport");
const { commitFilesToBranch } = require("../services/githubCommit");
const { authJwt } = require("../middleware/authJwt");

const router = express.Router();

/**
 * Accept owner + repo, "owner/repo", or full https://github.com/owner/repo URLs.
 */
function normalizeGithubRepo(ownerIn, repoIn) {
  const clean = (s) => String(s || "").trim();

  const fromGithubUrl = (text) => {
    const s = clean(text);
    const m = s.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?\s]+)/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
  };

  let owner = clean(ownerIn);
  let repo = clean(repoIn);

  const repoUrl = fromGithubUrl(repo);
  if (repoUrl) return { ok: true, ...repoUrl };

  const ownerUrl = fromGithubUrl(owner);
  if (ownerUrl) return { ok: true, ...ownerUrl };

  if (/github\.com/i.test(owner) || /github\.com/i.test(repo)) {
    return {
      ok: false,
      msg:
        "Use a repository link like https://github.com/owner/repo-name, or enter the repo name only (e.g. react). Profile URLs (github.com/username with no repo) are not valid.",
    };
  }

  repo = repo.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  owner = owner.replace(/^\/+|\/+$/g, "");

  if (repo.includes("/") && !/^https?:/i.test(repo)) {
    const parts = repo.split("/").filter(Boolean);
    if (parts.length >= 2) {
      if (!owner) {
        return { ok: true, owner: parts[0], repo: parts[parts.length - 1] };
      }
      return {
        ok: false,
        msg:
          "When OWNER is set, REPO must be the repository name only (no slashes). Or paste a full https://github.com/owner/repo URL in REPO.",
      };
    }
  }

  if (!owner || !repo) {
    return {
      ok: false,
      msg: "owner and repo are required (e.g. owner: facebook, repo: react).",
    };
  }

  return { ok: true, owner, repo };
}

function importErrorResponse(e, context = {}) {
  const hasGithubToken = Boolean(context.hasGithubToken);
  const msg = String(e.message || "");

  if (e.status === 401) {
    return {
      status: 401,
      msg: "GitHub auth error: Your GitHub session expired. Reconnect GitHub from the login page to import private repos. Public repos do not require GitHub sign-in.",
    };
  }
  if (e.status === 403) {
    if (/rate limit/i.test(msg)) {
      return {
        status: 429,
        msg: hasGithubToken
          ? "GitHub rate limit reached. Try again later."
          : "GitHub rate limit reached for anonymous import. Link GitHub or try again later.",
      };
    }
    return {
      status: 403,
      msg: hasGithubToken
        ? "GitHub access denied. Check the repo name and your GitHub account permissions."
        : "GitHub access denied. This may be a private repository — connect your GitHub account from the login page to import it.",
    };
  }
  if (e.status === 404) {
    return {
      status: 400,
      msg:
        "GitHub could not find that repository or branch. Check owner and repo (e.g. facebook/react), the branch/ref, and if the repo is private sign in with GitHub.",
    };
  }
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
  return { status, msg: msg || "Import failed" };
}

function commitErrorResponse(e) {
  if (e.status === 401) {
    return {
      status: 401,
      msg: "GitHub rejected the request. Sign in with GitHub again.",
    };
  }
  if (e.status === 404) {
    return {
      status: 400,
      msg:
        "Branch or repository not found on GitHub. Check branch name, owner, and repo.",
    };
  }
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
  return { status, msg: e.message || "Commit failed" };
}

async function refreshGithubToken(user) {
  if (!user.githubRefreshToken) return false;
  const body = new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    grant_type: "refresh_token",
    refresh_token: user.githubRefreshToken,
  });
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
  const data = await res.json();
  if (!data.access_token) return false;
  user.githubAccessToken = data.access_token;
  if (data.refresh_token) user.githubRefreshToken = data.refresh_token;
  user.githubTokenExpiry = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : user.githubTokenExpiry;
  await user.save();
  return true;
}

router.post("/import", authJwt, async (req, res) => {
  const parsed = normalizeGithubRepo(req.body.owner, req.body.repo);
  if (!parsed.ok) {
    return res.status(400).json({ msg: parsed.msg });
  }
  const { owner, repo } = parsed;
  const ref = (req.body.ref || "").trim() || undefined;

  try {
    let user = await User.findById(req.auth.user.id).select(
      "+githubAccessToken +githubRefreshToken githubTokenExpiry githubId"
    );

    if (user?.githubAccessToken && user.githubTokenExpiry && user.githubTokenExpiry < new Date()) {
      const ok = await refreshGithubToken(user);
      if (ok) {
        user = await User.findById(req.auth.user.id).select("+githubAccessToken +githubRefreshToken githubTokenExpiry githubId");
      } else {
        // FIX: Do not reuse an expired GitHub token after refresh failure; fall back to anonymous public import only.
        user.githubAccessToken = "";
      }
    }

    // FIX: Public repository imports should still work when this SyncDev account has no linked GitHub token.
    const token = user?.githubAccessToken || "";
    let payload;
    try {
      payload = await importRepoFromGitHub({ owner, repo, ref, token });
    } catch (e) {
      if (e.status === 401 && user?.githubRefreshToken) {
        const refreshed = await refreshGithubToken(user);
        if (refreshed) {
          user = await User.findById(req.auth.user.id).select("+githubAccessToken githubId");
          try {
            payload = await importRepoFromGitHub({
              owner,
              repo,
              ref,
              token: user.githubAccessToken,
            });
          } catch (e2) {
            const r = importErrorResponse(e2, { hasGithubToken: true });
            return res.status(r.status).json({ msg: r.msg });
          }
        } else {
          return res.status(401).json({ msg: "GitHub rejected the request. Sign in with GitHub again." });
        }
      } else {
        const r = importErrorResponse(e, { hasGithubToken: Boolean(token) });
        return res.status(r.status).json({ msg: r.msg });
      }
    }

    if (payload === undefined) {
      return res.status(500).json({ msg: "Import did not return data." });
    }
    return res.json(payload);
  } catch (e) {
    console.error("github import", e);
    return res.status(500).json({ msg: e.message || "Server error" });
  }
});

router.post("/commit", authJwt, async (req, res) => {
  const parsed = normalizeGithubRepo(req.body.owner, req.body.repo);
  if (!parsed.ok) {
    return res.status(400).json({ msg: parsed.msg });
  }
  const { owner, repo } = parsed;
  const branch = (req.body.branch || "").trim().replace(/^\/+|\/+$/g, "");
  const message = (req.body.message || "").trim();
  const fileList = req.body.files;

  if (!branch) {
    return res.status(400).json({ msg: "branch is required." });
  }
  if (!message) {
    return res.status(400).json({ msg: "Commit message is required." });
  }
  if (!Array.isArray(fileList) || !fileList.length) {
    return res.status(400).json({ msg: "files[] must be a non-empty array of { path, content }." });
  }

  try {
    let user = await User.findById(req.auth.user.id).select(
      "+githubAccessToken +githubRefreshToken githubTokenExpiry githubId"
    );

    if (!user || !user.githubId) {
      return res.status(403).json({
        msg: "GitHub is not linked to this account. Sign in with GitHub from the login page.",
      });
    }

    if (!user.githubAccessToken) {
      return res.status(403).json({ msg: "No GitHub token on file. Sign in with GitHub again." });
    }

    if (user.githubTokenExpiry && user.githubTokenExpiry < new Date()) {
      const ok = await refreshGithubToken(user);
      if (!ok) {
        return res.status(401).json({ msg: "GitHub session expired. Sign in with GitHub again." });
      }
      user = await User.findById(req.auth.user.id).select("+githubAccessToken +githubRefreshToken githubTokenExpiry githubId");
    }

    const runCommit = async (accessToken) =>
      commitFilesToBranch({
        token: accessToken,
        owner,
        repo,
        branch,
        message,
        files: fileList,
      });

    try {
      const result = await runCommit(user.githubAccessToken);
      return res.json(result);
    } catch (e) {
      if (e.status === 401 && user.githubRefreshToken) {
        const refreshed = await refreshGithubToken(user);
        if (refreshed) {
          user = await User.findById(req.auth.user.id).select("+githubAccessToken githubId");
          try {
            const result = await runCommit(user.githubAccessToken);
            return res.json(result);
          } catch (e2) {
            const r = commitErrorResponse(e2);
            return res.status(r.status).json({ msg: r.msg });
          }
        }
        return res.status(401).json({ msg: "GitHub rejected the request. Sign in with GitHub again." });
      }
      const r = commitErrorResponse(e);
      return res.status(r.status).json({ msg: r.msg });
    }
  } catch (e) {
    console.error("github commit", e);
    return res.status(500).json({ msg: e.message || "Server error" });
  }
});

module.exports = router;
