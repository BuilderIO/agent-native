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
import save from "./save-organization-bigquery-dbt-settings.js";
const mocks = vi.hoisted(() => ({
  writeToken: vi.fn(),
  warehouseWriter: vi.fn(),
}));
vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryCredentials: async () => undefined,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/org-bigquery-dbt.js")
  >()),
  readDbtServiceToken: async () => "stored-dbt-token",
  writeDbtServiceToken: mocks.writeToken,
}));
vi.mock("../server/lib/warehouse-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/warehouse-dbt.js")>()),
  validateDbtConfiguration: async () => undefined,
}));
vi.mock("@agent-native/core/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/credentials")>()),
  saveCredential: mocks.warehouseWriter,
}));
let dir: string | undefined;
afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});
it("commits only dbt config and rolls the real transaction back when the token write fails", async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-dbt-edit-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-test','Fixture','admin@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('admin-test','org-test','admin@example.test','admin',1)`,
  );
  const context = { orgId: "org-test", userEmail: "admin@example.test" };
  const request = <T>(run: () => Promise<T>) =>
    runWithRequestContext(context, run);
  const disabled = { hasDbtMetadata: false, dbtVersion: "current" as const };
  const enabled = {
    hasDbtMetadata: true,
    dbtVersion: "current" as const,
    dbtCloudHostname: "cloud.getdbt.com",
    dbtEnvironmentId: "42",
  };
  const before = { revision: 3, config: disabled };
  await request(() =>
    putOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, before),
  );
  const invoke = (input: unknown) =>
    request(() =>
      save.run(
        save.schema.parse({
          expectedOrgId: context.orgId,
          ...(input as object),
        }),
        {
          caller: "frontend",
          ...context,
        } as never,
      ),
    );
  mocks.writeToken.mockRejectedValue(new Error("Vault write unavailable"));
  await expect(
    invoke({
      dbt: enabled,
      dbtToken: "replacement-dbt-token",
      expectedRevision: 3,
    }),
  ).rejects.toMatchObject({
    errorCode: "dbt_settings_save_failed",
    statusCode: 503,
  });
  await expect(
    request(() =>
      getOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
        bypassCache: true,
      }),
    ),
  ).resolves.toEqual(before);
  expect(mocks.warehouseWriter).not.toHaveBeenCalled();
  mocks.writeToken.mockReset();
  await expect(invoke({ dbt: enabled, expectedRevision: 3 })).resolves.toEqual({
    changed: true,
    dbtEnabled: true,
    dbtRevision: 4,
  });
  await expect(
    request(() =>
      getOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
        bypassCache: true,
      }),
    ),
  ).resolves.toEqual({ revision: 4, config: enabled });
  expect(mocks.writeToken).not.toHaveBeenCalled();
  expect(mocks.warehouseWriter).not.toHaveBeenCalled();
  await expect(
    invoke({ dbt: disabled, expectedRevision: 3 }),
  ).rejects.toMatchObject({
    errorCode: "dbt_configuration_stale",
    statusCode: 409,
  });
  await expect(
    request(() =>
      getOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
        bypassCache: true,
      }),
    ),
  ).resolves.toEqual({ revision: 4, config: enabled });
});
