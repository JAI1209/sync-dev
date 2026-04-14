# SyncDev Test Scenarios & Bug Report

## Critical Bugs Found

### 🔴 Bug #1: Socket Auth - Token Not Sent on Reconnect
**Location:** `Client/src/pages/Editor.jsx:257`
**Issue:** Socket connects before token is retrieved from localStorage
**Impact:** Users get "Authentication required" on room join

**Fix Required:**
```javascript
// In socket setup useEffect:
const storedToken = localStorage.getItem("token"); // This is synchronous, but token might be expired
```
**Root Cause:** The token is retrieved once at mount time, but if token refreshes during session, socket still uses old token.

---

### 🔴 Bug #2: Dashboard Missing generateRoomId Import
**Location:** `Client/src/pages/Dashboard.jsx:4`
**Issue:** Import exists but let me verify it's used correctly
**Status:** ✅ Fixed already

---

### 🟡 Bug #3: Yjs Dependencies Missing in Client
**Location:** `Client/package.json`
**Issue:** Yjs hook requires yjs and y-protocols packages on client
**Fix:** Add to dependencies

---

### 🟡 Bug #4: Snapshot Route Uses Wrong Utils Path
**Location:** `Server/routes/snapshots.js:10`
**Issue:** `require("../utils/ids")` - this was missing, now fixed
**Status:** ✅ Fixed

---

### 🟡 Bug #5: Server MongoDB Connection Error Handling
**Location:** `Server/server.js:319-328`
**Issue:** If MongoDB fails, server exits. No retry logic.
**Impact:** Production crash on DB hiccup

---

## Test Scenarios

### Auth Flow Tests

#### Test 1: Login Flow
**Steps:**
1. Navigate to `/login`
2. Enter valid credentials
3. Click login

**Expected:**
- Token saved to localStorage
- Redirect to dashboard
- Username displayed

**Actual:**
- ✅ Working

---

#### Test 2: Token Refresh
**Steps:**
1. Login
2. Wait for token to expire (1 hour) OR manually delete token
3. Navigate to protected route

**Expected:**
- Silent re-auth with refresh token
- User stays logged in

**Potential Issue:**
- Refresh token might not trigger properly

---

#### Test 3: Socket Authentication
**Steps:**
1. Login
2. Create/join room
3. Check socket connection

**Expected:**
- Socket connects with auth token
- "user connected" log in server
- Room state received

**Actual Bug:**
- ❌ "Authentication required" error
- Socket disconnects immediately

**Debug Info:**
```
Editor.jsx:375 [Socket] connection failed: Invalid or expired token
```

---

### Room Management Tests

#### Test 4: Create Room
**Steps:**
1. Login
2. Click "Create Room"
3. Check room ID format

**Expected:**
- Room ID uses crypto (not Math.random)
- 8-character alphanumeric
- No ambiguous characters (O, 0, I, 1)

**Status:** ✅ Fixed with ids.js

---

#### Test 5: Room Persistence
**Steps:**
1. Create room
2. Add files/folders
3. Refresh page
4. Rejoin same room

**Expected:**
- Files restored from MongoDB
- Content preserved

**Potential Issues:**
- Room might be empty after rejoin (grace period issue)
- MongoDB save might fail silently

---

### File Operations Tests

#### Test 6: Collaborative Editing (Yjs)
**Steps:**
1. User A joins room
2. User B joins same room
3. Both edit same file

**Expected:**
- Changes sync in real-time
- No conflicts
- Cursors show other users

**Dependencies:**
- Requires yjs and y-protocols on client

---

### API Tests

#### Test 7: AI Assistant
**Steps:**
1. Set OPENAI_API_KEY in .env
2. POST to `/api/ai/ask`
3. Send code snippet

**Expected:**
- 200 response with suggestion
- Rate limit tracked per user

---

#### Test 8: Snapshots
**Steps:**
1. Create room with files
2. POST `/api/snapshots/:roomId` with name
3. GET `/api/snapshots/:roomId`
4. POST `/api/snapshots/:roomId/restore`

**Expected:**
- Snapshot saved
- List returned
- Restore works

---

## Environment Setup for Testing

```bash
# Server .env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/syncdev_test
JWT_SECRET=test_secret_for_testing_only
JWT_EXPIRE=1h
REFRESH_TOKEN_EXPIRE=7d
SMTP_HOST=                    # Leave empty for console logging
OPENAI_API_KEY=sk-test        # Optional

# Client .env
VITE_API_URL=http://localhost:3000
```

## Automated Test Commands

```bash
# 1. Start server with test DB
cd Server
MONGODB_URI=mongodb://localhost:27017/syncdev_test npm start

# 2. Run client
cd Client
npm run dev

# 3. Test login API
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# 4. Test socket auth (requires socket.io-client test script)
# See test-socket.js below
```

## Critical Fix Needed: Socket Auth

The socket connection is failing because the token is invalid. Two possible causes:

1. **Token expired** - Need to refresh before socket connect
2. **Token not in localStorage** - Check token storage after login

Let me check the login flow to ensure tokens are stored correctly.
