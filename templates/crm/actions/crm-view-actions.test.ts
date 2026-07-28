// Integration tests for the saved-view actions against a real libsql database
// and the real migrations — including the list action reading a view's stored
// filter, which is the whole reason saved views exist.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-view-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const ORG = "org_1";
const CONNECTION = "conn_1";
const SCOPE_KEY = "native:conn_1";

const SCOPE = {
  key: SCOPE_KEY,
  actorId: OWNER,
  mode: "native",
  objectReadable: true,
  objectCreateable: true,
  objectUpdateable: true,
  objectDeleteable: true,
  recordVisibility: "workspace",
} as const;

const ownership = {
  ownerEmail: OWNER,
  orgId: ORG,
  visibility: "org" as const,
};

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let saveView: typeof import("./save-crm-saved-view.js").default;
let listViews: typeof import("./list-crm-saved-views.js").default;
let deleteView: typeof import("./delete-crm-saved-view.js").default;
let listRecords: typeof import("./list-crm-records.js").default;

let counter = 0;
let stageAttributeId = "";
let textAttributeId = "";
let acme = "";
let globex = "";

/** A competing writer that lands at a distinct instant. */
async function otherWriter(id: string, name: string): Promise<void> {
  await getDb()
    .update(schema.crmSavedViews)
    .set({ name, updatedAt: "2099-01-01T00:00:00.000Z" })
    .where(eq(schema.crmSavedViews.id, id));
}

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail: OWNER, orgId: ORG },
    fn,
  ) as Promise<T>;
}

async function save(args: Record<string, unknown>) {
  return asOwner(() => saveView.run(saveView.schema.parse(args) as never));
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = await import("../server/db/schema.js");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  saveView = (await import("./save-crm-saved-view.js")).default;
  listViews = (await import("./list-crm-saved-views.js")).default;
  deleteView = (await import("./delete-crm-saved-view.js")).default;
  listRecords = (await import("./list-crm-records.js")).default;

  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(schema.crmConnections).values({
    id: CONNECTION,
    provider: "native",
    label: "Native",
    mode: "native",
    accessScopeKey: SCOPE_KEY,
    accessScopeJson: JSON.stringify(SCOPE),
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.crmObjects).values({
    id: "obj_1",
    connectionId: CONNECTION,
    provider: "native",
    objectType: "companies",
    kind: "account",
    label: "Company",
    pluralLabel: "Companies",
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });

  stageAttributeId = `attr_${++counter}`;
  textAttributeId = `attr_${++counter}`;
  for (const [id, slug, attributeType] of [
    [stageAttributeId, "stage", "status"],
    [textAttributeId, "notes", "text"],
  ] as const) {
    await db.insert(schema.crmFieldPolicies).values({
      id,
      connectionId: CONNECTION,
      objectType: "companies",
      fieldName: slug,
      apiSlug: slug,
      label: slug,
      valueType: "string",
      storagePolicy: "local-authoritative",
      attributeType,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const [name, stage] of [
    ["Acme Corp", "Won"],
    ["Globex", "Discovery"],
  ] as const) {
    const id = `rec_${++counter}`;
    if (name === "Acme Corp") acme = id;
    else globex = id;
    await db.insert(schema.crmRecords).values({
      id,
      connectionId: CONNECTION,
      provider: "native",
      objectType: "companies",
      kind: "account",
      remoteId: id,
      displayName: name,
      accessScopeKey: SCOPE_KEY,
      accessScopeJson: JSON.stringify(SCOPE),
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.crmRecordFields).values({
      id: `fld_${++counter}`,
      recordId: id,
      attributeId: stageAttributeId,
      fieldPolicyId: stageAttributeId,
      fieldName: "stage",
      valueType: "string",
      storagePolicy: "local-authoritative",
      stringValue: stage,
      activeFrom: now,
      accessScopeKey: SCOPE_KEY,
      accessScopeJson: JSON.stringify(SCOPE),
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  }
}, 120_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("save-crm-saved-view", () => {
  it("stores a typed filter, sort, columns, and audience", async () => {
    const saved = (await save({
      name: "Open pipeline",
      kind: "account",
      audience: "personal",
      filter: {
        op: "and",
        conditions: [
          { attributeId: "stage", condition: "is-any-of", value: ["Won"] },
        ],
      },
      sort: [{ field: "displayName", direction: "asc" }],
      columns: [{ attributeId: "displayName", width: 240 }, "stage"],
    })) as any;

    expect(saved.visibility).toBe("private");
    const listed = (await asOwner(() =>
      listViews.run(listViews.schema.parse({}) as never),
    )) as any;
    const view = listed.views.find((entry: any) => entry.id === saved.id);
    expect(view).toMatchObject({
      name: "Open pipeline",
      viewKind: "table",
      targetKind: "object",
      audience: "personal",
      columns: [
        { attributeId: "displayName", width: 240 },
        { attributeId: "stage" },
      ],
      sort: [{ field: "displayName", direction: "asc" }],
    });
    expect(view.filters.conditions).toEqual([
      { attributeId: "stage", condition: "is-any-of", value: ["Won"] },
    ]);
  });

  it("normalizes the legacy query/fieldEquals blob into a typed filter", async () => {
    const saved = (await save({
      name: "Legacy",
      kind: "account",
      filters: { query: "Acme", fieldEquals: { stage: "Won" } },
      columns: ["displayName", "stage"],
    })) as any;

    expect(saved.view.filter).toEqual({
      op: "and",
      conditions: [
        { field: "displayName", condition: "contains", value: "Acme" },
        { attributeId: "stage", condition: "is", value: "Won" },
      ],
    });
  });

  it("marks a shared view with org visibility", async () => {
    const saved = (await save({
      name: "Team view",
      audience: "shared",
    })) as any;
    expect(saved.visibility).toBe("org");
  });

  it("rejects a board view whose grouping is not a status attribute", async () => {
    await expect(
      save({
        name: "Bad board",
        viewKind: "board",
        groupByAttributeId: textAttributeId,
      }),
    ).rejects.toMatchObject({
      code: "crm-saved-view-group-by",
      statusCode: 422,
    });

    await expect(
      save({ name: "Board with no grouping", viewKind: "board" }),
    ).rejects.toMatchObject({ code: "crm-saved-view-group-by" });

    await expect(
      save({
        name: "Missing attribute",
        viewKind: "board",
        groupByAttributeId: "attr_nope",
      }),
    ).rejects.toMatchObject({ code: "crm-saved-view-group-by" });

    const board = (await save({
      name: "Pipeline board",
      viewKind: "board",
      groupByAttributeId: stageAttributeId,
    })) as any;
    expect(board.viewKind).toBe("board");
    expect(board.groupByAttributeId).toBe(stageAttributeId);
  });

  it("reports a concurrent edit instead of clobbering it", async () => {
    const saved = (await save({ name: "Contended" })) as any;
    const stale = saved.updatedAt;

    // Simulate the other writer out of band: two saves in the same millisecond
    // would leave `updatedAt` unchanged and the race would not be observable.
    await otherWriter(saved.id, "Renamed by someone else");

    await expect(
      save({
        id: saved.id,
        name: "My overwrite",
        expectedUpdatedAt: stale,
      }),
    ).rejects.toMatchObject({
      code: "crm-saved-view-conflict",
      statusCode: 409,
    });

    const [row] = await getDb()
      .select()
      .from(schema.crmSavedViews)
      .where(eq(schema.crmSavedViews.id, saved.id));
    expect(row.name).toBe("Renamed by someone else");
  });

  it("updates in place when expectedUpdatedAt still matches", async () => {
    const saved = (await save({ name: "Fresh" })) as any;
    const updated = (await save({
      id: saved.id,
      name: "Fresh renamed",
      expectedUpdatedAt: saved.updatedAt,
    })) as any;
    expect(updated.name).toBe("Fresh renamed");
  });
});

describe("delete-crm-saved-view", () => {
  it("deletes the view and refuses a stale delete", async () => {
    const saved = (await save({ name: "Temporary" })) as any;
    const stale = saved.updatedAt;
    await otherWriter(saved.id, "Temporary again");

    await expect(
      asOwner(() =>
        deleteView.run(
          deleteView.schema.parse({
            id: saved.id,
            expectedUpdatedAt: stale,
          }) as never,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    await asOwner(() =>
      deleteView.run(deleteView.schema.parse({ id: saved.id }) as never),
    );
    const rows = await getDb()
      .select()
      .from(schema.crmSavedViews)
      .where(eq(schema.crmSavedViews.id, saved.id));
    expect(rows).toHaveLength(0);
  });
});

describe("list-crm-records with a saved view", () => {
  it("applies the view's stored filter in SQL", async () => {
    const saved = (await save({
      name: "Won accounts",
      kind: "account",
      filter: {
        op: "and",
        conditions: [{ attributeId: "stage", condition: "is", value: "Won" }],
      },
    })) as any;

    const result = (await asOwner(() =>
      listRecords.run(
        listRecords.schema.parse({ viewId: saved.id }) as never,
        { userEmail: OWNER, orgId: ORG } as never,
      ),
    )) as any;

    expect(result.records.map((record: any) => record.id)).toEqual([acme]);
    expect(result.complete).toBe(true);
    expect(result.appliedView).toMatchObject({
      id: saved.id,
      viewKind: "table",
    });
    expect(globex).toBeTruthy();
  });

  it("refuses an inline filter alongside a saved view", async () => {
    const saved = (await save({ name: "Conflicting" })) as any;
    await expect(
      asOwner(() =>
        listRecords.run(
          listRecords.schema.parse({
            viewId: saved.id,
            filter: {
              op: "and",
              conditions: [
                { field: "displayName", condition: "contains", value: "x" },
              ],
            },
          }) as never,
          { userEmail: OWNER, orgId: ORG } as never,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-filter-conflict" });
  });
});
