/**
 * RBAC (Role-Based Access Control) Middleware
 * Enforces room-level permissions for all operations
 */

const mongoose = require("mongoose");
const RoomMember = require("../models/RoomMember");
const Room = require("../models/Room");

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
  MANAGE_ROLES: ["owner"],                    // Change member roles
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

/**
 * Get or create room membership
 */
async function getMembership(roomId, userId, username) {
  // Validate userId is a valid MongoDB ObjectId string
  if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) {
    console.log(`[RBAC] Invalid userId: ${userId}`);
    return null;
  }

  const userIdObj = new mongoose.Types.ObjectId(userId);

  let member = await RoomMember.findOne({ roomId, userId: userIdObj });

  if (!member) {
    // Check if room exists
    const room = await Room.findOne({ roomId });

    if (!room) {
      // Room doesn't exist, this user will be the owner
      return null; // Let calling code handle ownership assignment
    }

    // Room exists, add as viewer by default
    member = new RoomMember({
      roomId,
      userId: userIdObj,
      username,
      role: "viewer",
    });
    await member.save();
  }

  // Update last active (don't require userId validation for this)
  member.lastActive = new Date();
  await member.save();

  return member;
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

      // Validate userId format
      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        return res.status(400).json({ msg: "Invalid user ID format" });
      }

      const member = await getMembership(roomId, userId, username);

      if (!member) {
        // No membership - check if they're creating a new room
        if (req.method === "POST" && req.path.includes("/snapshots")) {
          // Allow creating snapshots for new rooms (owner will be set)
          req.userRole = "owner";
          return next();
        }
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

      // Validate userId format
      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        return res.status(400).json({ msg: "Invalid user ID format" });
      }

      const member = await getMembership(roomId, userId, username);

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
  const member = await getMembership(roomId, socket.userId, socket.username);

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
  // Validate userId
  if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) {
    throw new Error("Invalid userId for owner assignment");
  }

  const userIdObj = new mongoose.Types.ObjectId(userId);

  try {
    // Bug 3 Fix: Check if owner exists first, don't use upsert with role query
    const existingOwner = await RoomMember.findOne({ roomId, role: "owner" });
    if (existingOwner) {
      if (existingOwner.userId.toString() === userId) {
        return existingOwner; // This user is already owner
      }
      throw new Error("Room already has an owner");
    }

    // No owner exists, create one
    const member = new RoomMember({
      roomId,
      userId: userIdObj,
      username,
      role: "owner",
      joinedAt: new Date()
    });
    await member.save();
    return member;
  } catch (err) {
    // Duplicate key error = another request won the race
    if (err.code === 11000) {
      const existing = await RoomMember.findOne({ roomId, role: "owner" });
      if (existing && existing.userId.toString() === userId) {
        // This user is already the owner
        return existing;
      }
      throw new Error("Room already has an owner");
    }
    throw err;
  }
}

module.exports = {
  hasPermission,
  getMembership,
  requirePermission,
  requireMinRole,
  socketAuthMiddleware,
  checkSocketPermission,
  assignRoomOwner,
  ROLE_HIERARCHY,
  PERMISSIONS,
};
