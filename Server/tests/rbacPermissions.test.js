import { describe, expect, it } from "vitest";
import { PERMISSIONS, hasPermission } from "../middleware/rbac.js";

describe("RBAC permissions map", () => {
  it("IMPORT_FROM_GITHUB permission exists and includes editor", () => {
    expect(PERMISSIONS.IMPORT_FROM_GITHUB).toContain("editor");
    expect(hasPermission("editor", "IMPORT_FROM_GITHUB")).toBe(true);
  });

  it("permissions.canPushGitHub equivalent is false for editor and viewer", () => {
    expect(hasPermission("editor", "PUSH_TO_GITHUB")).toBe(false);
    expect(hasPermission("viewer", "PUSH_TO_GITHUB")).toBe(false);
  });

  it("admin can manage lower roles but cannot change owner-level role", () => {
    expect(hasPermission("admin", "MANAGE_ROLES")).toBe(true);
    expect(PERMISSIONS.TRANSFER_OWNERSHIP).not.toContain("admin");
  });
});
