const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY, RESET_TOKEN_EXPIRY_MS } = require('../config/constants');

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, config.refreshTokenSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiry = Date.now() + RESET_TOKEN_EXPIRY_MS;
  return { token, hash, expiry };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  generateResetToken,
};
