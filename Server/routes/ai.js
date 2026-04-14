/**
 * AI Code Assistant API
 * Provides AI-powered code suggestions using OpenAI/Claude API
 */

const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const { MAX_AI_REQUESTS_PER_HOUR } = require("../config/constants");

const AI_API_KEY = process.env.OPENAI_API_KEY || process.env.CLAUDE_API_KEY || "";
const AI_PROVIDER = process.env.AI_PROVIDER || "openai"; // 'openai' or 'claude'
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

// Simple in-memory rate limiting (use Redis in production)
const rateLimitMap = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const windowStart = now - 3600000; // 1 hour ago
  
  let requests = rateLimitMap.get(userId) || [];
  requests = requests.filter(t => t > windowStart);
  
  if (requests.length >= MAX_AI_REQUESTS_PER_HOUR) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((requests[0] + 3600000 - now) / 1000) };
  }

  requests.push(now);
  rateLimitMap.set(userId, requests);

  return { allowed: true, remaining: MAX_AI_REQUESTS_PER_HOUR - requests.length };
}

// POST /api/ai/ask — Get AI code suggestions
router.post("/ask", authJwt, async (req, res) => {
  const { code, selection, language, prompt } = req.body;
  const userId = req.auth.user.id;
  
  if (!AI_API_KEY) {
    return res.status(503).json({ msg: "AI assistant is not configured" });
  }
  
  // Rate limiting
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return res.status(429).json({ 
      msg: `Rate limit exceeded. Try again in ${rateLimit.resetIn} seconds.`,
      retryAfter: rateLimit.resetIn 
    });
  }
  
  if (!code && !selection) {
    return res.status(400).json({ msg: "Code or selection is required" });
  }
  
  const contextCode = selection || code;
  const fullPrompt = buildPrompt(contextCode, language, prompt);
  
  try {
    let response;
    
    if (AI_PROVIDER === "claude") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": AI_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: AI_MODEL === "gpt-4o-mini" ? "claude-3-haiku-20240307" : AI_MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content: fullPrompt }],
        }),
      });
    } else {
      // OpenAI
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: "You are a helpful coding assistant. Provide concise, accurate code suggestions." },
            { role: "user", content: fullPrompt }
          ],
          max_tokens: 1024,
          temperature: 0.3,
        }),
      });
    }
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error("AI API error:", error);
      return res.status(502).json({ msg: "AI service error", detail: error.error?.message });
    }
    
    const data = await response.json();
    const suggestion = AI_PROVIDER === "claude" 
      ? data.content?.[0]?.text 
      : data.choices?.[0]?.message?.content;
    
    return res.json({
      suggestion,
      remainingRequests: rateLimit.remaining - 1,
      provider: AI_PROVIDER,
    });
    
  } catch (err) {
    console.error("AI assistant error:", err.message);
    return res.status(500).json({ msg: "Failed to get AI suggestion" });
  }
});

// POST /api/ai/explain — Get code explanation
router.post("/explain", authJwt, async (req, res) => {
  const { code, language } = req.body;
  const userId = req.auth.user.id;
  
  if (!AI_API_KEY) {
    return res.status(503).json({ msg: "AI assistant is not configured" });
  }
  
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return res.status(429).json({ 
      msg: `Rate limit exceeded. Try again in ${rateLimit.resetIn} seconds.` 
    });
  }
  
  const prompt = `Explain this ${language || 'code'} in simple terms:\n\n\`\`\`\n${code}\n\`\`\`\n\nProvide a brief explanation of what it does and any key concepts.`;
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: "You are a helpful coding tutor. Explain code clearly and concisely." },
          { role: "user", content: prompt }
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
    });
    
    if (!response.ok) {
      return res.status(502).json({ msg: "AI service error" });
    }
    
    const data = await response.json();
    const explanation = data.choices?.[0]?.message?.content;
    
    return res.json({ explanation, remainingRequests: rateLimit.remaining - 1 });
    
  } catch (err) {
    console.error("AI explain error:", err.message);
    return res.status(500).json({ msg: "Failed to get explanation" });
  }
});

function buildPrompt(code, language, userPrompt) {
  const basePrompt = userPrompt || "Suggest improvements or complete this code";
  return `${basePrompt}

Language: ${language || 'unknown'}

\`\`\`
${code}
\`\`\`

Provide only the code or specific suggestions. Be concise.`;
}

module.exports = router;
