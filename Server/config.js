require('dotenv').config()

const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const googleClientId = process.env.GOOGLE_CLIENT_ID;

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Using a development fallback secret.");
}

if (!googleClientId) {
  console.warn("GOOGLE_CLIENT_ID is not set.");
}

module.exports = {
  jwtSecret,
  googleClientId,
};