// Integration tests for the CRM list actions against a real libsql (SQLite)
// database with the app's own migrations applied. Lists are the workflow
// overlay: entry attribute values live on the entry, one record may hold more
// than one entry in a list, and a stage move is a bitemporal write — none of
// which can be verified against a mocked query builder.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-list-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "other@example.test";
const CONNECTION_ID = "conn_lists";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;

let createCrmList: any;
let listCrmLists: any;
let updateCrmList: any;
let listCrmListEntries: any;
let addCrmRecordToList: any;
let updateCrmListEntry: any;
let removeCrmListEntry: any;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

const asOwner = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
const asOther = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OTHER }, fn) as Promise<T>;

const ownerCtx = { caller: "frontend" as const, userEmail: OWNER, orgId: null };
const otherCtx = { caller: "frontend" as const, userEmail: OTHER, orgId: null };

let counter = 0;

async function createRecord(
  objectType: string,
  displayName: string,
): Promise<string> {
  const id = `rec_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType,
      kind: objectType === "people" ? "person" : "account",
      remoteId: id,
      displayName,
      accessScopeKey: "native",
      accessScopeJson: "{}",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

/** Every `crm_record_fields` row for one entry + attribute, oldest first. */
function entryFieldRows(entryId: string, apiSlug: string) {
  return getDb()
    .select()
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.entryId, entryId),
        eq(schema.crmRecordFields.fieldName, apiSlug),
      ),
    )
    .orderBy(asc(schema.crmRecordFields.activeFrom));
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;

  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  createCrmList = (await import("./create-crm-list.js")).default;
  listCrmLists = (await import("./list-crm-lists.js")).default;
  updateCrmList = (await import("./update-crm-list.js")).default;
  listCrmListEntries = (await import("./list-crm-list-entries.js")).default;
  addCrmRecordToList = (await import("./add-crm-record-to-list.js")).default;
  updateCrmListEntry = (await import("./update-crm-list-entry.js")).default;
  removeCrmListEntry = (await import("./remove-crm-list-entry.js")).default;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      status: "connected",
      accessScopeKey: "native",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function newList(name: string, parentObjectType = "companies") {
  return asOwner(() =>
    createCrmList.run(
      { connectionId: CONNECTION_ID, name, parentObjectType },
      ownerCtx,
    ),
  );
}

describe("create-crm-list", () => {
  it("seeds a Stage attribute on the list and derives an immutable slug", async () => {
    const list = await newList("Q3 Renewals");

    expect(list).toMatchObject({
      name: "Q3 Renewals",
      apiSlug: "q3_renewals",
      parentObjectType: "companies",
      source: "local",
      archived: false,
      ownerEmail: OWNER,
    });

    const attributes = await getDb()
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.targetId, list.id));
    expect(attributes).toHaveLength(1);
    expect(attributes[0]).toMatchObject({
      target: "list",
      targetId: list.id,
      // Mirrors target_id so the legacy (connection_id, object_type,
      // field_name) unique index keeps guarding one attribute per list.
      objectType: list.id,
      apiSlug: "stage",
      attributeType: "status",
      storagePolicy: "local-authoritative",
      historyTracked: true,
    });

    const options = await getDb()
      .select()
      .from(schema.crmAttributeOptions)
      .where(eq(schema.crmAttributeOptions.attributeId, list.stageAttributeId));
    expect(options.map((option: any) => option.value)).toEqual([
      "new",
      "in-progress",
      "won",
      "lost",
    ]);
    expect(
      options.find((option: any) => option.value === "won").celebrate,
    ).toBe(true);
  });

  it("does not reuse a slug that is already taken", async () => {
    const first = await newList("Pipeline");
    const second = await newList("Pipeline");
    expect(first.apiSlug).toBe("pipeline");
    expect(second.apiSlug).toBe("pipeline_2");
  });
});

describe("list membership", () => {
  it("allows the same record to hold more than one entry in one list", async () => {
    const list = await newList("Expansion");
    const recordId = await createRecord("companies", "Acme");

    const first = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    const second = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );

    expect(first.existingEntryIds).toEqual([]);
    expect(second.existingEntryIds).toEqual([first.entryId]);
    expect(second.entryId).not.toBe(first.entryId);

    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries.map((entry: any) => entry.recordId)).toEqual([
      recordId,
      recordId,
    ]);
  });

  it("rejects a record whose objectType is not the list's parentObjectType", async () => {
    const list = await newList("Target Accounts", "companies");
    const personId = await createRecord("people", "Ada Lovelace");

    await expect(
      asOwner(() =>
        addCrmRecordToList.run(
          { listId: list.id, recordId: personId },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "crm-list-object-type-mismatch",
      statusCode: 422,
    });

    const entries = await getDb()
      .select()
      .from(schema.crmListEntries)
      .where(eq(schema.crmListEntries.listId, list.id));
    expect(entries).toHaveLength(0);
  });

  it("rejects an unknown entry attribute instead of dropping the value", async () => {
    const list = await newList("Strict Values");
    const recordId = await createRecord("companies", "Globex");

    await expect(
      asOwner(() =>
        addCrmRecordToList.run(
          { listId: list.id, recordId, values: { nope: "x" } },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-list-attribute-unknown" });

    // The transaction rolled the entry back with the rejected value.
    const entries = await getDb()
      .select()
      .from(schema.crmListEntries)
      .where(eq(schema.crmListEntries.listId, list.id));
    expect(entries).toHaveLength(0);
  });

  it("rejects an unknown status option rather than creating it", async () => {
    const list = await newList("Managed Options");
    const recordId = await createRecord("companies", "Initech");

    await expect(
      asOwner(() =>
        addCrmRecordToList.run(
          { listId: list.id, recordId, values: { stage: "invented" } },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-unknown-option" });
  });
});

describe("entry attribute values", () => {
  it("opens bitemporal history so time-in-stage is derivable from a stage move", async () => {
    const list = await newList("Deal Flow");
    const recordId = await createRecord("companies", "Hooli");
    const { entryId } = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "new" } },
        ownerCtx,
      ),
    );

    const moved = await asOwner(() =>
      updateCrmListEntry.run({ entryId, values: { stage: "won" } }, ownerCtx),
    );
    expect(moved.values).toEqual([
      { attribute: "stage", changed: true, mode: "close-and-insert" },
    ]);

    // Writing the same stage again must not open another history row.
    const repeat = await asOwner(() =>
      updateCrmListEntry.run({ entryId, values: { stage: "won" } }, ownerCtx),
    );
    expect(repeat.values).toEqual([{ attribute: "stage", changed: false }]);

    const rows = await entryFieldRows(entryId, "stage");
    expect(rows).toHaveLength(2);
    const [closed, current] = rows;
    expect(closed.stringValue).toBe("new");
    expect(current.stringValue).toBe("won");
    expect(current.activeUntil).toBeNull();
    expect(closed.activeUntil).toBe(current.activeFrom);
    const timeInStageMs =
      Date.parse(closed.activeUntil) - Date.parse(closed.activeFrom);
    expect(Number.isFinite(timeInStageMs)).toBe(true);
    expect(timeInStageMs).toBeGreaterThanOrEqual(0);

    // Entry values live on the entry, never on the record.
    expect(rows.every((row: any) => row.entryId === entryId)).toBe(true);
    const recordRows = await getDb()
      .select()
      .from(schema.crmRecordFields)
      .where(eq(schema.crmRecordFields.recordId, recordId));
    expect(recordRows.every((row: any) => row.entryId === entryId)).toBe(true);
  });

  it("keeps two entries for one record on independent stages", async () => {
    const list = await newList("Parallel Deals");
    const recordId = await createRecord("companies", "Vandelay");
    const a = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "new" } },
        ownerCtx,
      ),
    );
    const b = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "lost" } },
        ownerCtx,
      ),
    );

    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    const stages = new Map(
      page.entries.map((entry: any) => [entry.id, entry.values.stage]),
    );
    expect(stages.get(a.entryId)).toBe("new");
    expect(stages.get(b.entryId)).toBe("lost");
    for (const entry of page.entries) {
      expect(typeof entry.valuesSince.stage).toBe("string");
    }
    expect(page.attributes[0]).toMatchObject({
      apiSlug: "stage",
      attributeType: "status",
      usesOptions: true,
    });
    expect(page.attributes[0].options.map((o: any) => o.value)).toEqual([
      "new",
      "in-progress",
      "won",
      "lost",
    ]);
  });
});

describe("list-crm-list-entries filtering, sorting, and pagination", () => {
  let listId = "";
  let wonRecordIds: string[] = [];

  beforeAll(async () => {
    const list = await newList("Server Side");
    listId = list.id;
    const stages = ["new", "new", "won", "in-progress", "won"];
    wonRecordIds = [];
    for (const [index, stage] of stages.entries()) {
      const recordId = await createRecord("companies", `Co ${index}`);
      if (stage === "won") wonRecordIds.push(recordId);
      await asOwner(() =>
        addCrmRecordToList.run(
          { listId, recordId, values: { stage } },
          ownerCtx,
        ),
      );
    }
  }, 30_000);

  it("filters on an entry attribute in SQL, not after the page is cut", async () => {
    // Positions 0 and 1 are `new`. If the filter ran after paging, a one-row
    // page would return zero `won` entries here.
    const first = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          filters: [{ attribute: "stage", operator: "eq", value: "won" }],
          sort: [{ attribute: "entry.position", direction: "asc" }],
          limit: 1,
        },
        ownerCtx,
      ),
    );
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0].recordId).toBe(wonRecordIds[0]);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBe("1");

    const second = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          filters: [{ attribute: "stage", operator: "eq", value: "won" }],
          sort: [{ attribute: "entry.position", direction: "asc" }],
          limit: 1,
          cursor: first.nextCursor,
        },
        ownerCtx,
      ),
    );
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].recordId).toBe(wonRecordIds[1]);
    expect(second.complete).toBe(true);
    expect(second.nextCursor).toBeUndefined();
  });

  it("supports in, contains, and empty filters", async () => {
    const inFilter = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          filters: [
            {
              attribute: "stage",
              operator: "in",
              value: ["won", "in-progress"],
            },
          ],
        },
        ownerCtx,
      ),
    );
    expect(inFilter.entries).toHaveLength(3);

    const contains = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          filters: [
            {
              attribute: "record.displayName",
              operator: "contains",
              value: "co 3",
            },
          ],
        },
        ownerCtx,
      ),
    );
    expect(contains.entries).toHaveLength(1);
    expect(contains.entries[0].record.displayName).toBe("Co 3");

    const empty = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          filters: [{ attribute: "stage", operator: "is-empty" }],
        },
        ownerCtx,
      ),
    );
    expect(empty.entries).toHaveLength(0);
  });

  it("sorts on the joined entry attribute server-side", async () => {
    const sorted = await asOwner(() =>
      listCrmListEntries.run(
        {
          listId,
          sort: [{ attribute: "stage", direction: "desc" }],
          limit: 2,
        },
        ownerCtx,
      ),
    );
    expect(sorted.entries.map((entry: any) => entry.values.stage)).toEqual([
      "won",
      "won",
    ]);
  });

  it("rejects an unknown filter field instead of ignoring it", async () => {
    await expect(
      asOwner(() =>
        listCrmListEntries.run(
          {
            listId,
            filters: [{ attribute: "made.up", operator: "eq", value: "x" }],
          },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-list-field-unknown" });
  });
});

describe("remove-crm-list-entry", () => {
  it("removes the entry and its values, never the record or a sibling entry", async () => {
    const list = await newList("Removals");
    const recordId = await createRecord("companies", "Stark");
    const keep = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "new" } },
        ownerCtx,
      ),
    );
    const drop = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "won" } },
        ownerCtx,
      ),
    );

    const result = await asOwner(() =>
      removeCrmListEntry.run({ entryId: drop.entryId }, ownerCtx),
    );
    expect(result).toMatchObject({
      entryId: drop.entryId,
      recordId,
      removed: true,
      recordDeleted: false,
    });

    const [record] = await getDb()
      .select()
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, recordId));
    expect(record).toMatchObject({ id: recordId, displayName: "Stark" });

    expect(await entryFieldRows(drop.entryId, "stage")).toHaveLength(0);
    expect(await entryFieldRows(keep.entryId, "stage")).toHaveLength(1);

    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries.map((entry: any) => entry.id)).toEqual([keep.entryId]);
  });
});

describe("access scoping", () => {
  it("hides another user's private list and refuses writes to it", async () => {
    const list = await newList("Owner Only");
    const recordId = await createRecord("companies", "Wayne");
    const entry = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );

    const visible = await asOther(() => listCrmLists.run({}, otherCtx));
    expect(visible.lists.some((row: any) => row.id === list.id)).toBe(false);

    await expect(
      asOther(() => listCrmListEntries.run({ listId: list.id }, otherCtx)),
    ).rejects.toMatchObject({ code: "crm-list-not-found" });

    await expect(
      asOther(() =>
        updateCrmList.run({ listId: list.id, name: "Hijacked" }, otherCtx),
      ),
    ).rejects.toMatchObject({ code: "crm-list-not-found" });

    await expect(
      asOther(() =>
        addCrmRecordToList.run({ listId: list.id, recordId }, otherCtx),
      ),
    ).rejects.toMatchObject({ code: "crm-list-not-found" });

    await expect(
      asOther(() =>
        removeCrmListEntry.run({ entryId: entry.entryId }, otherCtx),
      ),
    ).rejects.toMatchObject({ code: "crm-list-entry-not-found" });

    const [stillThere] = await getDb()
      .select()
      .from(schema.crmListEntries)
      .where(eq(schema.crmListEntries.id, entry.entryId));
    expect(stillThere).toBeTruthy();
  });
});

describe("list-crm-lists and update-crm-list", () => {
  it("reports entry counts and applies scoped updates", async () => {
    const list = await newList("Counted");
    const a = await createRecord("companies", "One");
    const b = await createRecord("companies", "Two");
    await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId: a }, ownerCtx),
    );
    await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId: b }, ownerCtx),
    );

    const before = await asOwner(() =>
      listCrmLists.run({ connectionId: CONNECTION_ID, limit: 100 }, ownerCtx),
    );
    expect(before.lists.find((row: any) => row.id === list.id).entryCount).toBe(
      2,
    );

    const updated = await asOwner(() =>
      updateCrmList.run(
        { listId: list.id, name: "Counted Deals", archived: true },
        ownerCtx,
      ),
    );
    expect(updated).toMatchObject({
      name: "Counted Deals",
      archived: true,
      // Immutable once assigned.
      apiSlug: list.apiSlug,
    });

    const active = await asOwner(() =>
      listCrmLists.run({ connectionId: CONNECTION_ID, limit: 100 }, ownerCtx),
    );
    expect(active.lists.some((row: any) => row.id === list.id)).toBe(false);

    const archived = await asOwner(() =>
      listCrmLists.run(
        { connectionId: CONNECTION_ID, includeArchived: true, limit: 100 },
        ownerCtx,
      ),
    );
    expect(archived.lists.some((row: any) => row.id === list.id)).toBe(true);
  });

  it("rejects a defaultViewId the caller cannot see", async () => {
    const list = await newList("Default View");
    await expect(
      asOwner(() =>
        updateCrmList.run(
          { listId: list.id, defaultViewId: "view_does_not_exist" },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-saved-view-not-found" });
  });
});
