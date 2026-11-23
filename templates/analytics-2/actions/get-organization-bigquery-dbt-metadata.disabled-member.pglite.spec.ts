import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import { ORGANIZATION_BIGQUERY_DBT_SETTING_KEY } from "../server/lib/org-bigquery-dbt.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import metadata from "./get-organization-bigquery-dbt-metadata.js";

let tempDir: string | undefined;
afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

it("reads absent and disabled dbt for a persisted member while preserving the removed-member denial", async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-dbt-member-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-test','Fixture','member@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-test','org-test','member@example.test','member',1)`,
  );
  const request = <T>(run: () => Promise<T>) =>
    runWithRequestContext(
      { orgId: "org-test", userEmail: "member@example.test" },
      run,
    );
  const read = () =>
    request(() =>
      metadata.run(
        { tableReference: "data-project.analytics.orders" },
        {} as never,
      ),
    );
  const expected = (revision: number | null) => ({
    dbtEnabled: false,
    dbtRevision: revision,
    tableIdentity: null,
    metadata: null,
  });
  await expect(read()).resolves.toEqual(expected(null));
  await request(() =>
    putOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
      revision: 7,
      config: { hasDbtMetadata: false, dbtVersion: "current" },
    }),
  );
  await expect(read()).resolves.toEqual(expected(7));
  await expect(read()).resolves.toEqual(expected(7));
  await request(() =>
    putOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
      revision: 8,
      config: { hasDbtMetadata: true, dbtVersion: "current" },
    }),
  );
  await expect(
    request(() =>
      getOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY),
    ),
  ).resolves.toEqual({
    revision: 8,
    config: { hasDbtMetadata: true, dbtVersion: "current" },
  });
  await getDb().execute(
    sql`UPDATE org_members SET federation_removal_pending_at = 1 WHERE id = 'member-test'`,
  );
  await expect(read()).rejects.toMatchObject({
    errorCode: "workspace_membership_required",
    statusCode: 403,
  });
});
