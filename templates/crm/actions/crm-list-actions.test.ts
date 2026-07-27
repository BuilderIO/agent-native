// Integration tests for the CRM list actions against a real libsql (SQLite)
// database with the app's own migrations applied. Lists are the workflow
// overlay: entry attribute values live on the entry, one record may hold more
// than one entry in a list, and a stage move is a bitemporal write — none of
// which can be verified against a mocked query builder.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BOARD_UNGROUPED,
  boardColumns,
  boardColumnTotals,
  cardAmountFor,
  pickCurrencyAttribute,
} from "../app/components/crm/board/board-model.js";

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
let writeCrmRecordField: (typeof import("../server/lib/record-fields.js"))["writeCrmRecordField"];

let configureNativeCrm: any;
let createCrmRecord: any;
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

  writeCrmRecordField = (await import("../server/lib/record-fields.js"))
    .writeCrmRecordField;
  configureNativeCrm = (await import("./configure-native-crm.js")).default;
  createCrmRecord = (await import("./create-crm-record.js")).default;
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
  it("seeds a Stage and a currency attribute on the list and derives an immutable slug", async () => {
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
    // A board with no stage has no columns and a board with no currency has no
    // column total, so both are the floor for a new list — `companies` here
    // declares neither, so both come from the fallbacks.
    expect(
      attributes.map((row: any) => [row.apiSlug, row.attributeType]).sort(),
    ).toEqual([
      ["amount", "currency"],
      ["stage", "status"],
    ]);
    const stage = attributes.find((row: any) => row.apiSlug === "stage");
    expect(stage).toMatchObject({
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
    expect(stage.id).toBe(list.stageAttributeId);
    // The record's own Stage and the list's Stage are different fields; the
    // label has to say which is which.
    expect(stage.label).toBe("Q3 Renewals Stage");
    const amount = attributes.find((row: any) => row.apiSlug === "amount");
    expect(JSON.parse(amount.configJson)).toEqual({
      currency: { code: "USD" },
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

  // A status goes through the lifecycle rather than the writer's generic option
  // check, so the refusal names the attribute and its known values instead of
  // reporting `crm-unknown-option`. A non-status select still gets that code.
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
    ).rejects.toMatchObject({
      code: "unknown-status",
      statusCode: 422,
      message: expect.stringContaining(
        '"invented" is not a value of "Managed Options Stage"',
      ),
    });
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

  it("refuses a stage move into a retired option but still lets an entry leave it", async () => {
    const list = await newList("Sunset Pipeline");
    const recordId = await createRecord("companies", "Sunset Co");
    const { entryId } = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "lost" } },
        ownerCtx,
      ),
    );
    // Retire the stage AFTER an entry is parked on it.
    await getDb()
      .update(schema.crmAttributeOptions)
      .set({ archived: true })
      .where(
        and(
          eq(schema.crmAttributeOptions.attributeId, list.stageAttributeId),
          eq(schema.crmAttributeOptions.value, "lost"),
        ),
      );

    const other = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    await expect(
      asOwner(() =>
        updateCrmListEntry.run(
          { entryId: other.entryId, values: { stage: "lost" } },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "archived-status",
      statusCode: 422,
      message: expect.stringContaining("Pick one of: new, in-progress, won"),
    });

    const moved = await asOwner(() =>
      updateCrmListEntry.run({ entryId, values: { stage: "won" } }, ownerCtx),
    );
    expect(moved.values).toEqual([
      { attribute: "stage", changed: true, mode: "close-and-insert" },
    ]);
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

// The QA finding these cover: a brand-new board showed every card "ungrouped",
// with no attributes and no column total, because the list was seeded with a
// stage nobody had set and nothing copied the record's own values onto the
// entry. The board math below is the real `board-model`, fed the real
// `list-crm-list-entries` payload.
describe("seeding a list from its parent object", () => {
  const OBJECT = "opportunities";
  let objectStage: any;
  let objectAmount: any;
  let objectCloseDate: any;

  async function createObjectAttribute(input: {
    apiSlug: string;
    label: string;
    attributeType: string;
    valueType: string;
    position: number;
    config?: Record<string, unknown>;
    options?: Array<{ value: string; title: string; celebrate?: boolean }>;
  }) {
    const id = `attr_obj_${++counter}`;
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmFieldPolicies)
      .values({
        id,
        connectionId: CONNECTION_ID,
        objectType: OBJECT,
        fieldName: input.apiSlug,
        label: input.label,
        valueType: input.valueType,
        storagePolicy: "local-authoritative",
        updateable: true,
        target: "object",
        targetId: OBJECT,
        apiSlug: input.apiSlug,
        attributeType: input.attributeType,
        authority: "local-authoritative",
        historyTracked: true,
        configJson: JSON.stringify(input.config ?? {}),
        position: input.position,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
    if (input.options?.length) {
      await getDb()
        .insert(schema.crmAttributeOptions)
        .values(
          input.options.map((option, index) => ({
            id: `opt_${++counter}`,
            attributeId: id,
            value: option.value,
            title: option.title,
            position: index,
            archived: false,
            celebrate: option.celebrate ?? false,
            ...ownership,
            createdAt: now,
            updatedAt: now,
          })),
        );
    }
    return {
      id,
      apiSlug: input.apiSlug,
      attributeType: input.attributeType,
      multi: false,
      historyTracked: true,
      valueType: input.valueType,
      storagePolicy: "local-authoritative" as const,
      fieldPolicyId: id,
    };
  }

  const setRecordValue = (recordId: string, attribute: any, value: unknown) =>
    asOwner(() =>
      writeCrmRecordField({
        target: { recordId },
        attribute: attribute as never,
        value: value as never,
        actor: { type: "user", id: OWNER },
        ownership,
        now: new Date().toISOString(),
      }),
    );

  beforeAll(async () => {
    objectAmount = await createObjectAttribute({
      apiSlug: "amount",
      label: "Amount",
      attributeType: "currency",
      valueType: "currency",
      position: 0,
      config: { currency: { code: "EUR" } },
    });
    objectStage = await createObjectAttribute({
      apiSlug: "stage",
      label: "Stage",
      attributeType: "status",
      valueType: "enum",
      position: 1,
      options: [
        { value: "discovery", title: "Discovery" },
        { value: "negotiation", title: "Negotiation" },
        { value: "closed-won", title: "Closed Won", celebrate: true },
      ],
    });
    objectCloseDate = await createObjectAttribute({
      apiSlug: "close_date",
      label: "Close Date",
      attributeType: "date",
      valueType: "date",
      position: 2,
    });
  }, 30_000);

  it("copies the object's stage options, currency, and date onto the list", async () => {
    const list = await newList("Enterprise Pipeline", OBJECT);
    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );

    expect(
      page.attributes.map((a: any) => [a.apiSlug, a.attributeType]),
    ).toEqual([
      ["stage", "status"],
      ["amount", "currency"],
      ["close_date", "date"],
    ]);
    expect(page.attributes[0].options.map((o: any) => o.value)).toEqual([
      "discovery",
      "negotiation",
      "closed-won",
    ]);
    expect(
      page.attributes[0].options.find((o: any) => o.value === "closed-won")
        .celebrate,
    ).toBe(true);
    // Qualified so it can never be read as the opportunity's own Stage.
    expect(page.attributes[0].label).toBe("Enterprise Pipeline Stage");
    expect(page.attributes[0].description).toContain("Enterprise Pipeline");
    expect(list.seededAttributes.map((a: any) => a.seededFrom)).toEqual([
      "stage",
      "amount",
      "close_date",
    ]);
  });

  it("populates a first board: cards group, show attributes, and the column sums", async () => {
    const list = await newList("First Board", OBJECT);
    const won = await createRecord(OBJECT, "Initech Expansion");
    const open = await createRecord(OBJECT, "Hooli Renewal");
    await setRecordValue(won, objectStage, "closed-won");
    await setRecordValue(won, objectAmount, 4200);
    await setRecordValue(won, objectCloseDate, "2026-09-30");
    await setRecordValue(open, objectStage, "closed-won");
    await setRecordValue(open, objectAmount, 800);

    const added = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId: won }, ownerCtx),
    );
    expect(added.initialValues).toEqual(
      expect.arrayContaining([
        { attribute: "stage", from: "stage", applied: true },
        { attribute: "amount", from: "amount", applied: true },
        { attribute: "close_date", from: "close_date", applied: true },
      ]),
    );
    await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId: open }, ownerCtx),
    );

    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    const stageAttribute = page.attributes.find(
      (a: any) => a.apiSlug === "stage",
    );
    const currencyAttribute = pickCurrencyAttribute(page.attributes);
    expect(currencyAttribute.apiSlug).toBe("amount");

    const cards = page.entries.map((entry: any) => ({
      id: entry.id,
      recordId: entry.recordId,
      title: entry.record.displayName,
      subtitle: null,
      owner: null,
      groupValue: entry.values.stage ?? BOARD_UNGROUPED,
      groupSince: entry.valuesSince.stage ?? null,
      remoteRevision: null,
      amount: cardAmountFor(currencyAttribute, entry.values),
      currencyCode: "EUR",
      attributes: [],
      actorType: null,
    }));
    const columns = boardColumns(cards, stageAttribute.options);

    // Defect 1: every card used to land here.
    expect(
      columns.find((column: any) => column.key === BOARD_UNGROUPED).cards,
    ).toHaveLength(0);
    const wonColumn = columns.find(
      (column: any) => column.key === "closed-won",
    );
    expect(wonColumn.cards.map((card: any) => card.title).sort()).toEqual([
      "Hooli Renewal",
      "Initech Expansion",
    ]);
    // Defect 2 and 3: per-card values, and a column total that is a number.
    expect(page.entries[0].values.close_date).toBe("2026-09-30");
    expect(boardColumnTotals(wonColumn.cards)).toMatchObject({
      count: 2,
      sum: 5000,
      currencyCode: "EUR",
      withoutAmount: 0,
    });
  });

  it("keeps the entry independent of the record after the initial copy", async () => {
    const list = await newList("Independence", OBJECT);
    const recordId = await createRecord(OBJECT, "Vandelay Deal");
    await setRecordValue(recordId, objectStage, "discovery");
    await setRecordValue(recordId, objectAmount, 1000);
    const { entryId } = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );

    await asOwner(() =>
      updateCrmListEntry.run(
        { entryId, values: { stage: "closed-won", amount: 9999 } },
        ownerCtx,
      ),
    );

    // The record's own current values are untouched: a board move is not a
    // record write, and never a provider write.
    const recordRows = await getDb()
      .select()
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.recordId, recordId),
          isNull(schema.crmRecordFields.entryId),
          isNull(schema.crmRecordFields.activeUntil),
        ),
      );
    expect(
      Object.fromEntries(
        recordRows.map((row: any) => [
          row.fieldName,
          row.stringValue ?? row.numberValue,
        ]),
      ),
    ).toEqual({ stage: "discovery", amount: 1000 });

    // And the entry kept its own new values.
    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries[0].values).toMatchObject({
      stage: "closed-won",
      amount: 9999,
    });
  });

  it("reports a record value this list cannot represent instead of dropping it", async () => {
    const list = await newList("Drifted Options", OBJECT);
    // The object gains a stage after the list copied its options — the list
    // does not have it, and inventing it here would be a silent auto-create.
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmAttributeOptions)
      .values({
        id: `opt_${++counter}`,
        attributeId: objectStage.id,
        value: "on-hold",
        title: "On Hold",
        position: 3,
        archived: false,
        celebrate: false,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
    const recordId = await createRecord(OBJECT, "Paused Deal");
    await setRecordValue(recordId, objectStage, "on-hold");

    const added = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    expect(
      added.initialValues.find((entry: any) => entry.attribute === "stage"),
    ).toMatchObject({
      from: "stage",
      applied: false,
      reason: expect.stringContaining("on-hold"),
    });
    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries[0].values.stage).toBeUndefined();
  });

  // The hand-built attributes above assume what a real object looks like; this
  // one runs the whole flow over the native adapter's own `opportunities`
  // template, so a change to its slugs or types breaks here rather than on a
  // user's first board.
  it("gives a first board over the native opportunities object columns and a total", async () => {
    const connection = await asOwner(() =>
      configureNativeCrm.run({ label: "Native Board" }, ownerCtx),
    );
    const record = await asOwner(() =>
      createCrmRecord.run(
        {
          connectionId: connection.id,
          kind: "opportunity",
          displayName: "Initech Expansion",
          fields: {
            amount: 4200,
            stage: "in-progress",
            closeDate: "2026-09-30",
          },
          idempotencyKey: `native-board-${Date.now()}`,
        },
        ownerCtx,
      ),
    );
    const list = await asOwner(() =>
      createCrmList.run(
        {
          connectionId: connection.id,
          name: "Native Pipeline",
          parentObjectType: "opportunities",
        },
        ownerCtx,
      ),
    );
    await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId: record.recordId },
        ownerCtx,
      ),
    );

    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries[0].values).toEqual({
      stage: "in-progress",
      amount: 4200,
      closeDate: "2026-09-30",
    });

    const stageAttribute = page.attributes.find(
      (a: any) => a.attributeType === "status",
    );
    const currencyAttribute = pickCurrencyAttribute(page.attributes);
    const columns = boardColumns(
      page.entries.map((entry: any) => ({
        id: entry.id,
        recordId: entry.recordId,
        title: entry.record.displayName,
        subtitle: null,
        owner: null,
        groupValue: entry.values[stageAttribute.apiSlug] ?? BOARD_UNGROUPED,
        groupSince: entry.valuesSince[stageAttribute.apiSlug] ?? null,
        remoteRevision: null,
        amount: cardAmountFor(currencyAttribute, entry.values),
        currencyCode: "USD",
        attributes: [],
        actorType: null,
      })),
      stageAttribute.options,
    );
    expect(
      columns.find((column: any) => column.key === BOARD_UNGROUPED).cards,
    ).toHaveLength(0);
    expect(
      boardColumnTotals(
        columns.find((column: any) => column.key === "in-progress").cards,
      ),
    ).toMatchObject({ count: 1, sum: 4200, currencyCode: "USD" });
  }, 30_000);

  it("lets an explicit value win over the initial copy", async () => {
    const list = await newList("Explicit Wins", OBJECT);
    const recordId = await createRecord(OBJECT, "Override Co");
    await setRecordValue(recordId, objectStage, "discovery");
    await setRecordValue(recordId, objectAmount, 250);

    const added = await asOwner(() =>
      addCrmRecordToList.run(
        { listId: list.id, recordId, values: { stage: "negotiation" } },
        ownerCtx,
      ),
    );
    // A value the caller chose was not initialized from anything, so it is not
    // reported as if it had been.
    expect(added.initialValues.map((entry: any) => entry.attribute)).toEqual([
      "amount",
    ]);
    const page = await asOwner(() =>
      listCrmListEntries.run({ listId: list.id }, ownerCtx),
    );
    expect(page.entries[0].values).toMatchObject({
      stage: "negotiation",
      amount: 250,
    });
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
