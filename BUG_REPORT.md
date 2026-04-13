# SyncDev Bug Report & Fixes

## 🔴 Critical: Socket Auth "Invalid or expired token"

### Root Cause Analysis
The socket authentication is rejecting tokens with "Invalid or expired token" error. Possible causes:

1. **Old token in localStorage** - Token was created before JWT_SECRET was configured
2. **Token format mismatch** - Token payload structure changed
3. **Token actually expired** - 1 hour expiry reached

### Immediate Fix
**Clear browser localStorage and re-login:**
```javascript
// In browser console (F12):
localStorage.clear();
location.reload();
```

Then login again with valid credentials.

### Long-term Fix
Add token validation on dashboard before joining room:

**File:** `Client/src/pages/Dashboard.jsx`
Add token validation check before creating/joining room.

---

## 🟡 Bug: Missing Yjs Client Dependencies

**Issue:** Client uses `useYjsCollab` hook but Yjs packages not in client package.json

**Fix:**
```bash
cd Client
npm install yjs y-protocols
```

Or add to `Client/package.json`:
```json
"dependencies": {
  "yjs": "^13.6.24",
  "y-protocols": "^1.0.6"
}
```

---

## 🟡 Bug: API Error Handling Missing

**Issue:** 401 errors from `/api/auth/me` show as "Uncaught (in promise) Object"

**Fix in Client/src/App.jsx around line 71:**
```javascript
authFetch('/api/auth/me')
  .then(async (r) => {
    if (!r.ok) {
      if (r.status === 401) {
        // Try to refresh token
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          handleLogout();
          return;
        }
      }
      // ...
    }
  })
```

---

## 🟡 Bug: Socket Auto-Reconnect Without Token Refresh

**Issue:** When socket disconnects and reconnects, it uses stale token

**Fix in Client/src/pages/Editor.jsx:**

Replace socket setup with token refresh on reconnect:

```javascript
useEffect(() => {
  const connectSocket = async () => {
    // Try to refresh token before connecting
    let token = getAccessToken();
    if (!token) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        navigate('/login');
        return;
      }
      token = getAccessToken();
    }
    
    const socket = io(SERVER_URL, {
      autoConnect: false,
      auth: { token },
    });
    // ... rest of socket setup
  };
  
  connectSocket();
}, [roomId]);
```

---

## 🟡 Bug: Winston Logger Missing in Client

**Issue:** Server uses winston, but client errors are just console.log

**Status:** Low priority - can use Sentry for production

---

## ✅ Already Fixed

1. ✅ Dashboard room ID generation (ids.js)
2. ✅ Server utils/ids.js created
3. ✅ Socket auth middleware implemented
4. ✅ JWT refresh token endpoint
5. ✅ Room persistence to MongoDB
6. ✅ Password reset flow

---

## Test Results

| Feature | Status | Notes |
|---------|--------|-------|
| Server startup | ✅ | MongoDB connected, port 3000 |
| Client startup | ✅ | Vite on port 5173 |
| Login API | ⚠️ | Need to clear old tokens |
| Socket connect | ❌ | Auth failing - clear tokens to fix |
| Room create/join | ⚠️ | Blocked by socket auth |
| File editing | ⚠️ | Need Yjs deps + working sockets |

---

## Quick Start for Testing

```bash
# 1. Clear all old data
# In browser: localStorage.clear()

# 2. Register new user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"test123"}'

# 3. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# 4. Test with returned token
# Copy token and use in socket connection
```

---

## Required Actions

1. **Immediate:** Clear browser localStorage and re-login
2. **Add:** `npm install yjs y-protocols` in Client
3. **Add:** Socket token refresh logic in Editor.jsx
4. **Test:** Full auth flow end-to-end
