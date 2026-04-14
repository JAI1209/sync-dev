const User = require("../models/User");

async function findByUsername(username) {
  return await User.findOne({ username });
}

async function findByEmail(email) {
  return await User.findOne({ email });
}

async function findById(id) {
  return await User.findById(id).select("username email githubId");
}

async function createLocalUser(username, email, hashedPassword) {
  const user = new User({
    username,
    email,
    password: hashedPassword,
    authProvider: "local",
  });
  return await user.save();
}

async function createOAuthUser(email, provider) {
  const user = new User({
    username: email,
    email,
    password: null,
    authProvider: provider,
  });
  return await user.save();
}

async function saveResetToken(user, hash, expiry) {
  user.resetToken = hash;
  user.resetTokenExpiry = new Date(expiry);
  return await user.save();
}

async function resetPassword(user, hashedPassword) {
  user.password = hashedPassword;
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;
  return await user.save();
}

module.exports = {
  findByUsername,
  findByEmail,
  findById,
  createLocalUser,
  createOAuthUser,
  saveResetToken,
  resetPassword,
};
