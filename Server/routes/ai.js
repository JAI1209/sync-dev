const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const aiController = require("../controllers/aiController");

router.post("/ask", authJwt, aiController.ask);
router.post("/explain", authJwt, aiController.explain);

module.exports = router;
