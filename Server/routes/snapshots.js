const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const { requirePermission } = require("../middleware/rbac");
const snapshotController = require("../controllers/snapshotController");
const { validateRequest, snapshotCreateRules, snapshotRestoreRules } = require("../middleware/validate");

router.get("/:roomId", authJwt, requirePermission("VIEW_ROOM"), snapshotController.listSnapshots);
router.post(
  "/:roomId",
  authJwt,
  requirePermission("CREATE_SNAPSHOT"),
  snapshotCreateRules,
  validateRequest,
  snapshotController.createSnapshot
);
router.post(
  "/:roomId/restore",
  authJwt,
  requirePermission("RESTORE_SNAPSHOT"),
  snapshotRestoreRules,
  validateRequest,
  snapshotController.restoreSnapshot
);
router.delete("/:roomId/:snapshotId", authJwt, requirePermission("DELETE_SNAPSHOT"), snapshotController.deleteSnapshot);

module.exports = router;
