import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __testables } = require("../services/githubRepoImport");

describe("githubRepoImport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ghFetchJson omits Authorization header when no GitHub token is available", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });

    await __testables.ghFetchJson("https://api.github.com/repos/example/repo", "");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/example/repo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});
