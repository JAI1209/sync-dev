const EXEC_URL = process.env.EXEC_SERVICE_URL || "http://localhost:4000";
const EXEC_SECRET = process.env.EXEC_SERVICE_SECRET || "";

async function streamExec({ roomId, files, command, language, onChunk }) {
  const res = await fetch(`${EXEC_URL}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": EXEC_SECRET,
    },
    body: JSON.stringify({ roomId, files, command, language }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ExecService error ${res.status}: ${text}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") return;
        try {
          onChunk(JSON.parse(raw));
        } catch {
          /* skip malformed SSE events */
        }
      }
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
}

async function destroyRoomContainer(roomId) {
  try {
    await fetch(`${EXEC_URL}/container/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      headers: { "x-internal-secret": EXEC_SECRET },
    });
  } catch (err) {
    console.error(`[ExecService] Failed to destroy container for ${roomId}:`, err.message);
  }
}

module.exports = { streamExec, destroyRoomContainer };
