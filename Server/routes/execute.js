const express = require("express");
const { authJwt } = require("../middleware/authJwt");

const router = express.Router();

router.get("/ping", authJwt, (_req, res) => {
  res.json({ ok: true, executor: "docker" });
});

module.exports = router;
