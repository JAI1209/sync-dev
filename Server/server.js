require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const authRoutes = require("./routes/Auth");
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));
app.use("/api/auth", authRoutes);


const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncdev';
if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Using local MongoDB fallback.');
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
