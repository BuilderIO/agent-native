import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { readAppSecret } from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
  revokeWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { PostgresConnectionConfig } from "../server/execution/postgres-connector.js";

const validation = vi.hoisted(() => ({
  reject: true,
  calls: 0,
  postgresEnabled: false,
  postgresError: "",
  postgresCalls: 0,
  postgresCa: undefined as string | undefined,
}));
vi.mock("../server/model/bigquery-credential-validation.js", () => ({
  createBigQueryCredentialValidator: () => async () => {
    validation.calls += 1;
    if (validation.reject) throw new Error("Rejected fixture credential");
  },
}));
vi.mock("@agent-native/core/provider-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/provider-api")>()),
  createProviderApiRuntime: () => ({
    executeRequest: async ({ path }: { path: string }) => {
      if (path.endsWith("/datasets/analytics/tables"))
        return {
          response: {
            ok: true,
            status: 200,
            json: { kind: "bigquery#tableList" },
          },
        };
      if (path.endsWith("/datasets/no_such_dataset/tables"))
        return {
          response: {
            ok: false,
            status: 404,
            json: { error: { errors: [{ reason: "notFound" }] } },
          },
        };
      if (path.endsWith("/datasets/no_access_dataset/tables"))
        return {
          response: {
            ok: false,
            status: 403,
            json: { error: { errors: [{ reason: "accessDenied" }] } },
          },
        };
      throw new Error("Unexpected provider route.");
    },
  }),
}));
vi.mock(
  "../server/execution/postgres-connector.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/execution/postgres-connector.js")
    >()),
    isPostgresProviderEnabled: () => validation.postgresEnabled,
    postgresEndpointAuthority: () => "fixture-authority",
    createPostgresConnector: (config: PostgresConnectionConfig) => ({
      validate: async () => {
        validation.postgresCalls++;
        validation.postgresCa = config.caCertificate;
        if (validation.postgresError) throw new Error(validation.postgresError);
        return { checkedSchemas: 2 };
      },
    }),
  }),
);

import { getDb } from "../server/db/index.js";
import {
  assertConnectionResultsAccess,
  canReadConnectionResults,
  resolveNotebookWarehouseConnection,
} from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { resolveNotebookPostgresConnection } from "../server/model/postgres-connection.js";
import { createProject } from "../server/model/projects-store.js";
import { recordRun } from "../server/model/runs-store.js";
import { createWorkspaceWarehouseActions } from "../server/model/workspace-warehouse-connection.js";
import {
  postgresConnectionCreateSchema,
  postgresConnectionUpdateSchema,
} from "../shared/postgres-connection-form.js";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "../shared/workspace-warehouse-form.js";
import createForm from "./create-workspace-warehouse-form.js";
import getForm from "./get-data-connection-form.js";
import getProject from "./get-project.js";
import recover from "./get-workspace-warehouse-connection-operation.js";
import listSchemas from "./list-data-connection-schemas.js";
import testConnection from "./test-data-connection.js";
import updateForm from "./update-workspace-warehouse-form.js";

const folder = mkdtempSync(join(tmpdir(), "qa-warehouse-rejection-"));
const previousDatabase = process.env.DATABASE_URL;
const previousEncryption = process.env.SECRETS_ENCRYPTION_KEY;
const orgId = `qa-rejection-${randomUUID()}`;
const owner = "credential-owner@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};
const asActor = <T>(run: () => T) =>
  runWithRequestContext(
    { userEmail: owner, orgId, authUserId: owner, isSyntheticTraffic: true },
    run,
  );

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(folder, "database")}`;
  process.env.SECRETS_ENCRYPTION_KEY = "warehouse-rejection-fixture";
  const migrations = ORG_MIGRATIONS.map((migration) => ({
    version: migration.version,
    sql: migration.sql,
    ...(migration.name === undefined ? {} : { name: migration.name }),
  }));
  await runMigrations(migrations, {
    table: "qa_rejection_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await readAppSecret({ key: "unused-fixture", scope: "org", scopeId: orgId });
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA rejection workspace",
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
}, 120000);

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  if (previousEncryption === undefined)
    delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = previousEncryption;
  rmSync(folder, { recursive: true, force: true });
});

async function persistedCounts() {
  const counts: number[] = [];
  for (const table of [
    "workspace_connections",
    "workspace_connection_grants",
    "app_secrets",
  ]) {
    const result = await getDbExec().execute(
      sql`SELECT count(*)::int AS n FROM ${sql.ident(table)}`,
    );
    counts.push(Number(result.rows[0]?.n));
  }
  return counts;
}

it("rejects through the actual create action without publishing a connection, grant or secret, then permits a corrected retry", async () => {
  const input = workspaceWarehouseFormInput(
    workspaceWarehouseFormSchema.parse({
      requestId: randomUUID(),
      type: "bigquery",
      draft: false,
      values: {
        name: "QA rejection warehouse",
        projectId: "qa-project",
        serviceAccount: "flagged-source-credential",
        queryAccessGroupIds: ["workspace"],
        viewAccessGroupIds: ["workspace"],
      },
    }),
  );
  const actions = createWorkspaceWarehouseActions();
  await expect(
    asActor(() => actions.create.run(input, context)),
  ).rejects.toMatchObject({
    errorCode: "workspace_credential_validation_failed",
    statusCode: 400,
  });
  expect(validation.calls).toBe(1);
  expect(await persistedCounts()).toEqual([0, 0, 0]);
  await closeDbExec();
  expect(await persistedCounts()).toEqual([0, 0, 0]);

  validation.reject = false;
  const created = await asActor(() =>
    createWorkspaceWarehouseActions().create.run(input, context),
  );
  expect(created.connectionId).toBeTruthy();
  expect(validation.calls).toBe(2);
  expect(await persistedCounts()).toEqual([1, 1, 2]);
}, 120000);

it("rejects a missing BigQuery dataset without saving the filter and then clears it on cold readback", async () => {
  validation.reject = false;
  const values = {
    name: "QA warehouse with datasets",
    projectId: "qa-project",
    serviceAccount: JSON.stringify({
      client_email: "fake-fixture@example.invalid",
      private_key: "fake-fixture-value",
      project_id: "qa-project",
    }),
    queryAccessGroupIds: ["workspace"],
    viewAccessGroupIds: ["workspace"],
    datasetNames: "analytics",
  };
  const created = await asActor(() =>
    createWorkspaceWarehouseActions().create.run(
      workspaceWarehouseFormInput(
        workspaceWarehouseFormSchema.parse({
          requestId: randomUUID(),
          type: "bigquery",
          draft: false,
          values,
        }),
      ),
      context,
    ),
  );
  const opened = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  if (!opened.nativeRevision) throw new Error("Expected a native connection");
  const resolve = () =>
    asActor(() =>
      resolveNotebookWarehouseConnection(created.connectionId, "frontend"),
    );
  expect(await resolve()).toMatchObject({
    projectId: "qa-project",
    defaultDatasetId: "analytics",
  });

  const update = (datasetNames: string) =>
    asActor(() =>
      updateForm.run(
        {
          connectionId: created.connectionId,
          revision: opened.nativeRevision,
          type: "bigquery",
          draft: false,
          values: { ...values, datasetNames },
        },
        context,
      ),
    );
  await expect(update("no_such_dataset")).rejects.toMatchObject({
    errorCode: "data_connection_dataset_unverified",
    details: { field: "datasetNames", dataset: "no_such_dataset" },
  });
  expect(
    (await asActor(() => getForm.run({ id: created.connectionId }, context)))
      .values.datasetNames,
  ).toBe("analytics");
  await update("");
  await closeDbExec();
  expect(
    (await asActor(() => getForm.run({ id: created.connectionId }, context)))
      .values.datasetNames,
  ).toBe("");
  expect((await resolve()).defaultDatasetId).toBeUndefined();
});

it("returns an exact typed create rejection when one regional dataset lacks access", async () => {
  validation.reject = false;
  const counts = await persistedCounts();
  await expect(
    asActor(() =>
      createForm.run(
        workspaceWarehouseFormSchema.parse({
          requestId: randomUUID(),
          type: "bigquery",
          draft: false,
          values: {
            name: "Regional access fixture",
            projectId: "qa-project",
            serviceAccount: JSON.stringify({
              client_email: "fake-fixture@example.invalid",
              private_key: "fake-fixture-value",
              project_id: "qa-project",
            }),
            queryAccessGroupIds: ["workspace"],
            viewAccessGroupIds: ["workspace"],
            datasetNames: "analytics, no_access_dataset",
          },
        }),
        context,
      ),
    ),
  ).rejects.toMatchObject({
    statusCode: 400,
    errorCode: "data_connection_dataset_unverified",
    message:
      "Dataset no_access_dataset could not be verified. Check its name and access.",
    details: { field: "datasetNames", dataset: "no_access_dataset" },
  });
  expect(await persistedCounts()).toEqual(counts);
});

it("gates Postgres setup, validates before publication, fences credential rotation and denies revoked reads", async () => {
  const caCertificate = "fake-fixture-ca-certificate";
  const input = postgresConnectionCreateSchema.parse({
    type: "postgres",
    requestId: randomUUID(),
    scope: { kind: "workspace" },
    name: "Read-only warehouse fixture",
    description: "Two schemas with identical table names",
    form: {
      host: "sql-reader.example.invalid",
      database: "warehouse_fixture",
      username: "warehouse_reader_fixture",
      tls: "verify-full",
      credential: { kind: "replace", value: "fake-warehouse-fixture-password" },
      caCertificate,
    },
  });
  const schemas = () => asActor(() => listSchemas.run({}, context));
  expect(
    (await schemas()).schemas.find(({ type }) => type === "postgres"),
  ).toMatchObject({ supported: false, sections: [] });
  const test = () =>
    asActor(() =>
      testConnection.run(
        {
          type: input.type,
          testId: input.requestId,
          scope: input.scope,
          form: input.form,
        },
        context,
      ),
    );
  await expect(test()).rejects.toMatchObject({ errorCode: "missing_backing" });
  expect(validation.postgresCalls).toBe(0);

  validation.postgresEnabled = true;
  const exposed = (await schemas()).schemas;
  expect(
    exposed.filter(({ supported }) => supported).map(({ type }) => type),
  ).toEqual(["postgres", "bigquery"]);
  expect(
    exposed
      .find(({ type }) => type === "postgres")
      ?.sections.flatMap(({ fields }) => fields)
      .map(({ label }) => label),
  ).toEqual([
    "Name",
    "Description",
    "Host & port",
    "Port",
    "Database",
    "Type",
    "Username",
    "Password",
    "SSL CA certificate",
    "Include schema data for AI",
  ]);

  validation.postgresError = "warehouse_tls_unverified";
  await expect(test()).rejects.toMatchObject({
    errorCode: "postgres_test_tls_unverified",
    details: { field: "host" },
  });
  validation.postgresError = "warehouse_query_denied";
  await expect(test()).rejects.toMatchObject({
    errorCode: "postgres_test_credentials_denied",
    details: { field: "password" },
  });
  const before = await persistedCounts();
  const create = () => asActor(() => createForm.run(input, context));
  await expect(create()).rejects.toMatchObject({
    errorCode: "workspace_credential_validation_failed",
  });
  expect(await persistedCounts()).toEqual(before);

  validation.postgresError = "";
  await expect(test()).resolves.toMatchObject({
    testId: input.requestId,
    provider: "postgres",
    checkedSchemas: 2,
    catalogAccess: "listed",
  });
  expect(validation.postgresCa).toBe(caCertificate);
  const callsBeforeCreate = validation.postgresCalls;
  const { connectionId } = await create();
  expect(validation.postgresCalls).toBe(callsBeforeCreate + 1);
  expect(validation.postgresCa).toBe(caCertificate);
  await closeDbExec();
  await expect(
    asActor(() =>
      recover.run(
        { operationId: input.requestId, provider: "postgres" },
        context,
      ),
    ),
  ).resolves.toEqual({ connectionId });
  const form = await asActor(() => getForm.run({ id: connectionId }, context));
  expect(form.connection).toMatchObject({
    type: "postgres",
    isDraft: false,
    shared: true,
  });
  expect(form.configuredCredentialFields).toEqual([
    "password",
    "caCertificate",
  ]);
  expect(form.values).toMatchObject({
    database: input.form.database,
    port: 5432,
  });
  expect(JSON.stringify(form)).not.toContain(input.form.credential.value);
  expect(JSON.stringify(form)).not.toContain(caCertificate);
  const source = await asActor(() =>
    resolveNotebookPostgresConnection(connectionId, "frontend"),
  );
  expect(source.config).toMatchObject({
    database: input.form.database,
    password: input.form.credential.value,
    caCertificate,
  });
  expect(source.generation).toBe(`${form.nativeRevision}:fixture-authority:0`);
  await expect(
    asActor(() =>
      testConnection.run(
        {
          type: input.type,
          testId: randomUUID(),
          scope: input.scope,
          connectionId,
          form: {
            ...input.form,
            credential: { kind: "keep" },
            caCertificate: undefined,
          },
        },
        context,
      ),
    ),
  ).resolves.toMatchObject({ provider: "postgres", checkedSchemas: 2 });
  expect(validation.postgresCa).toBe(caCertificate);
  const callsBeforeRetarget = validation.postgresCalls;
  await expect(
    asActor(() =>
      testConnection.run(
        {
          type: input.type,
          testId: randomUUID(),
          scope: input.scope,
          connectionId,
          form: {
            ...input.form,
            host: "second-reader.example.invalid",
            credential: { kind: "keep" },
          },
        },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "postgres_password_required" });
  expect(validation.postgresCalls).toBe(callsBeforeRetarget);

  const rotation = postgresConnectionUpdateSchema.parse({
    ...input,
    connectionId,
    revision: form.nativeRevision,
    requestId: randomUUID(),
    description: "Rotated read-only credential",
    canonicalDescription: {
      description: form.baseline.description,
      revision: form.baseline.annotationRevision,
    },
    form: {
      ...input.form,
      credential: { kind: "replace", value: "fake-rotated-warehouse-password" },
      caCertificate: "fake-rotated-fixture-ca-certificate",
    },
  });
  const rotate = () => asActor(() => updateForm.run(rotation, context));
  await expect(rotate()).resolves.toEqual({ connectionId });
  await expect(rotate()).resolves.toEqual({ connectionId });
  await expect(
    asActor(() =>
      updateForm.run({ ...rotation, name: "Changed intent" }, context),
    ),
  ).rejects.toMatchObject({ errorCode: "data_connection_operation_reused" });
  await expect(
    asActor(() =>
      updateForm.run(
        { ...rotation, form: { ...rotation.form, caCertificate } },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "data_connection_operation_reused" });
  const reopened = await asActor(() =>
    getForm.run({ id: connectionId, requestId: rotation.requestId }, context),
  );
  expect(reopened.connection.description).toBe(rotation.description);
  const current = await asActor(() =>
    resolveNotebookPostgresConnection(connectionId, "frontend"),
  );
  expect(current.generation).not.toBe(source.generation);
  expect(current.config.password).toBe("fake-rotated-warehouse-password");
  expect(current.config.caCertificate).toBe(rotation.form.caCertificate);
  await expect(
    asActor(() => canReadConnectionResults(connectionId)),
  ).resolves.toBe(true);
  const project = await createProject({
    ownerEmail: owner,
    orgId,
    title: "PostgreSQL result",
    cells: [
      {
        kind: "sql",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "SELECT 42",
        resultVariable: "result",
        dataConnectionId: connectionId,
        databaseSchema: null,
        outputResult: true,
      },
    ],
  });
  const cell = project.cells[0];
  if (!cell) throw new Error("The PostgreSQL result fixture is absent");
  await recordRun({
    ownerEmail: owner,
    orgId,
    projectId: project.id,
    cellId: cell.id,
    status: "complete",
    output: {
      type: "table",
      columns: [{ name: "value", type: "number" }],
      rows: [[42]],
      rowCount: 1,
      truncated: false,
    },
  });
  validation.postgresEnabled = false;
  await expect(
    asActor(() => getProject.run({ projectId: project.id }, context)),
  ).rejects.toMatchObject({
    errorCode: "postgres_provider_unavailable",
    statusCode: 503,
  });
  await expect(
    asActor(() => assertConnectionResultsAccess(connectionId, "frontend")),
  ).rejects.toMatchObject({
    errorCode: "postgres_provider_unavailable",
    statusCode: 503,
  });
  await expect(
    asActor(() => canReadConnectionResults(connectionId)),
  ).rejects.toMatchObject({
    errorCode: "postgres_provider_unavailable",
    statusCode: 503,
  });
  validation.postgresEnabled = true;

  await asActor(() =>
    revokeWorkspaceConnectionGrant(connectionId, "analytics-2"),
  );
  await expect(
    asActor(() => resolveNotebookPostgresConnection(connectionId, "frontend")),
  ).rejects.toMatchObject({ errorCode: "data_connection_unavailable" });
  await expect(
    asActor(() => canReadConnectionResults(connectionId)),
  ).resolves.toBe(false);
  await expect(
    asActor(() => assertConnectionResultsAccess(connectionId, "frontend")),
  ).rejects.toMatchObject({
    errorCode: "data_connection_result_access_denied",
    statusCode: 403,
  });
  const deniedProject = await asActor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  expect(deniedProject.outputs[cell.id]?.output).toMatchObject({
    type: "error",
  });
  expect(JSON.stringify(deniedProject.outputs[cell.id])).not.toContain(
    "[[42]]",
  );
  validation.postgresEnabled = false;
});
