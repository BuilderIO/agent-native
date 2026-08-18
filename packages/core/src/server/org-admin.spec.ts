import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("./request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import {
  assertCurrentRequestUserIsOrgAdmin,
  currentRequestUserIsOrgAdmin,
} from "./org-admin.js";

describe("currentRequestUserIsOrgAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReturnValue("User@Example.com");
  });

  it.each(["owner", "admin"])("accepts the %s role", async (role) => {
    mocks.execute.mockResolvedValue({ rows: [{ role }] });

    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("FROM org_members"),
      args: ["org-1", "user@example.com"],
    });
  });

  it.each(["member", "", null])("rejects the %s role", async (role) => {
    mocks.execute.mockResolvedValue({ rows: role ? [{ role }] : [] });
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("fails closed without request identity or when the lookup fails", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);

    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.execute.mockRejectedValue(new Error("database unavailable"));
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("provides an assertion helper", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ role: "member" }] });
    await expect(assertCurrentRequestUserIsOrgAdmin()).rejects.toThrow(
      "Only organization owners and admins",
    );
  });
});
