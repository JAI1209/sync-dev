const router = require("express").Router();
const authService = require("../services/authService");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("../config");
const User = require("../models/User");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(config.googleClientId);






router.post('/google', async (req, res) => {
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

    let user = await User.findOne({ username: email });
    if (!user) {
      // Bug A: OAuth users don't need passwords - set null with authProvider
      user = new User({ 
        username: email, 
        email, 
        password: null, 
        authProvider: 'google'
      });
      await user.save();
    }

    const payload = { user: { id: user.id, username: user.username } };
    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});



router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      return res.status(400).json({ msg: "Username, email, and password are required" });
    }

    let user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }

    // Bug 4: Check for duplicate email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ msg: "Email already registered" });
    }

    user = new User({ username, email, password });
    user.password = await authService.hashPassword(password);

    await user.save();

    const payload = {
      user: { id: user.id, username: user.username },
    };

    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({ msg: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    // Bug A: Block password login for OAuth users
    if (user.authProvider !== 'local') {
      return res.status(400).json({ 
        msg: `Please login with ${user.authProvider}` 
      });
    }

    const isMatch = await authService.comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const payload = {
      user: {
        id: user.id,
        username: user.username
      },
    };

    const accessToken = authService.generateAccessToken(payload);
    const refreshToken = authService.generateRefreshToken(payload);
    return res.json({ token: accessToken, refreshToken });
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

// ── Refresh token endpoint ──────────────────────────────────────────────────
router.post("/refresh", (req, res) => {
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
});

router.post("/forgot", async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ msg: "A valid email is required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      // Always return the same message to avoid user-enumeration
      return res.json({ msg: "If that email is registered, a reset link has been sent." });
    }

    // Generate a cryptographically secure reset token
    const { token: resetToken, hash: resetTokenHash, expiry: resetTokenExpiry } = authService.generateResetToken();

    user.resetToken = resetTokenHash;
    user.resetTokenExpiry = new Date(resetTokenExpiry);
    await user.save();

    // Build the reset URL
    const resetUrl = `${config.clientOrigin}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Attempt to send the email
    if (config.smtpHost) {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: false,
        auth: { user: config.smtpUser, pass: config.smtpPass },
      });
      await transporter.sendMail({
        from: `"SyncDev" <${config.smtpUser}>`,
        to: email,
        subject: "SyncDev — Password Reset",
        html: `<p>You requested a password reset.</p>
               <p><a href="${resetUrl}">Click here to reset your password</a></p>
               <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      });
    } else {
      // No SMTP configured — log the reset link for development
      console.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    }

    return res.json({ msg: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot-password error:", err.message);
    return res.status(500).json({ msg: "Server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, email, password } = req.body;

  if (!token || !email || !password) {
    return res.status(400).json({ msg: "Token, email, and new password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ msg: "Password must be at least 6 characters" });
  }

  try {
    const resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email,
      resetToken: resetTokenHash,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ msg: "Invalid or expired reset token" });
    }

    user.password = await authService.hashPassword(password);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    return res.json({ msg: "Password has been reset successfully" });
  } catch (err) {
    console.error("Reset-password error:", err.message);
    return res.status(500).json({ msg: "Server error" });
  }
});

router.get("/me", async (req, res) => {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ msg: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.user.id).select("username email githubId");

    if (!user) {
      return res.status(401).json({ msg: "Invalid token" });
    }

    res.json({
      username: user.username,
      email: user.email,
      githubConnected: Boolean(user.githubId),
    });
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ msg: "Invalid token" });
  }
});

module.exports = router;
