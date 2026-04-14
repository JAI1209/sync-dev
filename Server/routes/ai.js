const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const aiController = require("../controllers/aiController");
const { validateRequest, aiAskRules, aiExplainRules } = require("../middleware/validate");

router.post("/ask", authJwt, aiAskRules, validateRequest, aiController.ask);
router.post("/explain", authJwt, aiExplainRules, validateRequest, aiController.explain);

module.exports = router;
