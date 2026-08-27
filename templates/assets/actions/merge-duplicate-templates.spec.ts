import { describe, expect, it, vi } from "vitest";

const assertOrgAdminMock = vi.hoisted(() => vi.fn());
const ForbiddenAuditErrorMock = vi.hoisted(
  () =>
    class ForbiddenAuditError extends Error {
      readonly statusCode = 403;
    },
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  inArray: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: vi.fn(),
  schema: {
    assetTemplates: {
      id: "templates.id",
      ownerEmail: "templates.owner_email",
      orgId: "templates.org_id",
    },
    assetGenerationSessions: { presetId: "sessions.preset_id" },
    assetGenerationRuns: { presetId: "runs.preset_id" },
  },
}));
vi.mock("../server/lib/json.js", () => ({ parseJson: vi.fn() }));
vi.mock("../server/lib/org-admin.js", () => ({
  assertOrgAdmin: assertOrgAdminMock,
  ForbiddenAuditError: ForbiddenAuditErrorMock,
}));

import { listMigrationOrphansForAuditAdmin } from "./merge-duplicate-templates.js";

function dbWithRows(rows: unknown[]) {
  const where = vi.fn(async () => rows);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where })),
    })),
    where,
  };
}

describe("migration orphan reporting", () => {
  it("does not enumerate orphan IDs for a non-admin caller", async () => {
    assertOrgAdminMock.mockRejectedValue(new ForbiddenAuditErrorMock());
    const db = dbWithRows([{ id: "other-org-orphan" }]);

    await expect(listMigrationOrphansForAuditAdmin(db)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("limits an audit admin's orphan report to the active organization", async () => {
    assertOrgAdminMock.mockResolvedValue({ orgId: "org-a" });
    const db = dbWithRows([{ id: "org-a-orphan" }]);

    await expect(listMigrationOrphansForAuditAdmin(db)).resolves.toEqual([
      { id: "org-a-orphan" },
    ]);
    expect(db.where).toHaveBeenCalledWith(
      expect.objectContaining({ op: "and" }),
    );
  });
});
