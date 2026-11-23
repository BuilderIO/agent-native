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
import { ensureWorkspaceConnectionsTable } from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as { authorization: string; environmentId: string }[],
  duringRead: null as null | (() => Promise<void>),
}));
vi.mock("../server/model/bigquery-credential-validation.js", () => ({
  createBigQueryCredentialValidator: () => async () => {},
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: async (url: string, init: RequestInit) => {
    if (url.includes("semantic-layer.")) {
      const variables = JSON.parse(String(init.body)).variables;
      state.calls.push({
        authorization: new Headers(init.headers).get("authorization") ?? "",
        environmentId: variables.environmentId,
      });
      const duringRead = state.duringRead;
      state.duringRead = null;
      if (duringRead) await duringRead();
      return Response.json({
        data: {
          metricsPaginated: {
            items: [
              {
                name: "orders",
                description: "Order count",
                type: "SIMPLE",
                dimensions: [],
                queryableGranularities: [],
              },
            ],
            pageNum: variables.pageNum,
            pageSize: variables.pageSize,
            totalItems: 1,
            totalPages: 1,
          },
        },
      });
    }
    return Response.json({
      data: { environment: { applied: { models: { edges: [] } } } },
    });
  },
}));
import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { workspaceWarehouseActions } from "../server/model/workspace-warehouse-connection.js";
import { workspaceWarehouseEditFormSchema } from "../shared/workspace-warehouse-edit-form.js";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "../shared/workspace-warehouse-form.js";
import getForm from "./get-data-connection-form.js";
import list from "./list-dbt-semantic-metrics.js";
import update from "./update-workspace-warehouse-form.js";

const directory = mkdtempSync(join(tmpdir(), "qa-native-metrics-"));
const previous = {
  database: process.env.DATABASE_URL,
  secret: process.env.SECRETS_ENCRYPTION_KEY,
};
const orgId = `qa-native-metrics-${randomUUID()}`;
const owner = "metrics-owner@example.test",
  member = "metrics-member@example.test";
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
  process.env.DATABASE_URL = `pglite:${join(directory, "database")}`;
  process.env.SECRETS_ENCRYPTION_KEY = "native-metrics-qa-encryption-marker";
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_native_metrics_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA native metrics",
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
  rmSync(directory, { recursive: true, force: true });
});
async function configure(
  id: string,
  token: string,
  environmentId = "42",
  includeForAI = true,
) {
  const opened = await asActor(() => getForm.run({ id }, context));
  if (!opened.nativeRevision) throw new Error("Missing native revision");
  await asActor(() =>
    update.run(
      workspaceWarehouseEditFormSchema.parse({
        connectionId: id,
        revision: opened.nativeRevision,
        type: "bigquery",
        draft: false,
        canonicalAiPolicy: {
          usage: opened.baseline.aiUsage,
          revision: opened.baseline.annotationRevision,
        },
        values: {
          name: "QA native metrics",
          projectId: "qa-project",
          queryAccessGroupIds: ["workspace"],
          viewAccessGroupIds: ["workspace"],
          hasDbtMetadata: true,
          dbtVersion: "current",
          dbtCloudHostname: "cloud.getdbt.com",
          dbtEnvironmentId: environmentId,
          dbtToken: token,
          includeForAI,
        },
      }),
      context,
    ),
  );
}
async function create(token: string, environmentId: string) {
  const result = await asActor(() =>
    workspaceWarehouseActions.create.run(
      workspaceWarehouseFormInput(
        workspaceWarehouseFormSchema.parse({
          requestId: randomUUID(),
          type: "bigquery",
          draft: false,
          values: {
            name: "QA native metrics",
            projectId: "qa-project",
            serviceAccount: "flagged-source-credential",
            queryAccessGroupIds: ["workspace"],
            viewAccessGroupIds: ["workspace"],
          },
        }),
      ),
      context,
    ),
  );
  await configure(result.connectionId, token, environmentId);
  return result.connectionId;
}
it("a member reads each selected connection using its own encrypted dbt token and environment", async () => {
  const first = await create("flagged-first-credential", "41");
  const second = await create("flagged-second-credential", "42");
  const start = state.calls.length;
  for (const id of [first, second]) {
    const result = await asActor(
      () => list.run({ connectionId: id }, { caller: "frontend" }),
      member,
    );
    expect(result.connectionId).toBe(id);
    expect(result.items.map((item) => item.name)).toEqual(["orders"]);
    expect(JSON.stringify(result)).not.toContain("credential");
  }
  expect(state.calls.slice(start)).toEqual([
    { authorization: "Bearer flagged-first-credential", environmentId: "41" },
    { authorization: "Bearer flagged-second-credential", environmentId: "42" },
  ]);
});
it("a nonmember cannot read metrics and never reaches the provider", async () => {
  const id = await create("flagged-owner-credential", "42");
  const start = state.calls.length;
  await expect(
    asActor(
      () => list.run({ connectionId: id }, { caller: "frontend" }),
      "outsider@example.test",
    ),
  ).rejects.toThrow();
  expect(state.calls).toHaveLength(start);
});
it("withholds metrics after an actual encrypted-token rotation during the provider read", async () => {
  const id = await create("flagged-original-credential", "42");
  state.duringRead = () => configure(id, "flagged-rotated-credential");
  await expect(
    asActor(() => list.run({ connectionId: id }, context)),
  ).rejects.toThrow("changed");
  const result = await asActor(() => list.run({ connectionId: id }, context));
  expect(result.items.map((item) => item.name)).toEqual(["orders"]);
  expect(state.calls.at(-1)?.authorization).toBe(
    "Bearer flagged-rotated-credential",
  );
});
it("native AI exclusion blocks an agent but permits a member's frontend read", async () => {
  const id = await create("flagged-policy-credential", "42");
  await configure(id, "", "42", false);
  const start = state.calls.length;
  await expect(
    asActor(() => list.run({ connectionId: id }, { caller: "agent" }), member),
  ).rejects.toThrow("AI");
  expect(state.calls).toHaveLength(start);
  expect(
    (
      await asActor(
        () => list.run({ connectionId: id }, { caller: "frontend" }),
        member,
      )
    ).items.map((item) => item.name),
  ).toEqual(["orders"]);
});
