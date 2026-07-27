// Integration tests for the record page actions against a real libsql (SQLite)
// database with the app's own migrations applied. The two things they have to
// prove — that a superseded bitemporal row is never read as the current value,
// and that two entries of one record in one list both survive — are exactly
// what a mocked query builder would let through.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-record-page-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "other@example.test";
const CONNECTION_ID = "conn_record_page";
const OBJECT_TYPE = "companies";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let writeCrmRecordField: (typeof import("../server/lib/record-fields.js"))["writeCrmRecordField"];

let getRecordPage: any;
let listFieldHistory: any;
let createCrmList: any;
let addCrmRecordToList: any;
let updateCrmListEntry: any;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};
const ownerCtx = { caller: "frontend" as const, userEmail: OWNER, orgId: null };
const otherCtx = { caller: "frontend" as const, userEmail: OTHER, orgId: null };

const asOwner = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
const asOther = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OTHER }, fn) as Promise<T>;

let counter = 0;

async function createRecord(displayName: string): Promise<string> {
  const id = `rec_page_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: OBJECT_TYPE,
      kind: "account",
      remoteId: id,
      displayName,
      remoteRevision: "1",
      accessScopeKey: "native",
      accessScopeJson: "{}",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

interface SeededAttribute {
  id: string;
  apiSlug: string;
  attributeType: string;
  multi: boolean;
  historyTracked: boolean;
  valueType: string;
  storagePolicy: "local-authoritative";
  fieldPolicyId: string;
}

async function createAttribute(input: {
  apiSlug: string;
  label: string;
  attributeType?: string;
  valueType?: string;
  historyTracked?: boolean;
  position?: number;
}): Promise<SeededAttribute> {
  const id = `attr_page_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmFieldPolicies)
    .values({
      id,
      connectionId: CONNECTION_ID,
      objectType: OBJECT_TYPE,
      fieldName: input.apiSlug,
      label: input.label,
      valueType: input.valueType ?? "string",
      storagePolicy: "local-authoritative",
      updateable: true,
      target: "object",
      targetId: OBJECT_TYPE,
      apiSlug: input.apiSlug,
      attributeType: input.attributeType ?? "text",
      authority: "local-authoritative",
      historyTracked: input.historyTracked ?? true,
      position: input.position ?? 0,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return {
    id,
    apiSlug: input.apiSlug,
    attributeType: input.attributeType ?? "text",
    multi: false,
    historyTracked: input.historyTracked ?? true,
    valueType: input.valueType ?? "string",
    storagePolicy: "local-authoritative",
    fieldPolicyId: id,
  };
}

async function setValue(
  recordId: string,
  attribute: SeededAttribute,
  value: unknown,
  at: string,
  actor: { type: "user" | "agent" | "system"; id?: string | null } = {
    type: "user",
    id: OWNER,
  },
) {
  return asOwner(() =>
    writeCrmRecordField({
      target: { recordId },
      attribute: attribute as never,
      value: value as never,
      actor,
      ownership,
      now: at,
    }),
  );
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
  getRecordPage = (await import("./get-crm-record-page.js")).default;
  listFieldHistory = (await import("./list-crm-record-field-history.js"))
    .default;
  createCrmList = (await import("./create-crm-list.js")).default;
  addCrmRecordToList = (await import("./add-crm-record-to-list.js")).default;
  updateCrmListEntry = (await import("./update-crm-list-entry.js")).default;

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

describe("get-crm-record-page", () => {
  it("returns the current bitemporal value, never the superseded one", async () => {
    const recordId = await createRecord("Acme");
    const stage = await createAttribute({
      apiSlug: "renewal_stage",
      label: "Renewal stage",
      position: 0,
    });

    await setValue(recordId, stage, "Discovery", "2026-07-01T00:00:00.000Z");
    const second = await setValue(
      recordId,
      stage,
      "Renewal",
      "2026-07-03T00:00:00.000Z",
      { type: "agent", id: null },
    );
    expect(second.changed).toBe(true);

    const page = await asOwner(() => getRecordPage.run({ recordId }, ownerCtx));
    expect(page.values.renewal_stage).toBe("Renewal");
    expect(page.valueMeta.renewal_stage).toMatchObject({
      since: "2026-07-03T00:00:00.000Z",
      actorType: "agent",
    });
    expect(
      page.attributes.map((a: { apiSlug: string }) => a.apiSlug),
    ).toContain("renewal_stage");
  });

  it("has no upstream link for a native record", async () => {
    const recordId = await createRecord("Native Co");
    const page = await asOwner(() => getRecordPage.run({ recordId }, ownerCtx));
    // Absent and unavailable are different states; a native record has no
    // upstream record at all, so neither field is populated.
    expect(page.recordUrl).toBeNull();
    expect(page.recordUrlUnavailableReason).toBeNull();
  });

  it("shows both entries when one record is in the same list twice", async () => {
    const recordId = await createRecord("Two Renewals Inc");
    const list = await asOwner(() =>
      createCrmList.run(
        {
          connectionId: CONNECTION_ID,
          name: "Renewals",
          parentObjectType: OBJECT_TYPE,
        },
        ownerCtx,
      ),
    );

    const first = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    const second = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    expect(second.existingEntryIds).toContain(first.entryId);

    await asOwner(() =>
      updateCrmListEntry.run(
        { entryId: first.entryId, values: { stage: "in-progress" } },
        ownerCtx,
      ),
    );

    const page = await asOwner(() => getRecordPage.run({ recordId }, ownerCtx));
    expect(page.lists).toHaveLength(1);
    const entries = page.lists[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining([first.entryId, second.entryId]),
    );
    const edited = entries.find(
      (entry: { id: string }) => entry.id === first.entryId,
    );
    expect(edited.values.stage).toBe("in-progress");
    expect(
      page.lists[0].attributes.some(
        (a: { apiSlug: string }) => a.apiSlug === "stage",
      ),
    ).toBe(true);
  });

  it("does not expose a record to a caller who cannot see it", async () => {
    const recordId = await createRecord("Private Co");
    await expect(
      asOther(() => getRecordPage.run({ recordId }, otherCtx)),
    ).rejects.toThrow(/not found/i);
  });
});

describe("list-crm-record-field-history", () => {
  it("returns every bitemporal row newest first with its actor", async () => {
    const recordId = await createRecord("History Co");
    const stage = await createAttribute({
      apiSlug: "lifecycle",
      label: "Lifecycle",
    });
    await setValue(recordId, stage, "Discovery", "2026-07-01T00:00:00.000Z");
    await setValue(recordId, stage, "Negotiation", "2026-07-02T00:00:00.000Z", {
      type: "agent",
      id: null,
    });
    await setValue(recordId, stage, "Renewal", "2026-07-03T00:00:00.000Z");

    const history = await asOwner(() =>
      listFieldHistory.run({ recordId, apiSlug: "lifecycle" }, ownerCtx),
    );
    expect(history.historyTracked).toBe(true);
    expect(
      history.changes.map((change: { value: unknown }) => change.value),
    ).toEqual(["Renewal", "Negotiation", "Discovery"]);
    expect(history.changes[0].current).toBe(true);
    expect(history.changes[0].activeUntil).toBeNull();
    expect(history.changes[1].activeUntil).toBe("2026-07-03T00:00:00.000Z");
    expect(history.changes[1].actorType).toBe("agent");
  });

  it("reports history being off as a different answer from no changes", async () => {
    const recordId = await createRecord("Churny Co");
    const mirrored = await createAttribute({
      apiSlug: "last_seen",
      label: "Last seen",
      historyTracked: false,
    });
    await setValue(recordId, mirrored, "a", "2026-07-01T00:00:00.000Z");
    await setValue(recordId, mirrored, "b", "2026-07-02T00:00:00.000Z");

    const history = await asOwner(() =>
      listFieldHistory.run({ recordId, apiSlug: "last_seen" }, ownerCtx),
    );
    expect(history.historyTracked).toBe(false);
    // Updated in place: one row, holding the newest value.
    expect(history.changes).toHaveLength(1);
    expect(history.changes[0].value).toBe("b");
  });

  it("reads a list entry's own stage history", async () => {
    const recordId = await createRecord("Entry History Co");
    const list = await asOwner(() =>
      createCrmList.run(
        {
          connectionId: CONNECTION_ID,
          name: "Entry History Pipeline",
          parentObjectType: OBJECT_TYPE,
        },
        ownerCtx,
      ),
    );
    const entry = await asOwner(() =>
      addCrmRecordToList.run({ listId: list.id, recordId }, ownerCtx),
    );
    await asOwner(() =>
      updateCrmListEntry.run(
        { entryId: entry.entryId, values: { stage: "in-progress" } },
        ownerCtx,
      ),
    );
    await asOwner(() =>
      updateCrmListEntry.run(
        { entryId: entry.entryId, values: { stage: "won" } },
        ownerCtx,
      ),
    );

    const history = await asOwner(() =>
      listFieldHistory.run(
        { recordId, apiSlug: "stage", entryId: entry.entryId },
        ownerCtx,
      ),
    );
    expect(history.entryId).toBe(entry.entryId);
    expect(
      history.changes.map((change: { value: unknown }) => change.value),
    ).toEqual(["won", "in-progress"]);
  });

  it("fails loudly for an attribute the object does not declare", async () => {
    const recordId = await createRecord("Unknown Attr Co");
    await expect(
      asOwner(() =>
        listFieldHistory.run({ recordId, apiSlug: "not_a_field" }, ownerCtx),
      ),
    ).rejects.toThrow(/is not an attribute/i);
  });
});
