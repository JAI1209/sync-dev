const aiService = require("../services/aiService");
const { logger } = require("../logger");

async function ask(req, res) {
  const { code, selection, language, prompt } = req.body;
  const userId = req.auth.user.id;

  if (!code && !selection) {
    return res.status(400).json({ msg: "Code or selection is required" });
  }

  try {
    const result = await aiService.ask(userId, code, selection, language, prompt);
    if (!result.allowed) {
      return res.status(429).json({
        msg: `Rate limit exceeded. Try again in ${result.resetIn} seconds.`,
        retryAfter: result.resetIn,
      });
    }

    return res.status(200).json({
      suggestion: result.suggestion,
      remainingRequests: result.remaining,
      provider: result.provider,
    });
  } catch (err) {
    logger.error("AI ask error", { message: err.message, stack: err.stack });
    if (err.message.includes("not configured")) {
      return res.status(503).json({ msg: "AI assistant is not configured" });
    }
    return res.status(500).json({ msg: "Failed to get AI suggestion" });
  }
}

async function explain(req, res) {
  const { code, language } = req.body;
  const userId = req.auth.user.id;

  if (!code) {
    return res.status(400).json({ msg: "Code is required" });
  }

  try {
    const result = await aiService.explain(userId, code, language);
    if (!result.allowed) {
      return res.status(429).json({
        msg: `Rate limit exceeded. Try again in ${result.resetIn} seconds.`,
        retryAfter: result.resetIn,
      });
    }

    return res.status(200).json({
      explanation: result.explanation,
      remainingRequests: result.remaining,
      provider: result.provider,
    });
  } catch (err) {
    logger.error("AI explain error", { message: err.message, stack: err.stack });
    if (err.message.includes("not configured")) {
      return res.status(503).json({ msg: "AI assistant is not configured" });
    }
    return res.status(500).json({ msg: "Failed to get explanation" });
  }
}

module.exports = {
  ask,
  explain,
};
