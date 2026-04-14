/**
 * RBAC Management Routes
 * Role assignment, member management, permission checks
 */

const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const {
  requirePermission,
  requireMinRole,
  getMembership,
  assignRoomOwner,
  hasPermission,
  ROLE_HIERARCHY,
  PERMISSIONS,
} = require("../middleware/rbac");
const RoomMember = require("../models/RoomMember");
const User = require("../models/User");

/**
 * GET /api/rbac/rooms/:roomId/members
 * List all room members with their roles
 */
router.get("/rooms/:roomId/members", authJwt, requirePermission("VIEW_ROOM"), async (req, res) => {
  try {
    const members = await RoomMember.find({ roomId: req.params.roomId })
      .sort({ joinedAt: 1 })
      .select("username role joinedAt lastActive");

    res.json({
      members: members.map((m) => ({
        username: m.username,
        role: m.role,
        joinedAt: m.joinedAt,
        lastActive: m.lastActive,
        isOnline: Date.now() - m.lastActive < 5 * 60 * 1000, // 5 min threshold
      })),
    });
  } catch (err) {
    console.error("List members error:", err.message);
    res.status(500).json({ msg: "Failed to list members" });
  }
});

/**
 * POST /api/rbac/rooms/:roomId/invite
 * Invite a user by username (owner/admin only)
 */
router.post("/rooms/:roomId/invite", authJwt, requirePermission("INVITE_USERS"), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { username, role = "viewer" } = req.body;

    if (!username) {
      return res.status(400).json({ msg: "Username is required" });
    }

    // Validate role
    if (!ROLE_HIERARCHY[role]) {
      return res.status(400).json({ msg: "Invalid role" });
    }

    // Can't invite with higher role than yourself
    const inviterLevel = ROLE_HIERARCHY[req.userRole];
    const targetLevel = ROLE_HIERARCHY[role];
    if (targetLevel >= inviterLevel) {
      return res.status(403).json({ msg: "Cannot assign role equal or higher to your own" });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Check if already member
    const existing = await RoomMember.findOne({ roomId, userId: user._id });
    if (existing) {
      return res.status(409).json({ msg: "User is already a member", currentRole: existing.role });
    }

    // Create membership
    const member = new RoomMember({
      roomId,
      userId: user._id,
      username: user.username,
      role,
    });
    await member.save();

    res.json({
      msg: `Invited ${username} as ${role}`,
      member: {
        username: member.username,
        role: member.role,
        joinedAt: member.joinedAt,
      },
    });
  } catch (err) {
    console.error("Invite error:", err.message);
    res.status(500).json({ msg: "Failed to invite user" });
  }
});

/**
 * PUT /api/rbac/rooms/:roomId/members/:username/role
 * Change a member's role (owner only)
 */
router.put("/rooms/:roomId/members/:username/role", authJwt, requirePermission("MANAGE_ROLES"), async (req, res) => {
  try {
    const { roomId, username } = req.params;
    const { role } = req.body;

    if (!ROLE_HIERARCHY[role]) {
      return res.status(400).json({ msg: "Invalid role" });
    }

    // Cannot change owner's role (must transfer ownership separately)
    const target = await RoomMember.findOne({ roomId, username });
    if (!target) {
      return res.status(404).json({ msg: "Member not found" });
    }

    if (target.role === "owner") {
      return res.status(403).json({ msg: "Cannot change owner's role directly. Transfer ownership instead." });
    }

    // Cannot assign role equal or higher to self
    const changerLevel = ROLE_HIERARCHY[req.userRole];
    const targetLevel = ROLE_HIERARCHY[role];
    if (targetLevel >= changerLevel) {
      return res.status(403).json({ msg: "Cannot assign role equal or higher to your own" });
    }

    const oldRole = target.role;
    target.role = role;
    await target.save();

    // Notify affected user in real-time if they're online
    const io = req.app.get('io');
    if (io) {
      // Find socket of affected user
      const sockets = await io.in(roomId).fetchSockets();
      const targetSocket = sockets.find(s => s.username === username);
      if (targetSocket) {
        targetSocket.emit('role-changed', {
          roomId,
          oldRole,
          newRole: role,
          changedBy: req.auth.user.username,
        });
        // Update their role in socket data
        targetSocket.userRole = role;
      }
      // Also broadcast to all room members that roles changed
      io.to(roomId).emit('members-updated', { roomId });
    }

    res.json({
      msg: `Changed ${username}'s role to ${role}`,
      member: {
        username: target.username,
        role: target.role,
      },
    });
  } catch (err) {
    console.error("Change role error:", err.message);
    res.status(500).json({ msg: "Failed to change role" });
  }
});

/**
 * DELETE /api/rbac/rooms/:roomId/members/:username
 * Remove a member (owner/admin only, cannot remove owner)
 */
router.delete("/rooms/:roomId/members/:username", authJwt, requirePermission("REMOVE_MEMBERS"), async (req, res) => {
  try {
    const { roomId, username } = req.params;

    const target = await RoomMember.findOne({ roomId, username });
    if (!target) {
      return res.status(404).json({ msg: "Member not found" });
    }

    // Cannot remove owner
    if (target.role === "owner") {
      return res.status(403).json({ msg: "Cannot remove room owner" });
    }

    // Cannot remove someone with equal or higher role
    const removerLevel = ROLE_HIERARCHY[req.userRole];
    const targetLevel = ROLE_HIERARCHY[target.role];
    if (targetLevel >= removerLevel) {
      return res.status(403).json({ msg: "Cannot remove member with equal or higher role" });
    }

    await RoomMember.deleteOne({ _id: target._id });

    res.json({ msg: `Removed ${username} from room` });
  } catch (err) {
    console.error("Remove member error:", err.message);
    res.status(500).json({ msg: "Failed to remove member" });
  }
});

/**
 * POST /api/rbac/rooms/:roomId/transfer-ownership
 * Transfer ownership to another member (owner only)
 */
router.post("/rooms/:roomId/transfer-ownership", authJwt, requireMinRole("owner"), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { newOwnerUsername } = req.body;

    if (!newOwnerUsername) {
      return res.status(400).json({ msg: "New owner username is required" });
    }

    // Find new owner
    const newOwner = await RoomMember.findOne({ roomId, username: newOwnerUsername });
    if (!newOwner) {
      return res.status(404).json({ msg: "User is not a room member" });
    }

    // Get current owner
    const currentOwner = await RoomMember.findOne({ roomId, userId: req.auth.user.id });

    // Transfer
    newOwner.role = "owner";
    currentOwner.role = "admin"; // Demote to admin

    await Promise.all([newOwner.save(), currentOwner.save()]);

    res.json({
      msg: `Ownership transferred to ${newOwnerUsername}`,
      previousOwner: currentOwner.username,
      newOwner: newOwner.username,
    });
  } catch (err) {
    console.error("Transfer ownership error:", err.message);
    res.status(500).json({ msg: "Failed to transfer ownership" });
  }
});

/**
 * GET /api/rbac/rooms/:roomId/my-permissions
 * Get current user's permissions for this room
 */
router.get("/rooms/:roomId/my-permissions", authJwt, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.auth.user.id;
    const username = req.auth.user.username;

    const member = await getMembership(roomId, userId, username);

    if (!member) {
      return res.json({
        role: null,
        permissions: [],
        isMember: false,
      });
    }

    // Calculate all permissions for this role
    const permissions = Object.keys(PERMISSIONS).filter((perm) => hasPermission(member.role, perm));

    res.json({
      role: member.role,
      permissions,
      isMember: true,
    });
  } catch (err) {
    console.error("Get permissions error:", err.message);
    res.status(500).json({ msg: "Failed to get permissions" });
  }
});

/**
 * GET /api/rbac/roles
 * List available roles and their permissions
 */
router.get("/roles", authJwt, (req, res) => {
  const roles = {
    owner: {
      level: 4,
      description: "Full control - can delete room, manage all members",
      permissions: Object.keys(PERMISSIONS),
    },
    admin: {
      level: 3,
      description: "Can manage members (except owner), edit files, push to GitHub",
      permissions: Object.keys(PERMISSIONS).filter((p) =>
        !["MANAGE_ROLES", "CHANGE_ROLES", "TRANSFER_OWNERSHIP"].includes(p)
      ),
    },
    editor: {
      level: 2,
      description: "Can create, edit, delete files and folders",
      permissions: Object.keys(PERMISSIONS).filter((p) =>
        ["CREATE_FILES", "EDIT_FILES", "DELETE_FILES", "CREATE_FOLDERS", "RENAME_ITEMS", "MOVE_ITEMS", "VIEW_ROOM", "EXECUTE_CODE", "USE_AI_FEATURES", "IMPORT_FROM_GITHUB", "CREATE_SNAPSHOT"].includes(p)
      ),
    },
    viewer: {
      level: 1,
      description: "Read-only access - can view files and participate in calls",
      permissions: ["VIEW_ROOM"],
    },
  };

  res.json({ roles });
});

module.exports = router;
