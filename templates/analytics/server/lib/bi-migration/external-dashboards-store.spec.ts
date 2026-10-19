import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const state = vi.hoisted(() => ({
  orgId: "org-1" as string | null,
  userEmail: "alice@example.com" as string | null,
}));
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => state.orgId,
  getRequestUserEmail: () => state.userEmail,
}));

vi.mock("../../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../../db/schema.js")>(
      "../../db/schema.js",
    );
  return { getDb: getDbMock, schema };
});

import * as dbModule from "../../db/index.js";
import * as store from "./external-dashboards-store.js";

describe("external dashboard migration store", () => {
  it("stores only the diagnostic limit while retaining the total flagged count", () => {
    const diagnostics = Array.from({ length: 21 }, (_, index) => ({
      id: `element-${index}`,
      name: `Element ${index}`,
      status: "red" as const,
      reason: "manual_review_required" as const,
    }));

    expect(store.boundExternalDashboardDiagnostics(diagnostics)).toEqual({
      elementDiagnostics: diagnostics.slice(
        0,
        store.EXTERNAL_DASHBOARD_DIAGNOSTIC_LIMIT,
      ),
      flaggedCount: 21,
    });
  });

  type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    getDbMock.mockReset();
    getDbMock.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    state.orgId = "org-1";
    state.userEmail = "alice@example.com";
    for (const statement of store.EXTERNAL_DASHBOARD_MIGRATION_SQL) {
      await client.exec(statement);
    }
    for (const statement of store.EXTERNAL_DASHBOARD_MIGRATION_SQL) {
      await client.exec(statement);
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("upserts bounded source metadata and scopes status joins to the active org", async () => {
    const created = await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_1",
      sourceName: "Revenue",
      sourceUpdatedAt: "2026-10-13T12:00:00.000Z",
    });
    expect(created).toMatchObject({
      provider: "sigma",
      sourceId: "workbook_1",
      status: "not_started",
    });

    const firstClaim = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_1",
    });
    expect(firstClaim.claimed).toBe(true);
    if (!firstClaim.claimed) throw new Error("expected migration claim");
    await store.completeExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_1",
      claimToken: firstClaim.claimToken,
      targetDashboardId: "native-dashboard-1",
      elementDiagnostics: [
        {
          id: "element_1",
          name: "Revenue by month",
          status: "yellow",
          reason: "manual_review_required",
        },
      ],
      flaggedCount: 3,
    });

    const refreshed = await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_1",
      sourceName: "Revenue dashboard",
    });
    expect(refreshed).toMatchObject({
      status: "migrated",
      targetDashboardId: "native-dashboard-1",
      sourceName: "Revenue dashboard",
      sourceUpdatedAt: "2026-10-13T12:00:00.000Z",
      flaggedCount: 3,
    });

    expect(
      await store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_1", "workbook_2"],
      }),
    ).toMatchObject([
      {
        provider: "sigma",
        sourceId: "workbook_1",
        status: "migrated",
        elementDiagnostics: [
          {
            id: "element_1",
            name: "Revenue by month",
            status: "yellow",
            reason: "manual_review_required",
          },
        ],
      },
    ]);

    state.orgId = "org-2";
    expect(
      await store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_1"],
      }),
    ).toEqual([]);

    state.orgId = "org-1";
    state.userEmail = "bob@example.com";
    expect(
      await store.listExternalDashboards({ provider: "sigma" }),
    ).toMatchObject([
      {
        sourceId: "workbook_1",
        status: "migrated",
        migratedByCurrentUser: false,
        // Teammates see where it landed so they open it instead of importing.
        targetDashboardId: "native-dashboard-1",
        migratedByEmail: "alice@example.com",
      },
    ]);
  });

  it("tells a teammate a source is already migrated instead of refusing them", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_teammate",
    });
    const claim = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_teammate",
    });
    if (!claim.claimed) throw new Error("expected migration claim");

    state.userEmail = "bob@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_teammate"],
      }),
    ).resolves.toMatchObject([
      {
        status: "migrating",
        migratedByEmail: "alice@example.com",
        targetDashboardId: null,
      },
    ]);

    state.userEmail = "alice@example.com";
    await store.completeExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_teammate",
      claimToken: claim.claimToken,
      targetDashboardId: "native-dashboard-teammate",
      elementDiagnostics: [],
      flaggedCount: 0,
    });

    state.userEmail = "bob@example.com";
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_teammate",
      }),
    ).resolves.toEqual({ claimed: false, reason: "already_migrated" });
  });

  it("lets a teammate retry a failed import, but only the migrator re-imports", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_2",
    });
    const first = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_2",
    });
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error("expected migration claim");

    const failed = await store.failExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_2",
      claimToken: first.claimToken,
      failureCode: "provider_unavailable",
      providerStatus: 503,
    });
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "provider_unavailable",
      providerStatus: 503,
    });

    state.userEmail = "bob@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_2"],
      }),
    ).resolves.toMatchObject([{ canStartImport: true }]);
    const retry = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_2",
    });
    expect(retry.claimed).toBe(true);
    if (!retry.claimed) throw new Error("expected retry claim");
    await expect(
      store.completeExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_2",
        claimToken: retry.claimToken,
        targetDashboardId: "native-dashboard-2",
        elementDiagnostics: [],
        flaggedCount: 0,
      }),
    ).resolves.toMatchObject({ migratedByEmail: "bob@example.com" });

    state.userEmail = "alice@example.com";
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_2",
        remigrate: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "original_migrator_required",
      statusCode: 403,
    });

    state.userEmail = "bob@example.com";
    expect(
      await store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_2",
      }),
    ).toMatchObject({ claimed: false, reason: "already_migrated" });
    expect(
      await store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_2",
        remigrate: true,
      }),
    ).toMatchObject({ claimed: true });
  });

  it("preserves a successful import when remigration fails before dashboard writes", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_remigrate",
    });
    const initialClaim = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_remigrate",
    });
    if (!initialClaim.claimed) throw new Error("expected initial claim");
    await store.completeExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_remigrate",
      claimToken: initialClaim.claimToken,
      targetDashboardId: "native-dashboard-remigrate",
      elementDiagnostics: [],
      flaggedCount: 0,
    });
    const [beforeRemigration] = await store.listExternalDashboards({
      provider: "sigma",
      sourceIds: ["workbook_remigrate"],
    });

    const remigrationClaim = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_remigrate",
      remigrate: true,
    });
    if (!remigrationClaim.claimed)
      throw new Error("expected remigration claim");
    const failedAttempt = await store.failExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_remigrate",
      claimToken: remigrationClaim.claimToken,
      failureCode: "dashboard_write_failed",
      preservePreviousMigration: true,
    });

    expect(failedAttempt).toMatchObject({
      status: "migrated",
      targetDashboardId: "native-dashboard-remigrate",
      migratedAt: beforeRemigration?.migratedAt,
      failureCode: null,
      providerStatus: null,
    });
  });

  it("recovers stale claims after ten minutes and fences the previous claimant token", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_3",
    });
    const first = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_3",
    });
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error("expected migration claim");

    const staleAt = new Date(
      Date.now() - store.EXTERNAL_DASHBOARD_CLAIM_STALE_AFTER_MS - 1000,
    ).toISOString();
    await client.query(
      `UPDATE bi_migration_external_dashboards
       SET migration_claimed_at = $1
       WHERE org_id = $2 AND provider = $3 AND source_id = $4`,
      [staleAt, "org-1", "sigma", "workbook_3"],
    );
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_3"],
      }),
    ).resolves.toMatchObject([{ canRetryStaleClaim: true }]);

    // A teammate may take over a stuck first import.
    state.userEmail = "bob@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_3"],
      }),
    ).resolves.toMatchObject([{ canRetryStaleClaim: true }]);

    const recovered = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_3",
    });
    expect(recovered.claimed).toBe(true);
    if (!recovered.claimed) throw new Error("expected stale claim recovery");
    expect(recovered.claimToken).not.toBe(first.claimToken);

    state.userEmail = "alice@example.com";
    await expect(
      store.completeExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_3",
        claimToken: first.claimToken,
        targetDashboardId: "stale-dashboard",
        elementDiagnostics: [],
        flaggedCount: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    state.userEmail = "bob@example.com";
    await expect(
      store.completeExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_3",
        claimToken: recovered.claimToken,
        targetDashboardId: "native-dashboard-3",
        elementDiagnostics: [],
        flaggedCount: 0,
      }),
    ).resolves.toMatchObject({ status: "migrated" });
  });

  it("keeps a failed re-import with its migrator", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_5",
    });
    const first = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_5",
    });
    if (!first.claimed) throw new Error("expected migration claim");
    await store.completeExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_5",
      claimToken: first.claimToken,
      targetDashboardId: "native-dashboard-5",
      elementDiagnostics: [],
      flaggedCount: 0,
    });
    const reimport = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_5",
      remigrate: true,
    });
    if (!reimport.claimed) throw new Error("expected re-import claim");
    // The re-import wrote over the dashboard, then failed verification.
    await store.failExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_5",
      claimToken: reimport.claimToken,
      failureCode: "verification_failed",
      preservePreviousMigration: false,
    });

    state.userEmail = "bob@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_5"],
      }),
    ).resolves.toMatchObject([{ status: "failed", canStartImport: false }]);
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_5",
      }),
    ).rejects.toMatchObject({
      errorCode: "original_migrator_required",
      statusCode: 403,
    });

    state.userEmail = "alice@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_5"],
      }),
    ).resolves.toMatchObject([{ canStartImport: true }]);
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_5",
      }),
    ).resolves.toMatchObject({ claimed: true });
  });

  it("keeps a stuck re-import with its migrator", async () => {
    await store.createExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_4",
    });
    const first = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_4",
    });
    if (!first.claimed) throw new Error("expected migration claim");
    await store.completeExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_4",
      claimToken: first.claimToken,
      targetDashboardId: "native-dashboard-4",
      elementDiagnostics: [],
      flaggedCount: 0,
    });
    const reimport = await store.claimExternalDashboard({
      provider: "sigma",
      sourceId: "workbook_4",
      remigrate: true,
    });
    expect(reimport.claimed).toBe(true);
    const staleAt = new Date(
      Date.now() - store.EXTERNAL_DASHBOARD_CLAIM_STALE_AFTER_MS - 1000,
    ).toISOString();
    await client.query(
      `UPDATE bi_migration_external_dashboards
       SET migration_claimed_at = $1
       WHERE org_id = $2 AND provider = $3 AND source_id = $4`,
      [staleAt, "org-1", "sigma", "workbook_4"],
    );

    state.userEmail = "bob@example.com";
    await expect(
      store.listExternalDashboards({
        provider: "sigma",
        sourceIds: ["workbook_4"],
      }),
    ).resolves.toMatchObject([{ canRetryStaleClaim: false }]);
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_4",
      }),
    ).resolves.toEqual({ claimed: false, reason: "in_progress" });

    state.userEmail = "alice@example.com";
    await expect(
      store.claimExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_4",
        remigrate: true,
      }),
    ).resolves.toMatchObject({ claimed: true });
  });

  it("requires an authenticated user and active organization", async () => {
    state.userEmail = null;
    await expect(store.listExternalDashboards()).rejects.toMatchObject({
      statusCode: 401,
    });

    state.userEmail = "alice@example.com";
    state.orgId = null;
    await expect(
      store.createExternalDashboard({
        provider: "sigma",
        sourceId: "workbook_4",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
