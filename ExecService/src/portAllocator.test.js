import { describe, it, expect, vi } from "vitest";
vi.mock("ioredis", () => {
  const reserved = new Set();
  return { default: vi.fn(() => ({
    sismember: vi.fn(async (_, p) => (reserved.has(Number(p)) ? 1 : 0)),
    sadd: vi.fn(async (_, p) => { if (reserved.has(Number(p))) return 0; reserved.add(Number(p)); return 1; }),
    srem: vi.fn(async (_, p) => { reserved.delete(Number(p)); return 1; }),
  })) };
});
vi.mock("net", () => ({ createServer: vi.fn(() => { const l={}; const s={ once:(e,f)=>(l[e]=f,s), listen:()=>(l.listening?.(),s), close:(cb)=>cb?.() }; return s; }) }));
const { allocatePort, releasePort } = await import("./portAllocator.js");
describe("portAllocator", () => {
  it("allocates", async () => { const p = await allocatePort(); expect(p).toBeGreaterThanOrEqual(3001); await releasePort(p); });
});
