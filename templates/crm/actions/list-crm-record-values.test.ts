// Integration tests for the grid's value payload. They run against a real
// libsql database with the real migrations, the real bitemporal writer, and the
// real sharing registry — a mocked accessFilter would make the scoping
// assertion vacuous, and a mocked writer would not produce the closed-out
// history rows this action has to ignore.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-record-values-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "intruder@example.test";
const CONNECTION_ID = "conn_values";
const RECORD_ID = "rec_values_1";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listValues: typeof import("./list-crm-record-values.js").default;
let writeCrmRecordField: typeof import("../server/lib/record-fields.js").writeCrmRecordField;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

function run<T>(args: unknown, userEmail = OWNER): Promise<T> {
  return runWithRequestContext({ userEmail }, () =>
    listValues.run(args as never, { caller: "frontend", userEmail } as never),
  ) as Promise<T>;
}

interface ValuesResult {
  attributes: Array<{ apiSlug: string; attributeType: string }>;
  records: Array<{
    recordId: string;
    remoteRevision: string | null;
    values: Record<string, unknown>;
    valuesSince: Record<string, string>;
    provenance: Record<
      string,
      { actorType: string; actorId: string | null; provenanceJson: string }
    >;
  }>;
}

async function defineAttribute(input: {
  id: string;
  slug: string;
  attributeType: string;
  valueType: string;
  multi?: boolean;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmFieldPolicies)
    .values({
      id: input.id,
      connectionId: CONNECTION_ID,
      objectType: "accounts",
      fieldName: input.slug,
      apiSlug: input.slug,
      label: input.slug,
      valueType: input.valueType,
      attributeType: input.attributeType,
      target: "object",
      targetId: "accounts",
      multi: input.multi ?? false,
      authority: "local-authoritative",
      storagePolicy: "local-authoritative",
      updateable: true,
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });
  return {
    id: input.id,
    apiSlug: input.slug,
    attributeType: input.attributeType as never,
    multi: input.multi ?? false,
    historyTracked: true,
    valueType: input.valueType,
    storagePolicy: "local-authoritative" as const,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  listValues = (await import("./list-crm-record-values.js")).default;
  writeCrmRecordField = (await import("../server/lib/record-fields.js"))
    .writeCrmRecordField;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      accessScopeKey: "native",
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id: RECORD_ID,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: "accounts",
      kind: "account",
      remoteId: "acct-1",
      displayName: "Acme",
      remoteRevision: "rev-7",
      accessScopeKey: "native",
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });

  const stage = await defineAttribute({
    id: "attr_stage",
    slug: "stage",
    attributeType: "text",
    valueType: "string",
  });
  const active = await defineAttribute({
    id: "attr_active",
    slug: "active",
    attributeType: "checkbox",
    valueType: "boolean",
  });
  await defineAttribute({
    id: "attr_notes",
    slug: "notes",
    attributeType: "text",
    valueType: "string",
  });

  await runWithRequestContext({ userEmail: OWNER }, async () => {
    await writeCrmRecordField({
      target: { recordId: RECORD_ID },
      attribute: stage,
      value: "prospect",
      actor: { type: "provider", id: "hubspot" },
      ownership,
      provenanceJson: JSON.stringify([
        { provider: "hubspot", fieldName: "stage", confidence: 0.9 },
      ]),
    });
    // A second write closes the first row: only the current one may surface.
    await writeCrmRecordField({
      target: { recordId: RECORD_ID },
      attribute: stage,
      value: "customer",
      actor: { type: "user", id: OWNER },
      ownership,
    });
    await writeCrmRecordField({
      target: { recordId: RECORD_ID },
      attribute: active,
      value: false,
      actor: { type: "agent", id: "agent-1" },
      ownership,
    });
  });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("list-crm-record-values", () => {
  it("returns only the current value of each attribute", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.values.stage).toBe("customer");
    expect(result.records[0]?.valuesSince.stage).toEqual(expect.any(String));
  });

  it("distinguishes a stored false from an attribute with no value", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
    expect(result.records[0]?.values.active).toBe(false);
    expect("notes" in (result.records[0]?.values ?? {})).toBe(false);
  });

  it("carries the actor and provenance blob for each cell", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
    expect(result.records[0]?.provenance.active).toMatchObject({
      actorType: "agent",
      actorId: "agent-1",
    });
    expect(result.records[0]?.provenance.stage?.actorType).toBe("user");
  });

  it("returns the record revision the write path requires", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
    expect(result.records[0]?.remoteRevision).toBe("rev-7");
  });

  it("returns the typed attribute definitions the grid renders with", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
    const active = result.attributes.find((a) => a.apiSlug === "active");
    expect(active?.attributeType).toBe("checkbox");
  });

  it("returns nothing to a caller who cannot see the record", async () => {
    const result = await run<ValuesResult>({ recordIds: [RECORD_ID] }, OTHER);
    expect(result.records).toEqual([]);
  });

  it("excludes list-entry values stored in the same table", async () => {
    const entryId = "entry_1";
    await getDb()
      .update(schema.crmRecordFields)
      .set({ entryId })
      .where(eq(schema.crmRecordFields.fieldName, "active"));
    try {
      const result = await run<ValuesResult>({ recordIds: [RECORD_ID] });
      expect("active" in (result.records[0]?.values ?? {})).toBe(false);
    } finally {
      await getDb()
        .update(schema.crmRecordFields)
        .set({ entryId: null })
        .where(eq(schema.crmRecordFields.fieldName, "active"));
    }
  });

  it("fails loudly on a value blob it cannot read rather than reporting null", async () => {
    const now = new Date().toISOString();
    await defineAttribute({
      id: "attr_place",
      slug: "place",
      attributeType: "location",
      valueType: "json",
    });
    await getDb()
      .insert(schema.crmRecordFields)
      .values({
        id: "field_place",
        recordId: RECORD_ID,
        attributeId: "attr_place",
        fieldPolicyId: "attr_place",
        fieldName: "place",
        valueType: "json",
        storagePolicy: "local-authoritative",
        jsonValue: "{not json",
        activeFrom: now,
        actorType: "system",
        createdAt: now,
        updatedAt: now,
        ...ownership,
      });
    await expect(run({ recordIds: [RECORD_ID] })).rejects.toThrow(
      /not readable JSON/,
    );
    await getDb()
      .delete(schema.crmRecordFields)
      .where(eq(schema.crmRecordFields.id, "field_place"));
  });
});
