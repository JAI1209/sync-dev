const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET || `${jwtSecret}_refresh`;
const googleClientId = process.env.GOOGLE_CLIENT_ID || null; // optional — no warning if unset

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Using a development fallback secret.");
}

const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const githubClientId = process.env.GITHUB_CLIENT_ID || "";
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || "";
const githubRedirectUri =
  process.env.GITHUB_REDIRECT_URI ||
  "http://localhost:3000/api/auth/github/callback";

if (!githubClientId || !githubClientSecret) {
  console.warn("GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set — GitHub login and repo import are disabled.");
}

module.exports = {
  jwtSecret,
  refreshTokenSecret,
  googleClientId,
  clientOrigin,
  githubClientId,
  githubClientSecret,
  githubRedirectUri,
};