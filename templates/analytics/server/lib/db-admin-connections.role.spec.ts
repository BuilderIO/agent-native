import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const state = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  createDbExec: () => ({ execute: state.execute }),
  getDbExec: () => ({ execute: state.execute }),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => null,
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: vi.fn(),
  getAppSecretMeta: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
  getSession: async () => null,
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

const { requireAnalyticsAdminContext } = await import("./db-admin-connections");
const { resolveCredentialSaveScope } = await import("./credential-save-scope");

describe("requireAnalyticsAdminContext", () => {
  it("reports an unreadable role lookup as unavailable, not as a denial", async () => {
    state.execute.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 503,
    });

    state.execute.mockResolvedValueOnce({ rows: [] });
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("organization write authorization", () => {
  it("does not treat an admin pending removal as an admin", async () => {
    const client = await PGlite.create("memory://");
    await client.exec(`CREATE TABLE org_members (
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      federation_removal_pending_at BIGINT
    )`);
    await client.query(
      "INSERT INTO org_members VALUES ('org-1', 'owner@example.com', 'admin', 1)",
    );
    state.execute.mockImplementation(
      (statement: { sql: string; args?: unknown[] }) =>
        client.query(statement.sql, statement.args ?? []),
    );
    const ctx = { userEmail: "owner@example.com", orgId: "org-1" };
    try {
      await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(
        resolveCredentialSaveScope(ctx, "org"),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(resolveCredentialSaveScope(ctx)).resolves.toBe("user");

      await client.query(
        "UPDATE org_members SET federation_removal_pending_at = NULL",
      );
      await expect(resolveCredentialSaveScope(ctx)).resolves.toBe("org");
    } finally {
      state.execute.mockReset();
      await client.close();
    }
  });
});
