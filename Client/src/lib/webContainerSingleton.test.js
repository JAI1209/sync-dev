import { beforeEach, describe, expect, it, vi } from "vitest";

const boot = vi.fn(() => Promise.resolve({ id: "wc" }));

vi.mock("@webcontainer/api", () => ({
  WebContainer: { boot },
}));

describe("webContainerSingleton", () => {
  beforeEach(() => {
    vi.resetModules();
    boot.mockClear();
  });

  it("getWebContainer called twice returns the same boot promise", async () => {
    const { getWebContainer } = await import("./webContainerSingleton");

    const first = getWebContainer();
    const second = getWebContainer();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ id: "wc" });
    expect(boot).toHaveBeenCalledTimes(1);
  });
});
