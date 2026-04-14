/**
 * Socket Authentication Test Script
 * Run with: node test-socket.js
 */

const io = require("socket.io-client");

const API_URL = "http://localhost:3000";

async function testSocketAuth() {
  console.log("=== Socket Auth Test ===\n");

  // Step 1: Register/Login
  console.log("1. Testing login...");
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "testuser", password: "password123" }),
  });

  const loginData = await loginRes.json();
  console.log("   Login response:", loginData);

  if (!loginData.token) {
    console.log("   ❌ No token received");
    return;
  }

  console.log("   ✅ Token received");
  console.log("   Access token (first 20 chars):", loginData.token.substring(0, 20) + "...");
  console.log("   Refresh token (first 20 chars):", loginData.refreshToken?.substring(0, 20) + "...");

  // Step 2: Connect with token
  console.log("\n2. Testing socket connection...");
  const socket = io(API_URL, {
    auth: { token: loginData.token },
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    console.log("   ✅ Socket connected! ID:", socket.id);

    // Join room
    console.log("\n3. Testing room join...");
    socket.emit("join-room", { roomId: "test_room_123" });
  });

  socket.on("room-state", (state) => {
    console.log("   ✅ Room state received:", Object.keys(state.files || {}), "files");
    console.log("\n=== All Tests Passed ===");
    socket.disconnect();
    process.exit(0);
  });

  socket.on("connect_error", (err) => {
    console.log("   ❌ Socket connection failed:", err.message);
    console.log("\n=== Test Failed ===");
    process.exit(1);
  });

  // Timeout
  setTimeout(() => {
    console.log("   ❌ Timeout - no response");
    process.exit(1);
  }, 10000);
}

testSocketAuth().catch(console.error);
