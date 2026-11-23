import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  beginConnectionDeletionPhases,
  finishConnectionDeletionPhases,
} from "../server/model/data-connection-mutations.js";
import {
  createDataCategory,
  deleteConnectionAnnotationSettings,
  readConnectionAnnotationOverride,
  readConnectionDeletionState,
  readConnectionDescription,
  readDataCategories,
  readDataResourceMetadata,
  resetDescendantAiUsage,
} from "../server/model/data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createStatus } from "../server/model/statuses-store.js";
import createCategory from "./create-data-category.js";
import listCategories from "./list-data-categories.js";
import listMetadata from "./list-data-resource-metadata.js";
import updateMetadata from "./update-data-resource-metadata.js";

const failureControl = vi.hoisted(() => ({
  descendantReset: false,
  pausedWriter: null as null | { entered: () => void; resume: Promise<void> },
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/settings")>();
  return {
    ...actual,
    mutateOrgSetting: async (
      ...args: Parameters<typeof actual.mutateOrgSetting>
    ) => {
      if (
        failureControl.pausedWriter &&
        args[1].endsWith(":schema:schema_race")
      ) {
        const paused = failureControl.pausedWriter;
        paused.entered();
        await paused.resume;
      }
      if (failureControl.descendantReset && args[1].includes(":schema:"))
        throw new Error("Controlled descendant reset failure");
      return actual.mutateOrgSetting(...args);
    },
  };
});

const round = mkdtempSync(join(tmpdir(), "data-resource-metadata-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `qa-metadata-a-${randomUUID()}`;
const orgB = `qa-metadata-b-${randomUUID()}`;
const owner = "metadata-owner@example.test";
const member = "metadata-member@example.test";
const delegated = "metadata-delegated@example.test";
const orgAdmin = "metadata-org-admin@example.test";
const appId = "analytics-2";

const scopeA = { ownerEmail: owner, orgId: orgA };
const scopeB = { ownerEmail: owner, orgId: orgB };

function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA test account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const actionContext = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId,
});

let sharedConnectionId = "";
let bulkConnectionId = "";
let otherOrgConnectionId = "";
let statusAId = "";
let statusBId = "";
let categoryAId = "";
let categoryA2Id = "";
let categoryBId = "";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_data_resource_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();

  for (const id of [orgA, orgB]) {
    await getDb().insert(organizations).values({
      id,
      name: "QA metadata workspace",
      createdBy: owner,
      createdAt: Date.now(),
    });
  }
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: delegated,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: orgAdmin,
        role: "admin",
        joinedAt: Date.now(),
      },
    ]);
  // The second member is a plain viewer. `delegated` is an organisation member
  // with the app's manager role: annotations yes, catalogue administration no.
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: orgA,
    email: member,
    appId,
    role: "viewer",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: orgA,
    email: delegated,
    appId,
    role: "manager",
    updatedBy: owner,
    updatedAt: Date.now(),
  });

  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: orgA,
    email: owner,
    appId,
    role: "manager",
    updatedBy: owner,
    updatedAt: Date.now(),
  });

  sharedConnectionId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA shared warehouse",
      }),
    )
  ).id;
  bulkConnectionId = (
    await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA bulk warehouse",
      }),
    )
  ).id;
  otherOrgConnectionId = (
    await asActor(owner, orgB, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA other workspace warehouse",
      }),
    )
  ).id;

  statusAId = (await createStatus({ ...scopeA, name: "QA Approved" })).id;
  statusBId = (await createStatus({ ...scopeB, name: "QA Approved" })).id;
  categoryAId = (
    await createDataCategory(scopeA, { name: "QA Finance", color: "#0a0b0c" })
  ).id;
  categoryA2Id = (
    await createDataCategory(scopeA, { name: "QA Ops", color: "#0b0c0d" })
  ).id;
  categoryBId = (
    await createDataCategory(scopeB, { name: "QA Finance", color: "#0a0b0c" })
  ).id;
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/data-resource-metadata-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error("Refused cleanup outside this test round");
  }
});

describe("data resource metadata reads", () => {
  it("returns the real empty annotation for a requested resource, never an invented one", async () => {
    const result = await asActor(owner, orgA, () =>
      listMetadata.run(
        {
          connectionId: sharedConnectionId,
          resources: [
            { kind: "connection", id: sharedConnectionId },
            { kind: "schema", id: "schema_never_annotated" },
            { kind: "schema", id: "schema_never_annotated" },
          ],
        },
        actionContext(),
      ),
    );
    expect(result.resources).toEqual([
      {
        connectionId: sharedConnectionId,
        kind: "connection",
        id: sharedConnectionId,
        description: "",
        statusId: null,
        categoryIds: [],
        aiUsage: null,
      },
      {
        connectionId: sharedConnectionId,
        kind: "schema",
        id: "schema_never_annotated",
        description: "",
        statusId: null,
        categoryIds: [],
        aiUsage: null,
      },
    ]);
    // Metadata DTO only: no provider config, credential reference or owner.
    expect(JSON.stringify(result)).not.toMatch(
      /credentialRefs|serviceAccount|workspaceConnectionScope|ownerEmail/,
    );
  });

  it("answers not-found for a connection in another workspace before reading annotations", async () => {
    await expect(
      asActor(owner, orgB, () =>
        listMetadata.run(
          { connectionId: sharedConnectionId },
          actionContext(owner, orgB),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "data_connection_not_found",
    });
    await expect(
      asActor(owner, orgA, () =>
        listMetadata.run(
          { connectionId: `missing-${randomUUID()}` },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "data_connection_not_found",
    });
  });
});

describe("built-in sample annotation reads", () => {
  it.each(["frontend", "tool"] as const)(
    "reads genuine absent annotations for the built-in source as %s while keeping writes refused",
    async (caller) => {
      const connectionId = "builtin-sample-data";
      const resource = { kind: "connection" as const, id: connectionId };
      const result = await asActor(owner, orgA, () =>
        listMetadata.run(
          { connectionId, resources: [resource] },
          { ...actionContext(), caller },
        ),
      );
      expect(result).toEqual({
        connectionId,
        resources: [
          {
            connectionId,
            ...resource,
            description: "",
            statusId: null,
            categoryIds: [],
            aiUsage: null,
          },
        ],
      });
      await expect(
        asActor(owner, orgA, () =>
          updateMetadata.run(
            {
              connectionId,
              resource,
              patch: { description: "Change public demo" },
            },
            actionContext(),
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
    },
  );
});

describe("data resource metadata writes", () => {
  it("persists a manager's annotation and shares it with a second member who cannot write", async () => {
    const resource = { kind: "schema" as const, id: "schema_shared" };
    const written = await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId: sharedConnectionId,
          resource,
          patch: {
            description: "Shared orders schema",
            statusId: statusAId,
            categoryIds: [categoryAId],
            aiUsage: "included",
          },
        },
        actionContext(),
      ),
    );
    expect(written).toEqual({
      connectionId: sharedConnectionId,
      kind: "schema",
      id: "schema_shared",
      description: "Shared orders schema",
      statusId: statusAId,
      categoryIds: [categoryAId],
      aiUsage: "included",
    });

    const peerRead = await asActor(member, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(member),
      ),
    );
    expect(peerRead.resources).toEqual([written]);

    await expect(
      asActor(member, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource,
            patch: { description: "Peer edit" },
          },
          actionContext(member),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_resource_metadata_manager_required",
    });

    const unchanged = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(unchanged.resources[0]?.description).toBe("Shared orders schema");
  });

  it("refuses to touch storage when the connection is not visible in this workspace", async () => {
    const foreign = { kind: "schema" as const, id: "schema_foreign" };
    // The same account signed into the other organisation cannot write to the
    // first organisation's connection either.
    await expect(
      asActor(owner, orgB, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource: foreign,
            patch: { description: "cross org write" },
          },
          actionContext(owner, orgB),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "data_connection_not_found",
    });
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: otherOrgConnectionId,
            resource: foreign,
            patch: { description: "cross workspace write" },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "data_connection_not_found",
    });
    // The owning workspace sees no annotation for that resource either: the
    // refused call never reached the store.
    const ownerRead = await asActor(owner, orgB, () =>
      listMetadata.run(
        { connectionId: otherOrgConnectionId },
        actionContext(owner, orgB),
      ),
    );
    expect(ownerRead.resources).toEqual([]);
    // The exact caller-org scoped keys the failed calls would have used are
    // still empty, so the refusal happened before any prefix was written.
    expect(
      await readDataResourceMetadata(scopeA, otherOrgConnectionId, [foreign]),
    ).toMatchObject({ resources: [{ description: "" }] });
    expect(
      await readDataResourceMetadata(scopeB, sharedConnectionId, [foreign]),
    ).toMatchObject({ resources: [{ description: "" }] });
  });

  it("keeps two concurrent patches on different fields", async () => {
    const resource = { kind: "table" as const, id: "table_concurrent" };
    await Promise.all([
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource,
            patch: { description: "Concurrent description" },
          },
          actionContext(),
        ),
      ),
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource,
            patch: { aiUsage: "excluded" },
          },
          actionContext(),
        ),
      ),
    ]);
    const result = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(result.resources[0]).toMatchObject({
      description: "Concurrent description",
      aiUsage: "excluded",
    });
  });

  it("rejects a status or category that belongs to another organisation", async () => {
    const resource = { kind: "table" as const, id: "table_foreign_labels" };
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource,
            patch: { statusId: statusBId },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_status_not_found",
    });
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource,
            patch: { categoryIds: [categoryAId, categoryBId] },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_category_not_found",
    });
    const result = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(result.resources[0]).toMatchObject({
      statusId: null,
      categoryIds: [],
    });
  });

  it("rejects an unknown credential-shaped patch field and a mismatched connection resource", () => {
    expect(
      updateMetadata.schema.safeParse({
        connectionId: sharedConnectionId,
        resource: { kind: "schema", id: "schema_x" },
        patch: { serviceAccount: "{}" },
      }).success,
    ).toBe(false);
    expect(
      updateMetadata.schema.safeParse({
        connectionId: sharedConnectionId,
        values: { serviceAccount: "{}" },
        resource: { kind: "schema", id: "schema_x" },
        patch: {},
      }).success,
    ).toBe(false);
    expect(
      updateMetadata.schema.safeParse({
        connectionId: sharedConnectionId,
        resource: { kind: "connection", id: "a-different-id" },
        patch: { description: "mismatched" },
      }).success,
    ).toBe(true);
  });

  it("rejects a connection annotation whose resource id is not that connection", async () => {
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource: { kind: "connection", id: "a-different-id" },
            patch: { description: "mismatched" },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_ref_mismatch",
    });
  });

  it("lists 66 annotations without truncating the last one", async () => {
    const ids = Array.from(
      { length: 66 },
      (_, index) => `table_bulk_${String(index + 1).padStart(2, "0")}`,
    );
    for (const id of ids) {
      await asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: bulkConnectionId,
            resource: { kind: "table", id },
            patch: { description: `Bulk ${id}` },
          },
          actionContext(),
        ),
      );
    }
    const result = await asActor(owner, orgA, () =>
      listMetadata.run({ connectionId: bulkConnectionId }, actionContext()),
    );
    expect(result.resources).toHaveLength(66);
    expect(result.resources.map((entry) => entry.id)).toEqual(ids);
    expect(result.resources[65]?.description).toBe("Bulk table_bulk_66");
  });
});

describe("data categories", () => {
  it("keeps the catalogue per organisation and lists it for every member", async () => {
    const memberView = await asActor(member, orgA, () =>
      listCategories.run({}, actionContext(member)),
    );
    expect(memberView.categories.map((entry) => entry.id)).toContain(
      categoryAId,
    );
    expect(memberView.categories.map((entry) => entry.id)).not.toContain(
      categoryBId,
    );
    expect(await readDataCategories(scopeB)).toMatchObject({
      categories: [{ id: categoryBId, name: "QA Finance", color: "#0a0b0c" }],
    });
  });

  it("lets only a manager create one and answers a duplicate name with 409", async () => {
    await expect(
      asActor(member, orgA, () =>
        createCategory.run(
          { name: "QA Member Category", color: "#222222" },
          actionContext(member),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_category_manager_required",
    });
    await expect(
      asActor(owner, orgA, () =>
        createCategory.run(
          { name: "QA Finance", color: "#333333" },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      code: "data_category_name_conflict",
      errorCode: "data_category_name_conflict",
      statusCode: 409,
    });
  });

  it("refuses category creation for an ambient A2A org-member identity", async () => {
    const before = await readDataCategories(scopeA);
    await expect(
      runWithRequestContext(
        {
          userEmail: owner,
          orgId: orgA,
          authUserId: owner,
          userName: "QA ambient A2A owner",
          isSyntheticTraffic: true,
          a2aIdentityAssurance: "org-member",
        },
        async () => {
          const current = await requireCurrentWorkspace();
          expect(current.access.orgRole).toBe("member");
          expect(
            (await currentWorkspaceCapabilities(current)).isManagerOrAbove,
          ).toBe(true);
          return createCategory.run(
            { name: "QA Ambient A2A", color: "#778899" },
            actionContext(),
          );
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_category_admin_required",
    });
    const after = await readDataCategories(scopeA);
    expect(after.categories).toEqual(before.categories);
  });

  it("resolves concurrent same-name creates to exactly one catalogue entry", async () => {
    const outcomes = await Promise.allSettled([
      asActor(owner, orgA, () =>
        createCategory.run(
          { name: "QA Race", color: "#123456" },
          actionContext(),
        ),
      ),
      asActor(owner, orgA, () =>
        createCategory.run(
          { name: "QA Race", color: "#654321" },
          actionContext(),
        ),
      ),
    ]);
    const fulfilled = outcomes.filter((entry) => entry.status === "fulfilled");
    const rejected = outcomes.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "data_category_name_conflict" },
    });
    const catalogue = await readDataCategories(scopeA);
    expect(
      catalogue.categories.filter((entry) => entry.name === "QA Race"),
    ).toHaveLength(1);
  });
});

describe("repair contracts", () => {
  it("applies category changes to the freshest list, not a client snapshot", async () => {
    const resource = { kind: "table" as const, id: "table_toggle" };
    const change = (categoryId: string, added: boolean) => ({
      connectionId: sharedConnectionId,
      resource,
      patch: { categoryChange: { categoryId, added } },
    });
    await Promise.all([
      asActor(owner, orgA, () =>
        updateMetadata.run(change(categoryAId, true), actionContext()),
      ),
      asActor(owner, orgA, () =>
        updateMetadata.run(change(categoryA2Id, true), actionContext()),
      ),
    ]);
    const both = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(new Set(both.resources[0]?.categoryIds)).toEqual(
      new Set([categoryAId, categoryA2Id]),
    );

    await asActor(owner, orgA, () =>
      updateMetadata.run(change(categoryAId, false), actionContext()),
    );
    const remaining = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(remaining.resources[0]?.categoryIds).toEqual([categoryA2Id]);

    // A duplicate add is a no-op, not a second entry.
    await asActor(owner, orgA, () =>
      updateMetadata.run(change(categoryA2Id, true), actionContext()),
    );
    await asActor(owner, orgA, () =>
      updateMetadata.run(change(categoryA2Id, true), actionContext()),
    );
    const duplicateAdd = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(duplicateAdd.resources[0]?.categoryIds).toEqual([categoryA2Id]);

    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(change(categoryA2Id, false), actionContext()),
      ),
    ).resolves.toMatchObject({ categoryIds: [] });
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(change(categoryA2Id, true), actionContext()),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a category change for an id outside the organisation", async () => {
    const orgBOnly = (
      await createDataCategory(scopeB, { name: "QA Only B", color: "#444444" })
    ).id;
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource: { kind: "table", id: "table_foreign_change" },
            patch: { categoryChange: { categoryId: orgBOnly, added: true } },
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_category_not_found",
    });
  });

  it("allows a delegated app manager to annotate but not to administer the catalogue", async () => {
    const updated = await asActor(delegated, orgA, () =>
      updateMetadata.run(
        {
          connectionId: sharedConnectionId,
          resource: { kind: "table", id: "table_delegated" },
          patch: { description: "Delegated annotation" },
        },
        actionContext(delegated),
      ),
    );
    expect(updated.description).toBe("Delegated annotation");
    await expect(
      asActor(delegated, orgA, () =>
        createCategory.run(
          { name: "QA Delegated", color: "#555555" },
          actionContext(delegated),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_category_admin_required",
    });
  });

  it("lets an organisation admin create a category", async () => {
    const created = await asActor(orgAdmin, orgA, () =>
      createCategory.run(
        { name: "QA Org Admin", color: "#666666" },
        actionContext(orgAdmin),
      ),
    );
    expect(created.category.name).toBe("QA Org Admin");
    expect(created.category.color).toBe("#666666");
  });

  it("rejects an empty patch without writing an annotation", async () => {
    const resource = { kind: "table" as const, id: "table_empty_patch" };
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          { connectionId: sharedConnectionId, resource, patch: {} },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_patch_empty",
    });
    const read = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: sharedConnectionId, resources: [resource] },
        actionContext(),
      ),
    );
    expect(read.resources[0]).toMatchObject({
      description: "",
      statusId: null,
      categoryIds: [],
      aiUsage: null,
    });
  });

  it("shares the connection-ref invariant with targeted reads", async () => {
    await expect(
      asActor(owner, orgA, () =>
        listMetadata.run(
          {
            connectionId: sharedConnectionId,
            resources: [{ kind: "connection", id: "not-this-connection" }],
          },
          actionContext(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "data_resource_ref_mismatch",
    });
  });

  it("exposes the saved connection description without touching provider config", async () => {
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId: sharedConnectionId,
          resource: { kind: "connection", id: sharedConnectionId },
          patch: { description: "Warehouse description" },
        },
        actionContext(),
      ),
    );
    expect(await readConnectionDescription(scopeA, sharedConnectionId)).toBe(
      "Warehouse description",
    );
    await expect(
      asActor(member, orgA, () =>
        updateMetadata.run(
          {
            connectionId: sharedConnectionId,
            resource: { kind: "connection", id: sharedConnectionId },
            patch: { description: "Viewer overwrite" },
          },
          actionContext(member),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await readConnectionDescription(scopeA, sharedConnectionId)).toBe(
      "Warehouse description",
    );
  });

  it("rejects a category colour outside the owned hex contract", () => {
    expect(
      createCategory.schema.safeParse({ name: "QA Bad", color: "red" }).success,
    ).toBe(false);
    expect(
      createCategory.schema.safeParse({ name: "QA Bad", color: "#1234567" })
        .success,
    ).toBe(false);
    expect(
      createCategory.schema.safeParse({ name: "QA Good", color: "#A1b2C3" })
        .success,
    ).toBe(true);
  });
});

describe("catalogue cap", () => {
  it("stops at the bounded catalogue size", async () => {
    const scopeC = {
      ownerEmail: owner,
      orgId: `qa-metadata-c-${randomUUID()}`,
    };
    for (let index = 0; index < 100; index += 1) {
      await createDataCategory(scopeC, {
        name: `QA Cap ${String(index)}`,
        color: "#123456",
      });
    }
    await expect(
      createDataCategory(scopeC, { name: "QA Cap overflow", color: "#123456" }),
    ).rejects.toMatchObject({ code: "data_category_limit_reached" });
    expect((await readDataCategories(scopeC)).categories).toHaveLength(100);
  });
});

describe("annotation cleanup", () => {
  it("deletes only the annotations for the exact connection", async () => {
    const before = await asActor(owner, orgA, () =>
      listMetadata.run({ connectionId: sharedConnectionId }, actionContext()),
    );
    expect(before.resources.length).toBeGreaterThan(0);
    const removed = await deleteConnectionAnnotationSettings(
      scopeA,
      bulkConnectionId,
    );
    expect(removed.deleted).toBe(66);
    expect(
      (
        await asActor(owner, orgA, () =>
          listMetadata.run({ connectionId: bulkConnectionId }, actionContext()),
        )
      ).resources,
    ).toEqual([]);
    const after = await asActor(owner, orgA, () =>
      listMetadata.run({ connectionId: sharedConnectionId }, actionContext()),
    );
    expect(after.resources).toEqual(before.resources);
    expect(
      (await readDataCategories(scopeA)).categories.length,
    ).toBeGreaterThan(0);
  });
});

describe("canonical authority and deletion coordination", () => {
  it("records field initialization independently and preserves the raw override", async () => {
    const connectionId = (
      await asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          provider: "bigquery",
          label: "QA authority warehouse",
        }),
      )
    ).id;
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId,
          resource: { kind: "connection", id: connectionId },
          patch: { aiUsage: "excluded" },
        },
        actionContext(),
      ),
    );
    const aiOnly = await readConnectionAnnotationOverride(scopeA, connectionId);
    expect(aiOnly).toMatchObject({
      description: "",
      descriptionInitialized: false,
      aiUsage: "excluded",
      aiUsageInitialized: true,
      revision: 1,
    });
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId,
          resource: { kind: "connection", id: connectionId },
          patch: { description: "" },
        },
        actionContext(),
      ),
    );
    expect(
      await readConnectionAnnotationOverride(scopeA, connectionId),
    ).toMatchObject({
      description: "",
      descriptionInitialized: true,
      aiUsageInitialized: true,
      revision: 2,
    });
    expect(await readConnectionDescription(scopeA, connectionId)).toBe("");
  });

  it("clears descendant AI overrides when the connection policy changes", async () => {
    const connectionId = (
      await asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          provider: "bigquery",
          label: "QA cascade warehouse",
        }),
      )
    ).id;
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId,
          resource: { kind: "schema", id: "schema_cascade" },
          patch: { aiUsage: "included" },
        },
        actionContext(),
      ),
    );
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId,
          resource: { kind: "connection", id: connectionId },
          patch: { aiUsage: "excluded" },
        },
        actionContext(),
      ),
    );
    const child = await asActor(owner, orgA, () =>
      listMetadata.run(
        {
          connectionId,
          resources: [{ kind: "schema", id: "schema_cascade" }],
        },
        actionContext(),
      ),
    );
    expect(child.resources[0]).toMatchObject({ aiUsage: null });
    expect(
      (
        await readDataResourceMetadata(scopeA, connectionId, [
          { kind: "schema", id: "schema_cascade" },
        ])
      ).resources[0]?.aiUsage,
    ).toBeNull();
    expect((await resetDescendantAiUsage(scopeA, connectionId)).cleared).toBe(
      0,
    );
  });

  it("blocks late annotation writes after the terminal tombstone", async () => {
    const connectionId = (
      await asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          provider: "bigquery",
          label: "QA deletion warehouse",
        }),
      )
    ).id;
    const foreign = (
      await asActor(owner, orgA, () =>
        upsertWorkspaceConnection({
          provider: "bigquery",
          label: "QA deletion neighbour",
        }),
      )
    ).id;
    const write = (description: string) =>
      asActor(owner, orgA, () =>
        updateMetadata.run(
          {
            connectionId,
            resource: { kind: "schema", id: "schema_late" },
            patch: { description },
          },
          actionContext(),
        ),
      );

    // Write first, then delete: phase 1 cleans the saved annotation.
    await write("before deletion");
    await beginConnectionDeletionPhases(scopeA, connectionId);
    expect(
      (
        await readDataResourceMetadata(scopeA, connectionId, [
          { kind: "schema", id: "schema_late" },
        ])
      ).resources[0]?.description,
    ).toBe("");
    await expect(write("after tombstone")).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "data_connection_deleting",
    });

    // A different connection is untouched.
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId: foreign,
          resource: { kind: "schema", id: "schema_neighbour" },
          patch: { description: "neighbour stays" },
        },
        actionContext(),
      ),
    );
    await finishConnectionDeletionPhases(scopeA, connectionId);
    expect(await readConnectionDeletionState(scopeA, connectionId)).toBe(
      "deleted",
    );
    await expect(write("after finish")).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "data_connection_deleted",
    });
    expect(
      (
        await readDataResourceMetadata(scopeA, foreign, [
          { kind: "schema", id: "schema_neighbour" },
        ])
      ).resources[0]?.description,
    ).toBe("neighbour stays");
  });
});

describe("guarded annotation policy", () => {
  it("rolls back a root AI change when resetting a descendant fails", async () => {
    const connection = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA reset rollback",
        config: { includeForAI: true },
      }),
    );
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId: connection.id,
          resource: { kind: "schema", id: "schema_rollback" },
          patch: { aiUsage: "excluded" },
        },
        actionContext(),
      ),
    );
    failureControl.descendantReset = true;
    try {
      await expect(
        asActor(owner, orgA, () =>
          updateMetadata.run(
            {
              connectionId: connection.id,
              resource: { kind: "connection", id: connection.id },
              patch: { aiUsage: "excluded" },
            },
            actionContext(),
          ),
        ),
      ).rejects.toThrow("Controlled descendant reset failure");
    } finally {
      failureControl.descendantReset = false;
    }
    const stored = await readConnectionAnnotationOverride(
      scopeA,
      connection.id,
    );
    expect(stored?.aiUsageInitialized === true).toBe(false);
    const children = await readDataResourceMetadata(scopeA, connection.id, [
      { kind: "schema", id: "schema_rollback" },
    ]);
    expect(children.resources[0]?.aiUsage).toBe("excluded");
  });

  it("denies agent metadata reads and clearing an excluded child policy", async () => {
    const connection = await asActor(owner, orgA, () =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA child policy",
        config: { includeForAI: true },
      }),
    );
    const resource = {
      kind: "schema" as const,
      id: "schema:qa-project:restricted",
    };
    await asActor(owner, orgA, () =>
      updateMetadata.run(
        {
          connectionId: connection.id,
          resource,
          patch: { aiUsage: "excluded", description: "Restricted metadata" },
        },
        actionContext(),
      ),
    );
    const agentContext = { ...actionContext(), caller: "agent" as const };
    await expect(
      asActor(owner, orgA, () =>
        updateMetadata.run(
          { connectionId: connection.id, resource, patch: { aiUsage: null } },
          agentContext as never,
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "data_resource_ai_disabled",
    });
    const prefix = await asActor(owner, orgA, () =>
      listMetadata.run({ connectionId: connection.id }, agentContext as never),
    );
    expect(prefix.resources.some((entry) => entry.id === resource.id)).toBe(
      false,
    );
    const targeted = await asActor(owner, orgA, () =>
      listMetadata.run(
        { connectionId: connection.id, resources: [resource] },
        agentContext as never,
      ),
    );
    expect(targeted.resources).toEqual([]);
    const readback = await readDataResourceMetadata(scopeA, connection.id, [
      resource,
    ]);
    expect(readback.resources[0]?.aiUsage).toBe("excluded");
    expect(readback.resources[0]?.description).toBe("Restricted metadata");
  });
});

it("does not resurrect an annotation when deletion races a paused writer", async () => {
  const connection = await asActor(owner, orgA, () =>
    upsertWorkspaceConnection({
      provider: "bigquery",
      label: "QA guarded race",
    }),
  );
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  failureControl.pausedWriter = { entered, resume };
  const writer = asActor(owner, orgA, () =>
    updateMetadata.run(
      {
        connectionId: connection.id,
        resource: { kind: "schema", id: "schema_race" },
        patch: { description: "Racing annotation" },
      },
      actionContext(),
    ),
  );
  let deletion: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await waiting;
    deletion = beginConnectionDeletionPhases(scopeA, connection.id);
    // With serialization deletion waits; without it deletion may finish before
    // the paused writer. Either schedule must leave every annotation absent.
    await Promise.race([
      deletion,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    failureControl.pausedWriter = null;
    release();
  }
  const outcome = await Promise.allSettled([writer]);
  await deletion;
  if (outcome[0]?.status === "rejected")
    expect(outcome[0].reason).toMatchObject({ statusCode: 409 });
  expect(
    (await readDataResourceMetadata(scopeA, connection.id)).resources,
  ).toEqual([]);
});
