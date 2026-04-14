const authService = require("../services/authService");
const userService = require("../services/userService");
const emailService = require("../services/emailService");
const config = require("../config");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(config.googleClientId);

async function googleAuth(req, res) {
  const { credential } = req.body;

  if (!config.googleClientId) {
    return res.status(503).json({ msg: "Google sign-in is not configured." });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });

    const { email } = ticket.getPayload();
    let user = await userService.findByUsername(email);
    if (!user) {
      user = await userService.createOAuthUser(email, "google");
    }

    const payload = { user: { id: user.id, username: user.username } };
    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    return res.status(500).send("Server Error");
  }
}

async function register(req, res) {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      return res.status(400).json({ msg: "Username, email, and password are required" });
    }

    const existingUser = await userService.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const existingEmail = await userService.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ msg: "Email already registered" });
    }

    const hashedPassword = await authService.hashPassword(password);
    const user = await userService.createLocalUser(username, email, hashedPassword);

    const payload = { user: { id: user.id, username: user.username } };
    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    return res.status(500).send("Server Error");
  }
}

async function login(req, res) {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({ msg: "Username and password are required" });
    }

    const user = await userService.findByUsername(username);
    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    if (user.authProvider !== "local") {
      return res.status(400).json({ msg: `Please login with ${user.authProvider}` });
    }

    const isMatch = await authService.comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const payload = { user: { id: user.id, username: user.username } };
    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    return res.status(500).send("Server Error");
  }
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ msg: "No refresh token provided" });
  }

  try {
    const decoded = jwt.verify(refreshToken, config.jwtSecret);
    if (decoded.type !== "refresh") {
      return res.status(401).json({ msg: "Invalid token type" });
    }

    const payload = { user: { id: decoded.user.id, username: decoded.user.username } };
    const newAccessToken = authService.generateAccessToken(payload);
    const newRefreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    return res.status(401).json({ msg: "Invalid or expired refresh token" });
  }
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ msg: "A valid email is required" });
  }

  try {
    const user = await userService.findByEmail(email);
    if (!user) {
      return res.json({ msg: "If that email is registered, a reset link has been sent." });
    }

    const { token: resetToken, hash: resetTokenHash, expiry: resetTokenExpiry } = authService.generateResetToken();
    await userService.saveResetToken(user, resetTokenHash, resetTokenExpiry);

    const resetUrl = `${config.clientOrigin}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    await emailService.sendPasswordResetEmail(email, resetUrl);

    return res.json({ msg: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    return res.status(500).json({ msg: "Server error" });
  }
}

async function resetPassword(req, res) {
  const { token, email, password } = req.body;

  if (!token || !email || !password) {
    return res.status(400).json({ msg: "Token, email, and new password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ msg: "Password must be at least 6 characters" });
  }

  try {
    const resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await userService.findByEmail(email);

    if (
      !user ||
      user.resetToken !== resetTokenHash ||
      !user.resetTokenExpiry ||
      user.resetTokenExpiry <= Date.now()
    ) {
      return res.status(400).json({ msg: "Invalid or expired reset token" });
    }

    const hashedPassword = await authService.hashPassword(password);
    await userService.resetPassword(user, hashedPassword);

    return res.json({ msg: "Password has been reset successfully" });
  } catch (err) {
    return res.status(500).json({ msg: "Server error" });
  }
}

async function getMe(req, res) {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ msg: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await userService.findById(decoded.user.id);

    if (!user) {
      return res.status(401).json({ msg: "Invalid token" });
    }

    return res.json({
      username: user.username,
      email: user.email,
      githubConnected: Boolean(user.githubId),
    });
  } catch (err) {
    return res.status(401).json({ msg: "Invalid token" });
  }
}

module.exports = {
  googleAuth,
  register,
  login,
  refresh,
  forgotPassword,
  resetPassword,
  getMe,
};
