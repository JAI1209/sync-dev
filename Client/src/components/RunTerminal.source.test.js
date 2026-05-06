import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(cwd(), "src", "components", "RunTerminal.jsx"), "utf8");

describe("RunTerminal source safeguards", () => {
  it("uses socket-driven Docker execution", () => {
    expect(source).toContain('"run-code"');
    expect(source).toContain('"run-output"');
    expect(source).toContain('"kill-run"');
  });

  it("blocks viewer role from starting runs", () => {
    expect(source).toContain('userRole !== "viewer"');
    expect(source).toContain("Viewer role cannot run code.");
  });
});
