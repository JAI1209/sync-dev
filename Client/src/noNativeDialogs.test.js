import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

function collectSourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.(js|jsx)$/.test(entry) ? [path] : [];
  });
}

describe("client native dialog policy", () => {
  it("does not call blocking alert/prompt dialogs anywhere in Client/src", () => {
    const root = join(cwd(), "src");
    const offenders = collectSourceFiles(root)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      // FIX: Leave/end-room now intentionally use confirm() for explicit user confirmation.
      .filter(({ source }) => /\b(alert|prompt)\(/.test(source));

    expect(offenders).toEqual([]);
  });
});
