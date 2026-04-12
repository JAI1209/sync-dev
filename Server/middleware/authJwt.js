const jwt = require("jsonwebtoken");
const config = require("../config");

function authJwt(req, res, next) {
  const header = req.header("Authorization") || "";
  const raw = header.replace(/^Bearer\s+/i, "");
  if (!raw) return res.status(401).json({ msg: "No token provided" });
  try {
    req.auth = jwt.verify(raw, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
}

module.exports = { authJwt };
