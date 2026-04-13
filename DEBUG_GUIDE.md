# SyncDev Debug Guide

## Quick Start

```bash
# 1. Kill all node processes
taskkill /F /IM node.exe

# 2. Start server
cd Server
npm start

# 3. Wait for "Server running" message (no more restarts!)

# 4. In new terminal, start client
cd Client
npm run dev
```

## Manual Test Checklist

### Test 1: Basic Connectivity
- [ ] Open http://localhost:5173
- [ ] Login with user A
- [ ] Check console shows "[vite] connected"
- [ ] Check server terminal shows user connected

### Test 2: Room Creation
- [ ] Click "Initialize Session"
- [ ] Check you're owner
- [ ] Check file tree shows "main.js"
- [ ] Type in editor, check server shows "file-change received"

### Test 3: Second User Join
- [ ] Open second browser/incognito
- [ ] Login with user B
- [ ] Join same room
- [ ] Check server shows "joined room (role: viewer)"

### Test 4: RBAC - Viewer Restrictions
- [ ] Viewer tries to type
- [ ] Check editor is read-only (no cursor)
- [ ] Check upload button shows "⬆ View Only"
- [ ] Server shows "file-change denied: Requires owner or admin or editor"

### Test 5: Promote to Editor
- [ ] Owner clicks "Manage" in sidebar
- [ ] Change viewer role to "editor"
- [ ] Viewer sees popup: "Role updated: viewer → editor"
- [ ] Viewer can now type
- [ ] Changes sync in real-time

### Test 6: GitHub Import
- [ ] Go to Dashboard
- [ ] Click "Import Repo"
- [ ] Enter: `facebook/react` (or any public repo)
- [ ] Select room
- [ ] Click Import
- [ ] Check console shows:
  - `[Import] Emitting bulk-import: X files, Y folders`
  - `[Socket] Event: bulk-import`
  - `[Import] Success: X files, Y folders`
- [ ] Check file tree shows folders and files
- [ ] Viewer can see all imported files/folders

### Test 7: File Persistence
- [ ] Create new file
- [ ] Refresh page
- [ ] File should still exist

### Test 8: Role Demotion
- [ ] Owner demotes editor back to viewer
- [ ] Editor becomes read-only immediately
- [ ] Upload button disabled

## Common Issues

### Issue: "Server restarting due to changes"
**Fix:** Nodemon is watching test files. Stop server, delete test files from watch:
```bash
cd Server
# Edit nodemon.json or package.json to ignore tests
```

### Issue: "Folders not showing"
**Check:**
1. Server shows `folders: {}` in room-state
2. bulk-import includes folders
3. Client receives `bulk-imported` event

**Debug:**
```javascript
// In browser console:
socket.on('room-state', (state) => console.log('Folders:', state.folders));
socket.on('bulk-imported', (data) => console.log('Imported folders:', data.folders));
```

### Issue: "Import files disappear"
**Check:**
1. Server received bulk-import event
2. Server persisted to MongoDB
3. Other clients received bulk-imported broadcast

### Issue: "Role change not updating UI"
**Check:**
1. Server emitted `role-changed` event
2. Client received `role-changed` event
3. Client updated `userRole` state
4. Monaco editor options updated (`readOnly`)

## Server Debug Logs

Enable verbose logging in `Server/server.js`:

```javascript
// Add at top of connection handler
socket.onAny((event, ...args) => {
  console.log(`[Socket] ${event} from ${socket.username || 'unknown'}`);
});
```

## Client Debug

Add to browser console:

```javascript
// Monitor all socket events
socket.onAny((event, ...args) => {
  console.log(`[Client] ${event}:`, args);
});

// Check current state
console.log('Role:', userRole);
console.log('Files:', files);
console.log('Folders:', folders);
console.log('Socket connected:', socket.connected);
```

## Running Tests

```bash
# Run all tests
node test-runner.js all

# Run specific test
node test-runner.js rbac
```

## Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Login/Auth | ✅ Working | Smooth, no refresh needed |
| Room Creation | ✅ Working | Owner auto-assigned |
| Real-time Sync | ✅ Working | Changes broadcast instantly |
| RBAC - Roles | ✅ Working | 4 roles, permission checks |
| RBAC - View Only | ✅ Working | Viewers can't edit |
| RBAC - Real-time Role Change | ✅ Working | UI updates instantly |
| GitHub Import | ⚠️ Needs Test | Code ready, needs verification |
| Folder Display | ⚠️ Needs Test | Should work, verify in UI |
| File Persistence | ✅ Working | Saved to MongoDB |
| Member Manager | ✅ Working | Invite, manage, remove |

## Support

If tests fail:
1. Check server is running (no restarts)
2. Check MongoDB connected
3. Check both users in same room
4. Check console for errors
5. Run test suite: `node test-runner.js all`
