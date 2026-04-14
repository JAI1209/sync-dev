# SyncDev RBAC & Security Implementation

## Overview

Complete Role-Based Access Control (RBAC) system with security hardening implemented.

---

## RBAC Roles

| Role | Level | Permissions |
|------|-------|-------------|
| **owner** | 4 | Full control - manage roles, delete room |
| **admin** | 3 | Manage members (except owner), edit files, GitHub ops |
| **editor** | 2 | Create, edit, delete files and folders |
| **viewer** | 1 | Read-only, view room, participate in calls |

---

## Permission Matrix

| Permission | owner | admin | editor | viewer |
|------------|-------|-------|--------|--------|
| VIEW_ROOM | ✅ | ✅ | ✅ | ✅ |
| CREATE_FILES | ✅ | ✅ | ✅ | ❌ |
| EDIT_FILES | ✅ | ✅ | ✅ | ❌ |
| DELETE_FILES | ✅ | ✅ | ✅ | ❌ |
| CREATE_FOLDERS | ✅ | ✅ | ✅ | ❌ |
| RENAME_ITEMS | ✅ | ✅ | ✅ | ❌ |
| MANAGE_ROOM | ✅ | ✅ | ❌ | ❌ |
| INVITE_USERS | ✅ | ✅ | ❌ | ❌ |
| MANAGE_ROLES | ✅ | ❌ | ❌ | ❌ |
| REMOVE_MEMBERS | ✅ | ✅ | ❌ | ❌ |
| PUSH_TO_GITHUB | ✅ | ✅ | ❌ | ❌ |
| CREATE_SNAPSHOT | ✅ | ✅ | ✅ | ❌ |
| RESTORE_SNAPSHOT | ✅ | ✅ | ❌ | ❌ |
| DELETE_SNAPSHOT | ✅ | ✅ | ❌ | ❌ |
| EXECUTE_CODE | ✅ | ✅ | ✅ | ❌ |
| USE_AI_FEATURES | ✅ | ✅ | ✅ | ❌ |

---

## API Endpoints

### RBAC Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/rbac/roles` | GET | Any | List all roles and permissions |
| `/api/rbac/rooms/:roomId/members` | GET | VIEW_ROOM | List room members |
| `/api/rbac/rooms/:roomId/invite` | POST | INVITE_USERS | Invite user by username |
| `/api/rbac/rooms/:roomId/members/:username/role` | PUT | MANAGE_ROLES | Change member role |
| `/api/rbac/rooms/:roomId/members/:username` | DELETE | REMOVE_MEMBERS | Remove member |
| `/api/rbac/rooms/:roomId/transfer-ownership` | POST | owner | Transfer ownership |
| `/api/rbac/rooms/:roomId/my-permissions` | GET | Any | Get current user permissions |

---

## Socket Events (RBAC Protected)

| Event | Permission | Description |
|-------|------------|-------------|
| `join-room` | VIEW_ROOM | Join room with role check |
| `file-change` | EDIT_FILES | Edit file content |
| `create-file` | CREATE_FILES | Create new file |
| `create-folder` | CREATE_FOLDERS | Create new folder |
| `rename-file` | RENAME_ITEMS | Rename file |
| `rename-folder` | RENAME_ITEMS | Rename folder |
| `delete-file` | DELETE_FILES | Delete file |
| `delete-folder` | DELETE_FILES | Delete folder |

---

## Security Features

### Rate Limiting

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Login | 5 requests | 15 minutes |
| Register | 3 requests | 1 hour |
| Forgot Password | 3 requests | 1 hour |
| General API | 60 requests | 1 minute |
| Socket Events | 100 events | 1 minute |

### Input Sanitization
- Removes NoSQL injection operators (`$gt`, `$where`, etc.)
- Trims and validates all inputs
- Blocks keys starting with `$`

### Security Headers
- `X-Frame-Options: DENY` (Clickjacking protection)
- `X-XSS-Protection: 1; mode=block`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Usage Examples

### Invite User
```bash
curl -X POST http://localhost:3000/api/rbac/rooms/ABC123/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"username": "john", "role": "editor"}'
```

### Change Role
```bash
curl -X PUT http://localhost:3000/api/rbac/rooms/ABC123/members/john/role \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"role": "admin"}'
```

### Get My Permissions
```bash
curl http://localhost:3000/api/rbac/rooms/ABC123/my-permissions \
  -H "Authorization: Bearer TOKEN"
```

---

## Database Schema

### RoomMember Collection
```javascript
{
  roomId: String,      // Room identifier
  userId: ObjectId,    // Reference to User
  username: String,    // Denormalized for quick lookup
  role: String,        // owner|admin|editor|viewer
  joinedAt: Date,
  lastActive: Date
}
```

---

## Implementation Notes

1. **Room Creator = Owner**: First user to join a new room becomes owner
2. **Permission Denial**: Returns 403 with required roles listed
3. **Hierarchy**: Can't assign role equal or higher than your own
4. **Owner Protection**: Cannot remove owner or change owner role directly
5. **Auto-cleanup**: Old rate limit entries cleaned every 5 minutes

---

## Testing RBAC

1. Create room (becomes owner)
2. Invite user as viewer
3. Try editing files as viewer (should fail)
4. Promote to editor
5. Edit should now work
6. Try to delete room as editor (should fail - only owner/admin)
