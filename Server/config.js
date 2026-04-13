const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const googleClientId = process.env.GOOGLE_CLIENT_ID;

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Using a development fallback secret.");
}

if (!googleClientId) {
    console.warn("GOOGLE_CLIENT_ID is not set.");
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

const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";

if (!smtpHost) {
  console.warn("SMTP_HOST not set — password reset emails will be logged to console instead of sent.");
}

module.exports = {
  jwtSecret,
  googleClientId,
  clientOrigin,
  githubClientId,
  githubClientSecret,
  githubRedirectUri,
  smtpHost,
  smtpPort,
  smtpUser,
  smtpPass,
};