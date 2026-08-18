import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  registerShareableResource: vi.fn(),
}));

vi.mock("../sharing/access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sharing/access.js")>();
  return {
    ...actual,
    accessFilter: vi.fn(() => ({ getSQL: () => ({}) })),
    assertAccess: mocks.assertAccess,
  };
});

vi.mock("../sharing/registry.js", () => ({
  registerShareableResource: mocks.registerShareableResource,
}));

import { createDashboardStorageSchema } from "./schema.js";
import {
  createDashboardStorage,
  DashboardStorageConflictError,
} from "./store.js";

function row(updatedAt = "2026-07-21T10:00:00.000Z") {
  return {
    id: "dash_1",
    kind: "pipeline",
    title: "Pipeline",
    config: JSON.stringify({ version: 1 }),
    ownerEmail: "owner@example.com",
    orgId: "org_1",
    visibility: "private",
    createdAt: "2026-07-21T09:00:00.000Z",
    updatedAt,
    updatedBy: "owner@example.com",
    archivedAt: null,
  };
}

function fakeDb(options: { updateCount: number }) {
  const selected = [[row()], [row("2026-07-21T11:00:00.000Z")]];
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    update: () => ({
      set: () => ({
        where: async () => ({ rowsAffected: options.updateCount }),
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        inserted.push(value);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selected.shift() ?? [],
        }),
      }),
    }),
    transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
  };
  return { db, inserted };
}

function storage(db: any) {
  return createDashboardStorage<"pipeline", { version: 1 }>({
    schema: createDashboardStorageSchema({
      dashboardsTable: "test_dashboards",
      revisionsTable: "test_dashboard_revisions",
      sharesTable: "test_dashboard_shares",
    }),
    getDb: () => db,
    resourceType: "test-dashboard",
    validateKind: (kind): kind is "pipeline" => kind === "pipeline",
    allowPublic: false,
    requireOrgMemberForUserShares: true,
  });
}

describe("dashboard storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the conditional update and revision snapshot in one transaction", async () => {
    const fake = fakeDb({ updateCount: 1 });
    const result = await storage(fake.db).write(
      {
        id: "dash_1",
        kind: "pipeline",
        title: "Pipeline by stage",
        config: { version: 1 },
        expectedUpdatedAt: "2026-07-21T10:00:00.000Z",
      },
      { userEmail: "owner@example.com", orgId: "org_1" },
    );

    expect(result.updatedAt).toBe("2026-07-21T11:00:00.000Z");
    expect(fake.db.transaction).toHaveBeenCalledOnce();
    expect(fake.inserted).toEqual([
      expect.objectContaining({
        dashboardId: "dash_1",
        title: "Pipeline",
        ownerEmail: "owner@example.com",
      }),
    ]);
  });

  it("fails a lost compare-and-swap without recording a revision", async () => {
    const fake = fakeDb({ updateCount: 0 });
    await expect(
      storage(fake.db).write(
        {
          id: "dash_1",
          kind: "pipeline",
          title: "Stale save",
          config: { version: 1 },
          expectedUpdatedAt: "2026-07-21T10:00:00.000Z",
        },
        { userEmail: "owner@example.com", orgId: "org_1" },
      ),
    ).rejects.toBeInstanceOf(DashboardStorageConflictError);
    expect(fake.inserted).toEqual([]);
  });

  it("registers the per-app resource policy", () => {
    const fake = fakeDb({ updateCount: 1 });
    storage(fake.db).registerShareable();
    expect(mocks.registerShareableResource).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "test-dashboard",
        allowPublic: false,
        requireOrgMemberForUserShares: true,
      }),
    );
  });
});
