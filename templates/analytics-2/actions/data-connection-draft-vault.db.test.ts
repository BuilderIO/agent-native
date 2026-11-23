import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { deleteCredential } from "@agent-native/core/credentials";
import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  upsertWorkspaceConnection,
  resolveWorkspaceConnectionCredentialForApp,
  listWorkspaceConnections,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  tokens: [] as string[],
  metadataGate: null as Promise<void> | null,
  dbtGate: null as Promise<void> | null,
  queryGate: null as Promise<void> | null,
  failScopedCredentialRead: false,
  entered: false,
}));
vi.mock("@agent-native/core/credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/credentials")>();
  return {
    ...actual,
    resolveCredentialForScope: async (
      ...args: Parameters<typeof actual.resolveCredentialForScope>
    ) => {
      if (state.failScopedCredentialRead)
        throw new Error("Synthetic scoped vault read failure");
      return actual.resolveCredentialForScope(...args);
    },
  };
});
vi.mock("../server/model/data-dbt.js", () => ({
  validateDbtConfiguration: async (_values: unknown, token: string) => {
    state.tokens.push(token);
    if (state.dbtGate) {
      state.entered = true;
      await state.dbtGate;
    }
  },
}));
vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    validateSubmittedServiceAccount: async () => {
      if (state.metadataGate) {
        state.entered = true;
        await state.metadataGate;
      }
    },
    validateBigQueryProjectAccess: async () => {
      if (state.metadataGate) {
        state.entered = true;
        await state.metadataGate;
      }
    },
    requestMetadata: async () => {
      if (state.metadataGate) {
        state.entered = true;
        await state.metadataGate;
      }
      return { items: [] };
    },
    executeQueryPage: async () => {
      state.entered = true;
      if (state.queryGate) await state.queryGate;
      return {
        jobComplete: true,
        status: "complete" as const,
        jobReference: { projectId: "qa-project", jobId: "qa-job" },
        columns: [{ name: "qa_value", type: "INTEGER" }],
        rows: [["1"]],
        totalRows: "99999",
        totalBytesProcessed: "0",
        pageToken: "private-next-page",
        hasNextPage: true,
      };
    },
  }),
);
import { getDb } from "../server/db/index.js";
import {
  saveDataConnection,
  deleteDataConnection,
  executeConnectionQuery,
} from "../server/model/data-connections.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
const round = mkdtempSync(join(tmpdir(), "data-team-draft-"));
const orgId = `qa-draft-${randomUUID()}`;
const actor = "draft-owner@example.test";
const otherOrgId = `qa-other-draft-${randomUUID()}`;
const member = "draft-member@example.test";
const manager = "draft-manager@example.test";
const fixture = "integration-service-fixture";
const asActor = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: actor, orgId, authUserId: actor, isSyntheticTraffic: true },
    call,
  );
beforeEach(() => {
  state.tokens = [];
  state.metadataGate = null;
  state.dbtGate = null;
  state.queryGate = null;
  state.failScopedCredentialRead = false;
  state.entered = false;
});
it("report A2-ASK84-RANGE-FUNCTION: executes warehouse table functions without admitting writes or scripts", async () => {
  const saved = await asActor(() =>
    saveDataConnection({
      requestId: randomUUID(),
      type: "bigquery",
      draft: false,
      values: {
        name: "QA read-only table function",
        projectId: "qa-project",
        serviceAccount: "service-account-fixture",
      },
    }),
  );
  const execute = (query: string) =>
    asActor(() =>
      executeConnectionQuery(
        { connectionId: saved.id, query, first: 1 },
        { userEmail: actor, orgId, caller: "frontend" },
      ),
    );
  try {
    for (const query of [
      "SELECT 1 FROM `qa-project.analytics.events_range`(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), CURRENT_DATE()) LIMIT 1",
      "WITH events AS (SELECT * FROM `qa-project.analytics.events_range`(DATE '2026-01-01', DATE '2026-01-02')) SELECT COUNT(*) FROM events",
    ]) {
      state.entered = false;
      expect(await execute(query)).toMatchObject({
        status: "complete",
        rows: [["1"]],
      });
      expect(state.entered).toBe(true);
    }
    for (const query of [
      "DELETE FROM `qa-project.analytics.events` WHERE TRUE",
      "SELECT 1; DELETE FROM `qa-project.analytics.events` WHERE TRUE",
      "WITH events AS (DELETE FROM `qa-project.analytics.events` RETURNING *) SELECT * FROM events",
      "WITH events AS (SELECT 1) INSERT INTO `qa-project.analytics.events` SELECT * FROM events",
      "SELECT 1; SELECT 2",
    ]) {
      state.entered = false;
      await expect(execute(query)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: "warehouse_query_not_readonly",
      });
      expect(state.entered).toBe(false);
    }
  } finally {
    await asActor(() => deleteDataConnection({ id: saved.id }));
  }
});
it.each(["missing", "store-failure"] as const)(
  "distinguishes a %s saved draft credential before activation",
  async (condition) => {
    const saved = await asActor(() =>
      saveDataConnection({
        requestId: randomUUID(),
        type: "bigquery",
        draft: true,
        values: {
          name: "QA draft credential status",
          projectId: "qa-project",
          serviceAccount: "service-account-fixture",
        },
      }),
    );
    const connection = await asActor(() => getWorkspaceConnection(saved.id));
    if (!connection) throw new Error("Missing draft status fixture");
    if (condition === "missing")
      await asActor(() =>
        deleteCredential(
          String(connection.config.serviceAccountCredentialKey),
          { userEmail: actor, orgId, scope: "org" },
        ),
      );
    else state.failScopedCredentialRead = true;
    try {
      await expect(
        asActor(() =>
          saveDataConnection({
            requestId: randomUUID(),
            id: saved.id,
            type: "bigquery",
            draft: false,
            values: { name: "QA activate missing credential" },
          }),
        ),
      ).rejects.toMatchObject(
        condition === "missing"
          ? {
              statusCode: 409,
              errorCode: "data_connection_draft_credentials_missing",
            }
          : {
              statusCode: 503,
              errorCode: "data_connection_draft_credentials_unreadable",
            },
      );
      expect(
        (await asActor(() => getWorkspaceConnection(saved.id)))?.status,
      ).toBe("disabled");
    } finally {
      state.failScopedCredentialRead = false;
      await asActor(() => deleteDataConnection({ id: saved.id }));
    }
  },
);
it.each(["run", "poll", "next-page"] as const)(
  "does not return frontend %s rows, counts or cursors when query access is revoked during the provider request",
  async (operation) => {
    const saved = await asActor(() =>
      saveDataConnection({
        requestId: randomUUID(),
        type: "bigquery",
        draft: false,
        values: {
          name: "QA frontend revocation",
          projectId: "qa-project",
          serviceAccount: "service-account-fixture",
          queryAccessGroupIds: ["workspace"],
        },
      }),
    );
    const connection = await asActor(() => getWorkspaceConnection(saved.id));
    if (!connection) throw new Error("Missing frontend query fixture");
    let release = () => {};
    state.queryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = {
      connectionId: saved.id,
      ...(operation === "run"
        ? { query: "SELECT 1 AS qa_value" }
        : { job: { projectId: "qa-project", jobId: "qa-job" } }),
      ...(operation === "next-page" ? { pageToken: "previous-page" } : {}),
      first: 1,
    };
    const pending = runWithRequestContext({ userEmail: member, orgId }, () =>
      executeConnectionQuery(input, {
        userEmail: member,
        orgId,
        caller: "frontend",
      }),
    ).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
    try {
      await vi.waitFor(() => expect(state.entered).toBe(true));
      await asActor(() =>
        upsertWorkspaceConnection({
          id: saved.id,
          provider: "bigquery",
          label: connection.label,
          config: connection.config,
          credentialRefs: connection.credentialRefs,
          allowedUsers: [actor],
        }),
      );
      release();
      const outcome = await pending;
      expect(outcome.result).toBeUndefined();
      expect(outcome.error).toMatchObject({
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
      expect(JSON.stringify(outcome.error)).not.toContain("99999");
      expect(JSON.stringify(outcome.error)).not.toContain("private-next-page");
    } finally {
      state.queryGate = null;
      release();
      await pending;
      await asActor(() => deleteDataConnection({ id: saved.id }));
    }
  },
);
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_draft_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA test local workspace",
    createdBy: actor,
    createdAt: Date.now(),
  });
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId,
        email: actor,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId,
        email: manager,
        role: "admin",
        joinedAt: Date.now(),
      },
    ]);
  await getDb().insert(organizations).values({
    id: otherOrgId,
    name: "QA second local workspace",
    createdBy: actor,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: otherOrgId,
    email: actor,
    role: "owner",
    joinedAt: Date.now(),
  });
});
it.each([
  "service-reference",
  "integration-reference",
  "integration-settings",
] as const)(
  "fences a %s change by another manager while provider validation is pending",
  async (change) => {
    state.entered = false;
    const saved = await asActor(() =>
      saveDataConnection({
        requestId: randomUUID(),
        type: "bigquery",
        draft: true,
        values: {
          name: "QA validation race",
          projectId: "qa-project",
          serviceAccount: "service-account-fixture",
          ...(change !== "service-reference"
            ? {
                hasDbtMetadata: true,
                dbtToken: fixture,
                dbtVersion: "current" as const,
                dbtEnvironmentId: "123",
                dbtCloudHostname: "cloud.getdbt.com",
              }
            : {}),
          queryAccessGroupIds: ["workspace"],
        },
      }),
    );
    const before = await asActor(() => getWorkspaceConnection(saved.id));
    if (!before) throw new Error("Missing validation fixture");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (change === "service-reference") state.metadataGate = gate;
    else state.dbtGate = gate;
    const pending = asActor(() =>
      saveDataConnection({
        requestId: randomUUID(),
        id: saved.id,
        type: "bigquery",
        draft: false,
        values: { name: "QA stale validation" },
      }),
    ).then(
      (saved) => ({ saved, error: undefined }),
      (error: unknown) => ({ saved: undefined, error }),
    );
    try {
      await vi.waitFor(() => expect(state.entered).toBe(true));
      const config = {
        ...before.config,
        draft: true,
        ...(change === "service-reference"
          ? { serviceAccountCredentialKey: "rotated-service-credential" }
          : change === "integration-reference"
            ? { dbtCredentialKey: "rotated-integration-credential" }
            : { dbtEnvironmentId: "999" }),
      };
      const refs = before.credentialRefs.map((ref) => ({
        ...ref,
        key:
          ref.key === before.config.serviceAccountCredentialKey &&
          change === "service-reference"
            ? "rotated-service-credential"
            : ref.key === before.config.dbtCredentialKey &&
                change === "integration-reference"
              ? "rotated-integration-credential"
              : ref.key,
      }));
      await runWithRequestContext({ userEmail: manager, orgId }, () =>
        upsertWorkspaceConnection({
          id: saved.id,
          provider: "bigquery",
          label: before.label,
          status: before.status,
          config,
          credentialRefs: refs,
        }),
      );
      const concurrent = await asActor(() => getWorkspaceConnection(saved.id));
      release();
      const result = await pending;
      expect(result.saved).toBeUndefined();
      expect(result.error).toMatchObject({
        statusCode: 409,
        errorCode: "data_connection_validation_stale",
      });
      expect(await asActor(() => getWorkspaceConnection(saved.id))).toEqual(
        concurrent,
      );
    } finally {
      state.metadataGate = null;
      state.dbtGate = null;
      release();
      await pending;
      await asActor(() =>
        upsertWorkspaceConnection({
          id: saved.id,
          provider: "bigquery",
          label: before.label,
          status: before.status,
          config: before.config,
          credentialRefs: before.credentialRefs,
        }),
      );
      await asActor(() => deleteDataConnection({ id: saved.id }));
    }
  },
);
afterAll(async () => {
  await closeDbExec();
  if (!resolve(round).startsWith(resolve(tmpdir()) + "/data-team-draft-"))
    throw new Error("Refused own runtime cleanup");
  rmSync(round, { recursive: true });
});
it("activates a persisted draft using its exact encrypted vault references, then resolves the active integration ref", async () => {
  const saved = await asActor(() =>
    saveDataConnection({
      requestId: randomUUID(),
      type: "bigquery",
      draft: true,
      values: {
        name: `QA-analytics-2-data-team-${Date.now()}`,
        projectId: "qa-project",
        serviceAccount: "service-account-fixture",
        dbtToken: fixture,
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtEnvironmentId: "123",
        dbtCloudHostname: "cloud.getdbt.com",
        queryAccessGroupIds: ["workspace"],
      },
    }),
  );
  const draft = await asActor(() => getWorkspaceConnection(saved.id));
  expect(draft?.status).toBe("disabled");
  expect(
    (
      await asActor(() =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: "analytics-2",
          provider: "bigquery",
          connectionId: saved.id,
          key: String(draft?.config.dbtCredentialKey),
        }),
      )
    ).available,
  ).toBe(false);
  const activate = () =>
    saveDataConnection({
      requestId: randomUUID(),
      id: saved.id,
      type: "bigquery",
      draft: false,
      values: { name: "QA forbidden draft" },
    });
  await expect(
    runWithRequestContext({ userEmail: actor, orgId: otherOrgId }, activate),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    runWithRequestContext({ userEmail: member, orgId }, activate),
  ).rejects.toMatchObject({ statusCode: 403 });
  const active = await asActor(() =>
    saveDataConnection({
      requestId: randomUUID(),
      id: saved.id,
      type: "bigquery",
      draft: false,
      values: { name: "QA activated local connection" },
    }),
  );
  expect(active.isDraft).toBe(false);
  expect(state.tokens).toEqual([fixture]);
  const connection = await asActor(() => getWorkspaceConnection(saved.id));
  const key = connection?.config.dbtCredentialKey;
  expect(typeof key).toBe("string");
  const held = await asActor(() =>
    resolveWorkspaceConnectionCredentialForApp({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: saved.id,
      key: String(key),
    }),
  );
  expect(held.available).toBe(true);
  expect(held.value).toBe(fixture);
  await asActor(() => deleteDataConnection({ id: saved.id }));
  expect(
    await asActor(() => listWorkspaceConnections({ includeDisabled: true })),
  ).toHaveLength(0);
  const rows = await getDbExec().execute({
    sql: "SELECT COUNT(*) AS count FROM settings WHERE key LIKE ?",
    args: ["%credential:%"],
  });
  expect(Number(rows.rows[0]?.count)).toBe(0);
});
