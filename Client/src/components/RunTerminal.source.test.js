import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(cwd(), "src", "components", "RunTerminal.jsx"), "utf8");

describe("RunTerminal source safeguards", () => {
  it("SharedArrayBuffer unavailable sets descriptive error before WebContainer boot", () => {
    expect(source).toContain("SharedArrayBuffer is unavailable");
    expect(source).toContain('typeof SharedArrayBuffer === "undefined"');
  });

  it("shell process exit sets crashed phase and shows restart button", () => {
    expect(source).toContain("shellProc.exit.then");
    expect(source).toContain('setWcPhase("crashed")');
    expect(source).toContain("Restart shell");
  });

  it("server-ready event sets previewUrl and shows preview controls", () => {
    expect(source).toContain('wc.on("server-ready"');
    expect(source).toContain("setPreviewUrl(url)");
    expect(source).toContain("Toggle inline preview");
  });
});
