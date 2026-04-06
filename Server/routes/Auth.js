const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const config = require("../config");
const User = require("../models/User");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(config.googleClientId);




router.post('/google', async (req, res) => {
  const { credential } = req.body

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    })

    const { email, name } = ticket.getPayload()

    let user = await User.findOne({ username: email })
    if (!user) {
      user = new User({ username: email, password: email + process.env.JWT_SECRET })
      await user.save()
    }

    const payload = { user: { id: user.id, username: name } }
    jwt.sign(payload, config.jwtSecret, { expiresIn: 3600 }, (err, token) => {
      if (err) throw err
      res.json({ token })
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send('Server Error')
  }
})



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

    user = new User({ username, email, password });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    const payload = {
      user: { id: user.id },
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: 3600 });
    return res.json({ token });
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

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const payload = {
      user: {
        id: user.id,
        username: user.username
      },
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: 3600 });
    return res.json({ token });
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

router.post("/forgot", async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ msg: "A valid email is required" });
  }

  return res.json({ msg: "Reset link queued for delivery." });
});

router.get("/me", async (req, res) => {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ msg: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.user.id).select("username email");

    if (!user) {
      return res.status(401).json({ msg: "Invalid token" });
    }

    res.json({ username: user.username, email: user.email });
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ msg: "Invalid token" });
  }
});

module.exports = router;
