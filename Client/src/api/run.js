import { apiUrl } from "./client";

/** Map Monaco language + filename to server runner language id. */
export function mapRunLanguage(monacoLanguage, fileName) {
  const n = (fileName || "").toLowerCase();
  if (/\.html?$/.test(n)) return "html";
  if (n.endsWith(".tsx")) return "tsx";
  if (n.endsWith(".ts")) return "typescript";
  if (monacoLanguage === "typescriptreact") return "tsx";
  if (monacoLanguage === "typescript") return "typescript";
  return "javascript";
}

/**
 * Run JavaScript or TypeScript in the server sandbox (Node vm).
 * @param {string} code
 * @param {string} language - monaco language id e.g. javascript, typescript
 */
export async function executeCode(code, language) {
  const token = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/execute/run"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ code, language }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.msg || data.message || `Run failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}
