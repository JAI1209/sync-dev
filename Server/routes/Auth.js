const router = require("express").Router();
const authController = require("../controllers/authController");
const {
  validateRequest,
  registerRules,
  loginRules,
  forgotRules,
  resetRules,
} = require("../middleware/validate");

router.post("/google", authController.googleAuth);
router.post("/register", registerRules, validateRequest, authController.register);
router.post("/login", loginRules, validateRequest, authController.login);
router.post("/refresh", authController.refresh);
router.post("/forgot", forgotRules, validateRequest, authController.forgotPassword);
router.post("/reset-password", resetRules, validateRequest, authController.resetPassword);
router.get("/me", authController.getMe);

module.exports = router;
