import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
  readWorkspaceCredentialProfile,
  resolveWorkspaceConnectionCredentialForApp,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  warehouseKeys: [] as string[][],
  dbtTokens: [] as string[],
  rejectWarehouse: false,
}));
vi.mock("../server/model/bigquery-credential-validation.js", () => ({
  createBigQueryCredentialValidator:
    () =>
    async (input: {
      secretValues: readonly { key: string; secret: string }[];
    }) => {
      state.warehouseKeys.push(input.secretValues.map((v) => v.key));
      if (state.rejectWarehouse)
        throw new Error("Synthetic validation rejection");
      expect(input.secretValues.map((v) => v.key).sort()).toEqual([
        "BIGQUERY_PROJECT_ID",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      ]);
    },
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: async (
    _url: unknown,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => {
    state.dbtTokens.push(init.headers.Authorization!);
    init.signal.throwIfAborted();
    if (init.headers.Authorization === "Token rejected-integration-credential")
      return new Response("rejected", { status: 401 });
    return Response.json({
      data: { environment: { applied: { models: { edges: [] } } } },
    });
  },
}));

import { getDb } from "../server/db/index.js";
import { executeConnectionQuery } from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { workspaceWarehouseActions } from "../server/model/workspace-warehouse-connection.js";
import { WORKSPACE_WAREHOUSE_DBT_TOKEN } from "../shared/workspace-warehouse-dbt.js";
import { workspaceWarehouseEditFormSchema } from "../shared/workspace-warehouse-edit-form.js";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "../shared/workspace-warehouse-form.js";
import getForm from "./get-data-connection-form.js";
import update from "./update-workspace-warehouse-form.js";

const folder = mkdtempSync(join(tmpdir(), "qa-native-dbt-"));
const previous = {
  database: process.env.DATABASE_URL,
  secret: process.env.SECRETS_ENCRYPTION_KEY,
};
const orgId = `qa-native-dbt-${randomUUID()}`,
  owner = "native-dbt-owner@example.test",
  member = "native-dbt-member@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};
const asActor = <T>(job: () => T, email = owner) =>
  runWithRequestContext(
    { userEmail: email, orgId, authUserId: email, isSyntheticTraffic: true },
    job,
  );
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(folder, "database")}`;
  process.env.SECRETS_ENCRYPTION_KEY = "native-dbt-qa-encryption-marker";
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_native_dbt_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA native dbt workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb()
    .insert(orgMembers)
    .values(
      [owner, member].map((email) => ({
        id: randomUUID(),
        orgId,
        email,
        role: email === owner ? ("owner" as const) : ("member" as const),
        joinedAt: Date.now(),
      })),
    );
}, 120000);
afterAll(async () => {
  await closeDbExec();
  if (previous.database === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.database;
  if (previous.secret === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = previous.secret;
  rmSync(folder, { recursive: true, force: true });
});
async function setup() {
  const input = workspaceWarehouseFormSchema.parse({
    requestId: randomUUID(),
    type: "bigquery",
    draft: false,
    values: {
      name: "QA native warehouse",
      projectId: "qa-project",
      serviceAccount: "flagged-source-credential",
      queryAccessGroupIds: ["workspace"],
      viewAccessGroupIds: ["workspace"],
    },
  });
  const created = await asActor(() =>
    workspaceWarehouseActions.create.run(
      workspaceWarehouseFormInput(input),
      context,
    ),
  );
  const opened = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  const revision = opened.nativeRevision;
  if (typeof revision !== "string" || !revision)
    throw new Error("Native fixture did not return an opened revision");
  return { created, opened: { ...opened, nativeRevision: revision } };
}
function edit(id: string, revision: string, token?: string) {
  return workspaceWarehouseEditFormSchema.parse({
    connectionId: id,
    revision,
    type: "bigquery",
    draft: false,
    values: {
      name: "QA native warehouse",
      projectId: "qa-project",
      queryAccessGroupIds: ["workspace"],
      viewAccessGroupIds: ["workspace"],
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: "cloud.getdbt.com",
      dbtEnvironmentId: "9",
      ...(token === undefined ? {} : { dbtToken: token }),
    },
  });
}
it("enables dbt on an existing shared connection without replacing its warehouse key; blank token edits retain its vault value", async () => {
  const { created, opened } = await setup();
  expect(opened.nativeRevision).toBeTruthy();
  await asActor(() =>
    update.run(
      edit(
        created.connectionId,
        opened.nativeRevision,
        "flagged-integration-credential",
      ),
      context,
    ),
  );
  const saved = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(saved.connection.id).toBe(created.connectionId);
  expect(saved.connection.hasDbtMetadata).toBe(true);
  expect(saved.values).toMatchObject({
    hasDbtMetadata: true,
    dbtVersion: "current",
    dbtEnvironmentId: "9",
  });
  expect(saved.configuredCredentialFields).toContain("dbtToken");
  expect(JSON.stringify(saved)).not.toContain("flagged-integration-credential");
  expect(saved.values).not.toHaveProperty("dbtToken");
  await asActor(() =>
    update.run(edit(created.connectionId, saved.nativeRevision!, ""), context),
  );
  const secret = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: created.connectionId,
      key: WORKSPACE_WAREHOUSE_DBT_TOKEN,
    }),
  );
  expect(secret.available).toBe(true);
  expect(secret.value).toBe("flagged-integration-credential");
  const warehouse = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: created.connectionId,
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    }),
  );
  expect(warehouse.value).toBe("flagged-source-credential");
  expect(state.dbtTokens.slice(-2)).toEqual([
    "Token flagged-integration-credential",
    "Token flagged-integration-credential",
  ]);
  const beforeDisable = state.dbtTokens.length;
  const reopened = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  if (!reopened.nativeRevision) throw new Error("Missing native edit revision");
  const disabled = edit(created.connectionId, reopened.nativeRevision);
  disabled.values.hasDbtMetadata = false;
  await asActor(() => update.run(disabled, context));
  expect(state.dbtTokens).toHaveLength(beforeDisable);
  const readDisabled = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(readDisabled.values.hasDbtMetadata).toBe(false);
  expect(readDisabled.connection.hasDbtMetadata).toBe(false);
});
it("preserves typed dbt validation failures on native edit and accepts cleared optional dbt fields", async () => {
  const { created, opened } = await setup();
  await expect(
    asActor(() =>
      update.run(
        edit(
          created.connectionId,
          opened.nativeRevision,
          "rejected-integration-credential",
        ),
        context,
      ),
    ),
  ).rejects.toMatchObject({
    errorCode: "data_dbt_access_denied",
    statusCode: 401,
  });
  const withClearedFields = workspaceWarehouseEditFormSchema.parse({
    connectionId: created.connectionId,
    revision: opened.nativeRevision,
    type: "bigquery",
    draft: false,
    values: {
      name: "QA native warehouse",
      projectId: "qa-project",
      queryAccessGroupIds: ["workspace"],
      viewAccessGroupIds: ["workspace"],
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: "https://metadata.cloud.getdbt.com/graphql",
      dbtEnvironmentId: "9",
      dbtAccountId: "",
      dbtProjectId: "",
      dbtToken: "flagged-integration-credential",
    },
  });
  await asActor(() => update.run(withClearedFields, context));
  const saved = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(saved.connection.hasDbtMetadata).toBe(true);
  expect(saved.values.dbtEnvironmentId).toBe("9");
});
it("rejects provider validation before publishing dbt configuration or a token reference", async () => {
  const { created, opened } = await setup();
  await expect(
    asActor(() =>
      update.run(
        edit(
          created.connectionId,
          opened.nativeRevision,
          "rejected-integration-credential",
        ),
        context,
      ),
    ),
  ).rejects.toThrow();
  const unchanged = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(unchanged.nativeRevision).toBe(opened.nativeRevision);
  expect(unchanged.values.hasDbtMetadata).not.toBe(true);
  expect(unchanged.configuredCredentialFields).not.toContain("dbtToken");
});
it("refuses a member update before provider validation", async () => {
  const { created, opened } = await setup();
  const before = state.dbtTokens.length;
  await expect(
    asActor(
      () =>
        update.run(
          edit(
            created.connectionId,
            opened.nativeRevision,
            "flagged-integration-credential",
          ),
          context,
        ),
      member,
    ),
  ).rejects.toThrow();
  expect(state.dbtTokens).toHaveLength(before);
  const profile = await readWorkspaceCredentialProfile({
    appId: "analytics-2",
    connectionId: created.connectionId,
    provider: "bigquery",
    requestContext: { userEmail: owner, orgId, authUserId: owner },
  });
  expect(
    profile?.connection.credentialRefs.some(
      (ref) => ref.key === WORKSPACE_WAREHOUSE_DBT_TOKEN,
    ),
  ).toBe(false);
});
it("refuses substituting the warehouse credential as the dbt token reference", async () => {
  const { created, opened } = await setup();
  const before = state.warehouseKeys.length;
  await expect(
    asActor(() =>
      workspaceWarehouseActions.update.run(
        {
          connectionId: created.connectionId,
          revision: opened.nativeRevision,
          config: {
            hasDbtMetadata: true,
            dbtVersion: "current",
            dbtCloudHostname: "cloud.getdbt.com",
            dbtEnvironmentId: "9",
            dbtCredentialKey: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          },
          secretValues: [
            {
              key: WORKSPACE_WAREHOUSE_DBT_TOKEN,
              secret: "flagged-integration-credential",
            },
          ],
        },
        context,
      ),
    ),
  ).rejects.toThrow();
  expect(state.warehouseKeys).toHaveLength(before);
  const unchanged = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(unchanged.nativeRevision).toBe(opened.nativeRevision);
  expect(unchanged.values.hasDbtMetadata).not.toBe(true);
});

it("report A2-NATIVE-EDIT-DRAFT: saves a native edit as an inaccessible draft and validates before activation", async () => {
  const { created, opened } = await setup();
  const beforeValidation = state.warehouseKeys.length;
  const values = {
    name: "Draft warehouse",
    projectId: "qa-project",
    queryAccessGroupIds: ["workspace"],
    viewAccessGroupIds: ["workspace"],
    serviceAccount: "draft-unvalidated-credential",
  };
  await asActor(() =>
    update.run(
      {
        connectionId: created.connectionId,
        revision: opened.nativeRevision,
        type: "bigquery",
        draft: true,
        values,
      },
      context,
    ),
  );
  expect(state.warehouseKeys).toHaveLength(beforeValidation);
  const draft = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(draft.connection.isDraft).toBe(true);
  expect(draft.configuredCredentialFields).toContain("serviceAccount");
  const denied = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: created.connectionId,
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    }),
  );
  expect(denied.available).toBe(false);
  await expect(
    asActor(() =>
      executeConnectionQuery(
        {
          connectionId: created.connectionId,
          query: "SELECT 1",
          requestId: randomUUID(),
          first: 1,
        },
        { userEmail: owner, orgId, caller: "frontend" },
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "data_connection_not_connected" });
  if (!draft.nativeRevision) throw new Error("Draft revision missing");
  const draftRevision = draft.nativeRevision;
  state.rejectWarehouse = true;
  try {
    await expect(
      asActor(() =>
        update.run(
          {
            connectionId: created.connectionId,
            revision: draftRevision,
            type: "bigquery",
            draft: false,
            values: { ...values, serviceAccount: "" },
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "workspace_credential_validation_failed",
    });
  } finally {
    state.rejectWarehouse = false;
  }
  const afterRejection = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(afterRejection.nativeRevision).toBe(draftRevision);
  expect(afterRejection.connection.isDraft).toBe(true);
  const stillDenied = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: created.connectionId,
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    }),
  );
  expect(stillDenied.available).toBe(false);
  await asActor(() =>
    update.run(
      {
        connectionId: created.connectionId,
        revision: draftRevision,
        type: "bigquery",
        draft: false,
        values: { ...values, serviceAccount: "" },
      },
      context,
    ),
  );
  expect(state.warehouseKeys).toHaveLength(beforeValidation + 2);
  const active = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  expect(active.connection.isDraft).toBe(false);
  const credential = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: created.connectionId,
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    }),
  );
  expect(credential.available && credential.value).toBe(
    "draft-unvalidated-credential",
  );
});

it("archiving a native draft prevents it from being reopened or activated", async () => {
  const { created, opened } = await setup();
  const values = {
    name: "Draft warehouse",
    projectId: "qa-project",
    queryAccessGroupIds: ["workspace"],
    viewAccessGroupIds: ["workspace"],
  };
  await asActor(() =>
    update.run(
      {
        connectionId: created.connectionId,
        revision: opened.nativeRevision,
        type: "bigquery",
        draft: true,
        values,
      },
      context,
    ),
  );
  const draft = await asActor(() =>
    getForm.run({ id: created.connectionId }, context),
  );
  if (!draft.nativeRevision) throw new Error("Draft revision missing");
  const revision = draft.nativeRevision;
  await asActor(() =>
    workspaceWarehouseActions.archiveConnection.run(
      { connectionId: created.connectionId },
      context,
    ),
  );
  await expect(
    asActor(() =>
      update.run(
        {
          connectionId: created.connectionId,
          revision,
          type: "bigquery",
          draft: false,
          values,
        },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "workspace_credential_conflict" });
  await expect(
    asActor(() => getForm.run({ id: created.connectionId }, context)),
  ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
});
