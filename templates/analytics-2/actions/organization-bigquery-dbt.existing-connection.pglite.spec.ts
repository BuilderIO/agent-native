import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { putOrgSetting } from "@agent-native/core/settings";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import { ORGANIZATION_BIGQUERY_DBT_SETTING_KEY } from "../server/lib/org-bigquery-dbt.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";

const mocks = vi.hoisted(() => ({
  writeToken: vi.fn(),
  setConnection: vi.fn(),
}));
vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryCredentials: async () => undefined,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/org-bigquery-dbt.js")
  >()),
  readDbtServiceToken: async () => "stored-dbt-token",
  getDbtServiceTokenState: async () => ({ tokenConfigured: true }),
  writeDbtServiceToken: mocks.writeToken,
}));
vi.mock("../server/lib/warehouse-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/warehouse-dbt.js")>()),
  validateDbtConfiguration: async () => undefined,
}));
vi.mock(
  "./set-organization-bigquery-connection.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("./set-organization-bigquery-connection.js")
    >()),
    default: { run: mocks.setConnection },
  }),
);
const { default: save } =
  await import("./save-organization-bigquery-dbt-settings.js");
const { default: read } = await import("./get-organization-bigquery-dbt.js");

let dir: string | undefined;
const asUser = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ orgId: "org-test", userEmail: email }, run);

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-dbt-existing-"));
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
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('admin-test','org-test','admin@example.test','admin',1),('member-test','org-test','member@example.test','member',1)`,
  );
  await asUser("admin@example.test", () =>
    putOrgSetting("org-test", ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
      revision: 3,
      config: { hasDbtMetadata: false, dbtVersion: "current" },
    }),
  );
});
afterEach(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const enabled = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtCloudHostname: "cloud.getdbt.com",
  dbtEnvironmentId: "42",
};
const saveEnabled = () =>
  asUser("admin@example.test", () =>
    save.run(
      save.schema.parse({
        dbt: enabled,
        expectedRevision: 3,
        expectedOrgId: "org-test",
      }),
      { caller: "frontend" } as never,
    ),
  );

it("report 479: dbt is added to an existing connection without the service-account key", async () => {
  await expect(saveEnabled()).resolves.toEqual({
    changed: true,
    dbtEnabled: true,
    dbtRevision: 4,
  });
  expect(mocks.setConnection).not.toHaveBeenCalled();
  expect(mocks.writeToken).not.toHaveBeenCalled();
});

it("report QA-1795033090-DBT-INTEGRATION: saved dbt settings read back for the editor and for a member", async () => {
  await saveEnabled();
  await expect(
    asUser("admin@example.test", () =>
      read.run(read.schema.parse({ forEdit: true }), {} as never),
    ),
  ).resolves.toEqual({
    revision: 4,
    config: enabled,
    dbtEnabled: true,
    tokenConfigured: true,
    editOrgId: "org-test",
  });
  const member = await asUser("member@example.test", () =>
    read.run(read.schema.parse({}), {} as never),
  );
  expect(member).toEqual({
    revision: 4,
    config: { hasDbtMetadata: true, dbtVersion: "current" },
    dbtEnabled: true,
    tokenConfigured: false,
  });
  await expect(
    asUser("member@example.test", () =>
      read.run(read.schema.parse({ forEdit: true }), {} as never),
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
});
