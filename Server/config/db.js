const mongoose = require("mongoose");
const { logger } = require("../logger");

async function connectDB() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/syncdev";
  if (!process.env.MONGODB_URI) {
    logger.warn("MONGODB_URI is not set. Using local MongoDB fallback.");
  }

  try {
    await mongoose.connect(uri);
    logger.info("MongoDB connected", { uri: uri.replace(/:\/\/.*@/, "://***@") });
  } catch (err) {
    logger.error("MongoDB connection failed", { error: err.message });
    throw err;
  }
}

module.exports = { connectDB };