/**
 * RBAC (Role-Based Access Control) Middleware
 * Enforces room-level permissions for all operations
 */

const mongoose = require("mongoose");
const RoomMember = require("../models/RoomMember");
const Room = require("../models/Room");
const MEMBERSHIP_TOUCH_INTERVAL_MS = 30 * 1000;

// Role hierarchy (higher = more permissions)
const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

// Permission definitions
const PERMISSIONS = {
  // Room management
  MANAGE_ROOM: ["owner", "admin"],           // Delete room, change settings
  INVITE_USERS: ["owner", "admin"],          // Invite new members
  // FIX: Admins can change roles below their own level; route hierarchy checks still block owner/admin targets.
  MANAGE_ROLES: ["owner", "admin"],           // Change member roles
  REMOVE_MEMBERS: ["owner", "admin"],        // Kick members
  MANAGE_MEMBERS: ["owner", "admin"],        // Combined invite/remove
  CHANGE_ROLES: ["owner"],                    // Promote/demote users
  TRANSFER_OWNERSHIP: ["owner"],              // Transfer ownership

  // File operations
  CREATE_FILES: ["owner", "admin", "editor"],
  EDIT_FILES: ["owner", "admin", "editor"],
  DELETE_FILES: ["owner", "admin", "editor"],
  CREATE_FOLDERS: ["owner", "admin", "editor"],
  RENAME_ITEMS: ["owner", "admin", "editor"],
  MOVE_ITEMS: ["owner", "admin", "editor"],

  // Collaboration
  VIEW_ROOM: ["owner", "admin", "editor", "viewer"],
  EXECUTE_CODE: ["owner", "admin", "editor"],
  USE_AI_FEATURES: ["owner", "admin", "editor"],

  // Git operations
  PUSH_TO_GITHUB: ["owner", "admin"],
  // FIX: Bulk GitHub import checks this explicit permission before falling back to CREATE_FILES.
  IMPORT_FROM_GITHUB: ["owner", "admin", "editor"],

  // Snapshots
  CREATE_SNAPSHOT: ["owner", "admin", "editor"],
  RESTORE_SNAPSHOT: ["owner", "admin"],
  DELETE_SNAPSHOT: ["owner", "admin"],
};

/**
 * Check if role has permission
 */
function hasPermission(role, permission) {
  if (!PERMISSIONS[permission]) {
    console.warn(`Unknown permission: ${permission}`);
    return false;
  }
  return PERMISSIONS[permission].includes(role);
}

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "object" && value._id) return toObjectId(value._id);
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    return null;
  }
  return new mongoose.Types.ObjectId(value);
}

function normalizeUsername(username) {
  if (typeof username !== "string") return "anonymous";
  const trimmed = username.trim();
  return trimmed || "anonymous";
}

async function touchMembership(member, username) {
  const now = Date.now();
  const safeUsername = normalizeUsername(username);
  const lastActiveMs = member.lastActive ? new Date(member.lastActive).getTime() : 0;
  const shouldUpdateLastActive = now - lastActiveMs > MEMBERSHIP_TOUCH_INTERVAL_MS;
  const shouldUpdateUsername = safeUsername && member.username !== safeUsername;

  if (!shouldUpdateLastActive && !shouldUpdateUsername) {
    return member;
  }

  const updates = {};
  if (shouldUpdateLastActive) {
    updates.lastActive = new Date(now);
    member.lastActive = updates.lastActive;
  }
  if (shouldUpdateUsername) {
    updates.username = safeUsername;
    member.username = safeUsername;
  }

  await RoomMember.updateOne({ _id: member._id }, { $set: updates });
  return member;
}

/**
 * Get or create room membership
 */
async function getMembership(roomId, userId, username, options = {}) {
  const {
    autoCreate = false,
    defaultRole = "viewer",
    touch = true,
  } = options;

  if (!roomId) return null;

  const userIdObj = toObjectId(userId);
  if (!userIdObj) {
    return null;
  }

  let member = await RoomMember.findOne({ roomId, userId: userIdObj });

  if (!member && autoCreate) {
    const roomExists = await Room.exists({ roomId });
    if (!roomExists) {
      return null;
    }

    try {
      member = await RoomMember.create({
        roomId,
        userId: userIdObj,
        username: normalizeUsername(username),
        role: defaultRole,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      member = await RoomMember.findOne({ roomId, userId: userIdObj });
    }
  }

  if (!member) {
    return null;
  }

  if (touch) {
    return touchMembership(member, username);
  }

  return member;
}

/**
 * Ensure room membership exists during socket join.
 * First member in a room becomes owner; later users can be auto-added as viewers.
 */
async function ensureRoomMembership(roomId, userId, username, options = {}) {
  const { autoCreateViewer = true } = options;
  const userIdObj = toObjectId(userId);
  if (!userIdObj) {
    return null;
  }

  const existing = await getMembership(roomId, userIdObj, username, { touch: true });
  if (existing) {
    return existing;
  }

  const hasOwner = await RoomMember.exists({ roomId, role: "owner" });
  if (!hasOwner) {
    return assignRoomOwner(roomId, userIdObj, username);
  }

  if (!autoCreateViewer) {
    return null;
  }

  try {
    await RoomMember.create({
      roomId,
      userId: userIdObj,
      username: normalizeUsername(username),
      role: "viewer",
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  return getMembership(roomId, userIdObj, username, { touch: true });
}

/**
 * Express middleware - requires specific permission
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const { roomId } = req.params;
      const userId = req.auth?.user?.id;
      const username = req.auth?.user?.username;

      if (!userId) {
        return res.status(401).json({ msg: "Authentication required" });
      }

      if (!toObjectId(userId)) {
        return res.status(400).json({ msg: "Invalid user ID format" });
      }

      const member = await getMembership(roomId, userId, username, { touch: true });

      if (!member) {
        return res.status(403).json({ msg: "Access denied - not a room member" });
      }

      if (!hasPermission(member.role, permission)) {
        return res.status(403).json({
          msg: `Access denied - ${permission} requires ${PERMISSIONS[permission].join(" or ")} role`,
          currentRole: member.role,
          required: PERMISSIONS[permission],
        });
      }

      // Attach role to request for downstream use
      req.userRole = member.role;
      req.roomMembership = member;

      next();
    } catch (err) {
      console.error("RBAC error:", err.message);
      res.status(500).json({ msg: "Permission check failed" });
    }
  };
}

/**
 * Express middleware - requires minimum role level
 */
function requireMinRole(minRole) {
  return async (req, res, next) => {
    try {
      const { roomId } = req.params;
      const userId = req.auth?.user?.id;
      const username = req.auth?.user?.username;

      if (!userId) {
        return res.status(401).json({ msg: "Authentication required" });
      }

      if (!toObjectId(userId)) {
        return res.status(400).json({ msg: "Invalid user ID format" });
      }

      const member = await getMembership(roomId, userId, username, { touch: true });

      if (!member) {
        return res.status(403).json({ msg: "Access denied" });
      }

      const userLevel = ROLE_HIERARCHY[member.role] || 0;
      const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          msg: `Access denied - requires ${minRole} or higher`,
          currentRole: member.role,
        });
      }

      req.userRole = member.role;
      req.roomMembership = member;
      next();
    } catch (err) {
      console.error("RBAC error:", err.message);
      res.status(500).json({ msg: "Permission check failed" });
    }
  };
}

/**
 * Socket.IO middleware - checks permissions for socket events
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    const jwt = require("jsonwebtoken");
    const config = require("../config");
    const decoded = jwt.verify(token, config.jwtSecret);

    socket.auth = decoded;
    socket.userId = decoded.user?.id;
    socket.username = decoded.user?.username;

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
}

/**
 * Socket permission check - for use inside socket handlers
 */
async function checkSocketPermission(socket, roomId, permission) {
  const member = await getMembership(roomId, socket.userId, socket.username, { touch: false });

  if (!member) {
    return { allowed: false, reason: "Not a room member" };
  }

  if (!hasPermission(member.role, permission)) {
    return {
      allowed: false,
      reason: `Requires ${PERMISSIONS[permission].join(" or ")}`,
      currentRole: member.role,
    };
  }

  return { allowed: true, role: member.role, member };
}

/**
 * Assign owner role to room creator
 * Uses atomic upsert to prevent race conditions
 */
async function assignRoomOwner(roomId, userId, username) {
  const userIdObj = toObjectId(userId);
  if (!userIdObj) {
    throw new Error("Invalid userId for owner assignment");
  }

  try {
    const existingOwner = await RoomMember.findOne({ roomId, role: "owner" });
    if (existingOwner) {
      if (existingOwner.userId.equals(userIdObj)) {
        return touchMembership(existingOwner, username);
      }
      throw new Error("Room already has an owner");
    }

    const member = new RoomMember({
      roomId,
      userId: userIdObj,
      username: normalizeUsername(username),
      role: "owner",
      joinedAt: new Date(),
    });
    await member.save();
    return member;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await RoomMember.findOne({ roomId, role: "owner" });
      if (existing && existing.userId.equals(userIdObj)) {
        return touchMembership(existing, username);
      }
      throw new Error("Room already has an owner");
    }
    throw err;
  }
}

module.exports = {
  hasPermission,
  toObjectId,
  getMembership,
  ensureRoomMembership,
  requirePermission,
  requireMinRole,
  socketAuthMiddleware,
  checkSocketPermission,
  assignRoomOwner,
  ROLE_HIERARCHY,
  PERMISSIONS,
};
