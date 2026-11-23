import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  ensureWorkspaceConnectionsTable,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { createDataCategory } from "../server/model/data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createStatus } from "../server/model/statuses-store.js";
import listEndorsedCatalog from "./list-data-endorsed-catalog.js";
import updateMetadata from "./update-data-resource-metadata.js";

const round = mkdtempSync(join(tmpdir(), "data-endorsed-catalog-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `endorsed-org-a-${randomUUID()}`;
const orgB = `endorsed-org-b-${randomUUID()}`;
const owner = "endorsed-owner@example.test";
const appId = "analytics-2";

function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "Endorsed Test User",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const frontendCtx = (orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId,
});

const agentCtx = (orgId = orgA) => ({
  caller: "agent" as const,
  userEmail: owner,
  orgId,
  appId,
});

let connAId = "";
let connBId = "";
let endorsedStatusId = "";
let draftStatusId = "";
let categoryId = "";
let orgBEndorsedStatusId = "";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_endorsed_catalog_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();

  for (const id of [orgA, orgB]) {
    await getDb()
      .insert(organizations)
      .values({
        id,
        name: `Workspace ${id}`,
        createdBy: owner,
        createdAt: Date.now(),
      });
    await getDb().insert(orgMembers).values({
      id: randomUUID(),
      orgId: id,
      email: owner,
      role: "owner",
      joinedAt: Date.now(),
    });
    await getDb().insert(appMemberRoles).values({
      id: randomUUID(),
      orgId: id,
      email: owner,
      appId,
      role: "manager",
      updatedBy: owner,
      updatedAt: Date.now(),
    });
  }

  connAId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Analytics Warehouse A",
        status: "connected",
      }),
    )
  ).id;

  connBId = (
    await asActor(owner, orgB, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "Analytics Warehouse B",
        status: "connected",
      }),
    )
  ).id;

  const endorsed = await createStatus({
    ownerEmail: owner,
    orgId: orgA,
    name: "Endorsed",
    endorsed: true,
  });
  endorsedStatusId = endorsed.id;

  const draft = await createStatus({
    ownerEmail: owner,
    orgId: orgA,
    name: "In review",
    endorsed: false,
  });
  draftStatusId = draft.id;

  const category = await createDataCategory(
    { ownerEmail: owner, orgId: orgA },
    { name: "Revenue", color: "#2563eb" },
  );
  categoryId = category.id;

  const orgBEndorsed = await createStatus({
    ownerEmail: owner,
    orgId: orgB,
    name: "Verified",
    endorsed: true,
  });
  orgBEndorsedStatusId = orgBEndorsed.id;
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(round, { recursive: true, force: true });
});

describe("list-data-endorsed-catalog action", () => {
  it("returns all four canonical item types even when no resources are endorsed", async () => {
    const result = await asActor(owner, orgA, () =>
      listEndorsedCatalog.run({}, frontendCtx(orgA)),
    );
    expect(result.itemTypes).toEqual(["view", "model", "table", "schema"]);
    expect(Object.keys(result.groups).sort()).toEqual([
      "model",
      "schema",
      "table",
      "view",
    ]);
    expect(result.items).toEqual([]);
    expect(result.statuses).toEqual([
      { id: endorsedStatusId, name: "Endorsed" },
    ]);
    expect(result.categories).toEqual([{ id: categoryId, name: "Revenue" }]);
  });

  it("aggregates endorsed tables and schemas, respects org isolation and agent AI policy", async () => {
    const ordersTableId = "table:proj:PROD:DIM_ACCOUNTS";
    const customersTableId = "table:proj:PROD:DIM_CUSTOMERS";
    const restrictedSchemaId = "schema:proj:RESTRICTED";

    await asActor(owner, orgA, async () => {
      await updateMetadata.run(
        {
          connectionId: connAId,
          resource: { kind: "connection", id: connAId },
          patch: { aiUsage: "included" },
        },
        frontendCtx(orgA),
      );
      await updateMetadata.run(
        {
          connectionId: connAId,
          resource: { kind: "table", id: ordersTableId },
          patch: {
            description: "Account-level firmographic and owner data",
            statusId: endorsedStatusId,
            categoryIds: [categoryId],
            aiUsage: "included",
          },
        },
        frontendCtx(orgA),
      );
      await updateMetadata.run(
        {
          connectionId: connAId,
          resource: { kind: "schema", id: restrictedSchemaId },
          patch: {
            description: "Restricted analytics schema",
            statusId: endorsedStatusId,
            aiUsage: "excluded",
          },
        },
        frontendCtx(orgA),
      );
      await updateMetadata.run(
        {
          connectionId: connAId,
          resource: { kind: "table", id: customersTableId },
          patch: {
            description: "Unendorsed customer table",
            statusId: draftStatusId,
          },
        },
        frontendCtx(orgA),
      );
    });

    await asActor(owner, orgB, async () => {
      await updateMetadata.run(
        {
          connectionId: connBId,
          resource: { kind: "table", id: customersTableId },
          patch: {
            description: "Org B only",
            statusId: orgBEndorsedStatusId,
          },
        },
        frontendCtx(orgB),
      );
    });

    const frontendResult = await asActor(owner, orgA, () =>
      listEndorsedCatalog.run({}, frontendCtx(orgA)),
    );
    expect(frontendResult.groups.table).toHaveLength(1);
    expect(frontendResult.groups.table[0]).toMatchObject({
      connectionId: connAId,
      resourceId: ordersTableId,
      resourceKind: "table",
      group: "table",
      name: "DIM_ACCOUNTS",
      description: "Account-level firmographic and owner data",
      pinned: false,
      status: { id: endorsedStatusId, name: "Endorsed" },
      categories: [{ id: categoryId, name: "Revenue" }],
      connection: {
        id: connAId,
        name: "Analytics Warehouse A",
        type: "bigquery",
      },
    });
    expect(frontendResult.groups.schema).toHaveLength(1);
    expect(frontendResult.groups.schema[0]).toMatchObject({
      resourceId: restrictedSchemaId,
      group: "schema",
      name: "RESTRICTED",
      description: "Restricted analytics schema",
    });
    expect(frontendResult.items.map((item) => item.name)).toEqual([
      "DIM_ACCOUNTS",
      "RESTRICTED",
    ]);

    const agentResult = await asActor(owner, orgA, () =>
      listEndorsedCatalog.run({}, agentCtx(orgA)),
    );
    expect(agentResult.groups.table.map((item) => item.name)).toEqual([
      "DIM_ACCOUNTS",
    ]);
    expect(agentResult.groups.schema).toEqual([]);
  });
});
