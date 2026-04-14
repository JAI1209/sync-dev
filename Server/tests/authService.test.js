import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken } from "../services/authService.js";

describe("authService", () => {
  it("hashPassword returns a string longer than the input", async () => {
    const plain = "password123";
    const hashed = await hashPassword(plain);
    expect(typeof hashed).toBe("string");
    expect(hashed.length).toBeGreaterThan(plain.length);
  });

  it("hashPassword result is different from the original password", async () => {
    const plain = "password123";
    const hashed = await hashPassword(plain);
    expect(hashed).not.toBe(plain);
  });

  it("comparePassword returns true for correct password", async () => {
    const plain = "password123";
    const hashed = await hashPassword(plain);
    const result = await comparePassword(plain, hashed);
    expect(result).toBe(true);
  });

  it("comparePassword returns false for wrong password", async () => {
    const plain = "password123";
    const hashed = await hashPassword(plain);
    const result = await comparePassword("wrongpassword", hashed);
    expect(result).toBe(false);
  });

  it("generateAccessToken returns a string containing two dots", () => {
    const token = generateAccessToken({ user: { id: "123", username: "test" } });
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);
  });

  it("generateAccessToken payload contains user.id and user.username", () => {
    const token = generateAccessToken({ user: { id: "123", username: "test" } });
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    expect(decoded.user).toBeDefined();
    expect(decoded.user.id).toBe("123");
    expect(decoded.user.username).toBe("test");
  });

  it("generateRefreshToken payload contains type: refresh", () => {
    const token = generateRefreshToken({ user: { id: "123", username: "test" } });
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    expect(decoded.type).toBe("refresh");
  });
});
