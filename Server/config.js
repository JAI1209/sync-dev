const jwtSecret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Using a development fallback secret.");
}

module.exports = {
  jwtSecret,
};
