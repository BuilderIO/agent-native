import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { putOrgSetting } from "@agent-native/core/settings";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import { ORGANIZATION_BIGQUERY_DBT_SETTING_KEY } from "../server/lib/org-bigquery-dbt.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("./discover-bigquery-table-schema.js", () => ({
  default: { run: mocks.discover },
}));
vi.mock("../server/lib/org-bigquery-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/org-bigquery-dbt.js")
  >()),
  readDbtServiceToken: async () => "service-token-fixture",
}));
vi.mock("../server/lib/warehouse-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/warehouse-dbt.js")>()),
  readDbtTableMetadataWithToken: mocks.provider,
}));
const { default: metadata } =
  await import("./get-organization-bigquery-dbt-metadata.js");

let tempDir: string | undefined;
afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

it("report 478: a non-curator member reads enabled dbt metadata without a 403", async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-dbt-478-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-test','Fixture','owner@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-test','org-test','member@example.test','member',1)`,
  );
  const request = <T>(run: () => Promise<T>) =>
    runWithRequestContext(
      { orgId: "org-test", userEmail: "member@example.test" },
      run,
    );
  await request(() =>
    putOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
      revision: 8,
      config: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtCloudHostname: "cloud.getdbt.com",
        dbtEnvironmentId: "42",
      },
    }),
  );
  mocks.discover.mockResolvedValue({
    projectId: "data-project",
    datasetId: "analytics",
    tableName: "orders",
  });
  const provided = {
    uniqueId: "model.analytics.orders",
    resourceType: "model",
    name: "orders",
    description: null,
    columns: [],
    lastRefreshed: null,
    freshness: null,
    freshnessCriteria: null,
    tests: [],
    parents: [],
    docsUrl: null,
    runUrl: null,
  };
  mocks.provider.mockResolvedValue(provided);

  const result = await request(() =>
    metadata.run(
      { tableReference: "data-project.analytics.orders" },
      {} as never,
    ),
  );

  expect(result).toMatchObject({
    dbtEnabled: true,
    dbtRevision: 8,
    tableIdentity: {
      projectId: "data-project",
      datasetId: "analytics",
      tableId: "orders",
    },
  });
  expect(mocks.discover).toHaveBeenCalledOnce();
});
