require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/Auth");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);


const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is missing in .env");
  process.exit(1);
}

let server;

async function startServer() {
  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");

    const port = process.env.PORT || 3000;
    server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Mongo connection failed:", err.message);
    process.exit(1);
  }
}

startServer();

async function shutdown() {
  try {
    if (server) {
      server.close();
    }
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
