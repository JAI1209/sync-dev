const { body, param, validationResult } = require("express-validator");

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

const registerRules = [
  body("username").trim().notEmpty().withMessage("Username is required"),
  body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
];

const loginRules = [
  body("username").trim().notEmpty().withMessage("Username is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

const forgotRules = [
  body("email").isEmail().withMessage("Valid email is required"),
];

const resetRules = [
  body("token").notEmpty().withMessage("Token is required"),
  body("email").isEmail().withMessage("Valid email is required"),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
];

const snapshotCreateRules = [
  body("name").trim().notEmpty().withMessage("Snapshot name is required").isLength({ max: 100 }).withMessage("Snapshot name must be 100 characters or fewer"),
];

const snapshotRestoreRules = [
  body("snapshotId").trim().notEmpty().withMessage("Snapshot ID is required"),
];

const aiAskRules = [
  body("code").custom((value, { req }) => {
    if (!req.body.code?.trim() && !req.body.selection?.trim()) {
      throw new Error("Code or selection is required");
    }
    return true;
  }),
];

const aiExplainRules = [
  body("code").trim().notEmpty().withMessage("Code is required"),
];

module.exports = {
  validateRequest,
  registerRules,
  loginRules,
  forgotRules,
  resetRules,
  snapshotCreateRules,
  snapshotRestoreRules,
  aiAskRules,
  aiExplainRules,
};
