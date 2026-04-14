const { redis } = require("../config/redis");
const { MAX_AI_REQUESTS_PER_HOUR } = require("../config/constants");
const { logger } = require("../logger");

const AI_API_KEY = process.env.OPENAI_API_KEY || process.env.CLAUDE_API_KEY || "";
const AI_PROVIDER = process.env.AI_PROVIDER || "openai";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

async function checkRateLimit(userId) {
  const key = `ratelimit:ai:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 3600);
  }

  const ttl = await redis.ttl(key);
  if (count > MAX_AI_REQUESTS_PER_HOUR) {
    return { allowed: false, remaining: 0, resetIn: ttl };
  }

  return {
    allowed: true,
    remaining: MAX_AI_REQUESTS_PER_HOUR - count,
    resetIn: ttl,
  };ū
}

function buildPrompt(code, language, userPrompt) {
  const prompt = userPrompt?.trim() || "Suggest improvements or complete this code.";
  const fence = '```';
  return `${prompt}\n\nLanguage: ${language || "unknown"}\n\n${fence}\n${code}\n${fence}\n\nProvide only the code or specific suggestions. Be concise.`;
}

function buildExplainPrompt(code, language) {
  const fence = '```';
  return `Explain this ${language || "code"} in simple terms:\n\n${fence}\n${code}\n${fence}\n\nProvide a brief explanation of what it does and any key concepts.`;
}

async function callAI(prompt, maxTokens = 1024) {
  if (!AI_API_KEY) {
    throw new Error("AI provider is not configured");
  }

  try {
    let response;
    let body;

    if (AI_PROVIDER === "claude") {
      const model = AI_MODEL === "gpt-4o-mini" ? "claude-3-haiku-20240307" : AI_MODEL;
      body = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      };
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": AI_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } else {
      body = {
        model: AI_MODEL,
        messages: [
          { role: "system", content: "You are a helpful coding assistant. Provide concise, accurate code suggestions." },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      };
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      logger.error("AI API error", { provider: AI_PROVIDER, status: response.status, body: errorBody });
      throw new Error(errorBody.error?.message || "AI service error");
    }

    const data = await response.json();
    const result = AI_PROVIDER === "claude"
      ? data.content?.[0]?.text || data.response?.output_text || ""
      : data.choices?.[0]?.message?.content || "";

    return result.trim();
  } catch (err) {
    logger.error("callAI error", { provider: AI_PROVIDER, message: err.message, stack: err.stack });
    throw err;
  }
}

async function ask(userId, code, selection, language, prompt) {
  const rateLimit = await checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return { allowed: false, remaining: 0, resetIn: rateLimit.resetIn };
  }

  const contextCode = selection || code;
  const fullPrompt = buildPrompt(contextCode, language, prompt);
  const suggestion = await callAI(fullPrompt, 1024);

  return {
    allowed: true,
    suggestion,
    remaining: rateLimit.remaining,
    provider: AI_PROVIDER,
  };
}

async function explain(userId, code, language) {
  const rateLimit = await checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return { allowed: false, remaining: 0, resetIn: rateLimit.resetIn };
  }

  const prompt = buildExplainPrompt(code, language);
  const explanation = await callAI(prompt, 512);

  return {
    allowed: true,
    explanation,
    remaining: rateLimit.remaining,
    provider: AI_PROVIDER,
  };
}

module.exports = {
  checkRateLimit,
  buildPrompt,
  buildExplainPrompt,
  callAI,
  ask,
  explain,
};
