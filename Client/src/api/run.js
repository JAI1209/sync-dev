export function mapRunLanguage(monacoLanguage, fileName) {
  const n = (fileName || "").toLowerCase();
  if (/\.html?$/.test(n)) return "html";
  if (n.endsWith(".tsx")) return "tsx";
  if (n.endsWith(".ts")) return "typescript";
  if (n.endsWith(".py")) return "python";
  if (n.endsWith(".sh")) return "shell";
  if (monacoLanguage === "typescript") return "typescript";
  if (monacoLanguage === "typescriptreact") return "tsx";
  if (monacoLanguage === "python") return "python";
  if (monacoLanguage === "shell") return "shell";
  return "javascript";
}
