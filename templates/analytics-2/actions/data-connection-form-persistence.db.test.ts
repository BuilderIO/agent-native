import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { ensureWorkspaceConnectionsTable } from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/credentials")>()),
  saveCredential: async () => {},
  deleteCredential: async () => {},
}));
vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    validateSubmittedServiceAccount: async () => {},
    validateBigQueryProjectAccess: async () => {},
    requestMetadata: async () => ({}),
  }),
);

const {
  saveDataConnection,
  getDataConnectionForm,
  listDataConnections,
  setDefaultDataConnection,
} = await import("../server/model/data-connections.js");
const { getDb } = await import("../server/db/index.js");
const { ensureAnalyticsDatabase } = await import("../server/model/database.js");
const directory = mkdtempSync(join(tmpdir(), "connection-form-sql-"));
const previousDatabase = process.env.DATABASE_URL;
const orgId = randomUUID();
const owner = "form-owner@example.test";
const asOwner = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: owner, authUserId: owner, orgId, isSyntheticTraffic: true },
    call,
  );

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(directory, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], { table: "qa_form_org_migrations" })(
    null,
  );
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA local form",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
});

it("reads saved BigQuery options and the selected default back from SQL", async () => {
  const options = {
    name: "QA persisted form",
    description: "QA saved description",
    projectId: "qa-project",
    additionalProjectIds: "qa-secondary,qa-tertiary",
    driveAccess: true,
    useBQStorageAPI: true,
    customCodeFormatting: true,
    includeForAI: true,
    disableTablePreviews: true,
    canQueryCanRefreshSchema: true,
    sqlFluffConfig: "[sqlfluff]\ndialect = bigquery",
    hasDbtMetadata: false,
    dbtVersion: "current" as const,
    dbtAccountId: "123",
    dbtProjectId: "456",
    dbtEnvironmentId: "789",
    dbtCloudHostname: "cloud.getdbt.com",
    queryAccessGroupIds: [],
    viewAccessGroupIds: [],
  };
  const saved = await asOwner(() =>
    saveDataConnection({
      requestId: randomUUID(),
      type: "bigquery",
      draft: false,
      values: {
        ...options,
        serviceAccount: "{}",
        allowWriteback: true,
        useDbtJdbcDriver: true,
        dbtRequireCertificateVerification: true,
      },
    }),
  );
  const firstRead = await asOwner(() => getDataConnectionForm(saved.id));
  expect(firstRead.values).toEqual(options);
  expect(firstRead.connection.shared).toBe(false);
  expect(firstRead.connection.isDefault).toBe(false);
  const edited = {
    ...options,
    name: "QA edited form",
    description: "QA edited description",
    projectId: "qa-edited-project",
    additionalProjectIds: "qa-edited-secondary",
    driveAccess: false,
    useBQStorageAPI: false,
    customCodeFormatting: false,
    includeForAI: false,
    disableTablePreviews: false,
    canQueryCanRefreshSchema: false,
    sqlFluffConfig: "[sqlfluff]\ndialect = bigquery\nmax_line_length = 90",
    queryAccessGroupIds: ["workspace"],
    viewAccessGroupIds: ["workspace"],
  };
  await asOwner(() =>
    saveDataConnection({
      requestId: randomUUID(),
      id: saved.id,
      type: "bigquery",
      draft: false,
      baseline: firstRead.baseline,
      values: { ...edited, serviceAccount: "{}" },
    }),
  );
  const editedRead = await asOwner(() => getDataConnectionForm(saved.id));
  expect(editedRead.values).toEqual(edited);
  expect(editedRead.connection.shared).toBe(true);
  await asOwner(() => setDefaultDataConnection(saved.id));
  expect(
    (await asOwner(() => getDataConnectionForm(saved.id))).connection.isDefault,
  ).toBe(true);
  expect(
    (await asOwner(() => listDataConnections()))
      .filter((row) => row.isDefault)
      .map((row) => row.id),
  ).toEqual([saved.id]);
  await asOwner(() => setDefaultDataConnection(null));
  expect(
    (await asOwner(() => getDataConnectionForm(saved.id))).connection.isDefault,
  ).toBe(false);
});
