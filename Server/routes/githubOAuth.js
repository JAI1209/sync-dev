const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const config = require("../config");

const router = express.Router();

/** @type {Map<string, number>} */
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneStates() {
  const now = Date.now();
  for (const [s, t] of pendingStates) {
    if (now - t > STATE_TTL_MS) pendingStates.delete(s);
  }
}

function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    code,
    redirect_uri: config.githubRedirectUri,
  });
  return fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  }).then((r) => r.json());
}

router.get("/start", (req, res) => {
  if (!config.githubClientId || !config.githubClientSecret) {
    return res.status(503).type("html").send(
      "<p>GitHub sign-in is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server.</p>"
    );
  }
  pruneStates();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: config.githubRedirectUri,
    scope: "read:user user:email repo",
    state,
    allow_signup: "true",
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;
  const failRedirect = (msg) => {
    const q = new URLSearchParams({ github_error: msg.slice(0, 200) });
    res.redirect(`${config.clientOrigin}/auth/github/callback?${q.toString()}`);
  };

  if (error) {
    return failRedirect(String(errDesc || error));
  }
  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    return failRedirect("Missing code or state from GitHub.");
  }
  if (!pendingStates.has(state)) {
    return failRedirect("Invalid or expired login state. Try signing in again.");
  }
  pendingStates.delete(state);

  let tokenJson;
  try {
    tokenJson = await exchangeCodeForToken(code);
  } catch (e) {
    console.error("GitHub token exchange", e);
    return failRedirect("Could not exchange authorization code.");
  }

  if (!tokenJson.access_token) {
    return failRedirect(tokenJson.error_description || tokenJson.error || "No access token from GitHub.");
  }

  const accessToken = tokenJson.access_token;
  const refreshToken = tokenJson.refresh_token || "";
  const expiresIn = tokenJson.expires_in ? Number(tokenJson.expires_in) : null;
  const tokenExpiry = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  let ghUser;
  try {
    ghUser = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }).then((r) => r.json());
  } catch (e) {
    console.error("GitHub user fetch", e);
    return failRedirect("Could not read GitHub profile.");
  }

  if (!ghUser.id) {
    return failRedirect(ghUser.message || "GitHub profile response was invalid.");
  }

  const githubId = String(ghUser.id);
  const login = ghUser.login || `user_${githubId}`;
  const email =
    ghUser.email ||
    `${login}@users.noreply.github.com`;

  try {
    let user = await User.findOne({ githubId });
    if (!user) {
      let candidate = `gh_${login}`;
      let n = 0;
      while (await User.findOne({ username: candidate })) {
        n += 1;
        candidate = `gh_${login}_${n}`;
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(
        `oauth_github_${githubId}_${config.jwtSecret}`,
        salt
      );
      user = new User({
        username: candidate,
        email: String(email).toLowerCase(),
        password: hashedPassword,
        githubId,
        githubUsername: login,
        githubAccessToken: accessToken,
        githubRefreshToken: refreshToken,
        githubTokenExpiry: tokenExpiry,
      });
    } else {
      user.githubAccessToken = accessToken;
      if (refreshToken) user.githubRefreshToken = refreshToken;
      user.githubTokenExpiry = tokenExpiry;
      user.githubUsername = login;
    }
    await user.save();

    const payload = { user: { id: user.id, username: user.username } };
    jwt.sign(payload, config.jwtSecret, { expiresIn: 3600 }, (err, appToken) => {
      if (err) {
        console.error(err);
        return failRedirect("Could not create session.");
      }
      const q = new URLSearchParams({ token: appToken });
      res.redirect(`${config.clientOrigin}/auth/github/callback?${q.toString()}`);
    });
  } catch (e) {
    console.error("GitHub user save", e);
    if (e.code === 11000) {
      return failRedirect("That GitHub account is already linked to another username.");
    }
    return failRedirect("Could not save account.");
  }
});

module.exports = router;
