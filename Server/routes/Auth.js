const router = require("express").Router();
const authController = require("../controllers/authController");

router.post("/google", authController.googleAuth);
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.post("/forgot", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/me", authController.getMe);

module.exports = router;
