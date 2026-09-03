// Integration tests for the bitemporal attribute writer. Boots a real libsql
// (SQLite) database on disk, seeds the PRE-bitemporal shape of
// `crm_record_fields` with rows, then runs the actual versioned migrations over
// it — so every test here runs against an upgraded database, not a fresh one.
// That distinction is load-bearing: SQLite accepts `ADD COLUMN … NOT NULL
// DEFAULT (datetime('now'))` on an empty table and rejects it on a populated
// one, so a fresh-database-only test passes while every real upgrade fails.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CrmWritableAttribute } from "./record-fields.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-record-fields-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";

type Schema = typeof import("../db/schema.js");
let getDb: () => any;
let schema: Schema;
let writeCrmRecordField: typeof import("./record-fields.js").writeCrmRecordField;
let CrmUnknownOptionError: typeof import("./record-fields.js").CrmUnknownOptionError;

/** `crm_record_fields` and its unique index exactly as migration v1 left them. */
const LEGACY_RECORD_FIELDS_DDL = `CREATE TABLE IF NOT EXISTS crm_record_fields (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  field_policy_id TEXT,
  field_name TEXT NOT NULL,
  value_type TEXT NOT NULL,
  storage_policy TEXT NOT NULL,
  string_value TEXT,
  number_value REAL,
  boolean_value INTEGER,
  json_value TEXT,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  access_scope_key TEXT NOT NULL DEFAULT 'unverified',
  access_scope_json TEXT NOT NULL DEFAULT '{}',
  remote_revision TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const recordFields = await import("./record-fields.js");
  writeCrmRecordField = recordFields.writeCrmRecordField;
  CrmUnknownOptionError = recordFields.CrmUnknownOptionError;

  const { getDbExec } = await import("@agent-native/core/db");
  const exec = getDbExec();
  await exec.execute(LEGACY_RECORD_FIELDS_DDL);
  await exec.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_record_fields_record_name_idx ON crm_record_fields (record_id, field_name)`,
  );
  await exec.execute(
    `INSERT INTO crm_record_fields (id, record_id, field_policy_id, field_name, value_type, storage_policy, string_value, created_at, owner_email)
     VALUES ('legacy_1', 'legacy_record', 'legacy_policy', 'stage', 'string', 'mirrored', 'Discovery', '2026-01-01T00:00:00.000Z', '${OWNER}')`,
  );

  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

async function createRecord(): Promise<string> {
  const id = `rec_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: "conn_1",
      provider: "native",
      objectType: "companies",
      kind: "account",
      remoteId: id,
      displayName: `Record ${id}`,
      accessScopeKey: "native",
      accessScopeJson: "{}",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

function attribute(
  overrides: Partial<CrmWritableAttribute> = {},
): CrmWritableAttribute {
  return {
    id: `attr_${++counter}`,
    apiSlug: `attr_slug_${counter}`,
    attributeType: "text",
    multi: false,
    historyTracked: true,
    valueType: "string",
    storagePolicy: "local-authoritative",
    ...overrides,
  };
}

async function addOption(attributeId: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmAttributeOptions)
    .values({
      id: `opt_${++counter}`,
      attributeId,
      value,
      title: value,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
}

async function rowsFor(recordId: string, apiSlug: string) {
  return getDb()
    .select()
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, recordId),
        eq(schema.crmRecordFields.fieldName, apiSlug),
      ),
    )
    .orderBy(asc(schema.crmRecordFields.activeFrom));
}

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
}

describe("bitemporal upgrade of an existing database", () => {
  it("backfills pre-bitemporal rows as the current value and keeps them writable", async () => {
    const [legacy] = await rowsFor("legacy_record", "stage");
    expect(legacy).toMatchObject({
      activeFrom: "2026-01-01T00:00:00.000Z",
      activeUntil: null,
      actorType: "system",
      attributeId: "legacy_policy",
    });

    await asOwner(() =>
      writeCrmRecordField({
        target: { recordId: "legacy_record" },
        attribute: attribute({
          id: "legacy_policy",
          apiSlug: "stage",
          storagePolicy: "mirrored",
        }),
        value: "Negotiation",
        actor: { type: "user", id: OWNER },
        ownership,
        now: "2026-04-01T00:00:00.000Z",
      }),
    );

    // The v1 unique index spanned every row for (record_id, field_name); a
    // second history row is only possible once it has been replaced.
    const rows = await rowsFor("legacy_record", "stage");
    expect(rows.map((row: any) => [row.stringValue, row.activeUntil])).toEqual([
      ["Discovery", "2026-04-01T00:00:00.000Z"],
      ["Negotiation", null],
    ]);
  });
});

describe("bitemporal CRM attribute writer", () => {
  it("writes nothing when the value is unchanged", async () => {
    const recordId = await createRecord();
    const attr = attribute();

    await asOwner(async () => {
      const first = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "Acme",
        actor: { type: "user", id: OWNER },
        ownership,
      });
      expect(first).toMatchObject({ changed: true, mode: "insert" });

      const repeat = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "Acme",
        actor: { type: "provider" },
        ownership,
      });
      expect(repeat).toEqual({
        changed: false,
        fieldId: (first as { fieldId: string }).fieldId,
      });
    });

    const rows = await rowsFor(recordId, attr.apiSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("user");
  });

  it("closes the old row and opens a new one when the value changes", async () => {
    const recordId = await createRecord();
    const attr = attribute();

    await asOwner(async () => {
      await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "Discovery",
        actor: { type: "user", id: OWNER },
        ownership,
        now: "2026-01-01T00:00:00.000Z",
      });
      const changed = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "Negotiation",
        actor: { type: "agent", id: "agent-1" },
        ownership,
        now: "2026-02-01T00:00:00.000Z",
      });
      expect(changed).toMatchObject({
        changed: true,
        mode: "close-and-insert",
      });
    });

    const rows = await rowsFor(recordId, attr.apiSlug);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stringValue: "Discovery",
      activeFrom: "2026-01-01T00:00:00.000Z",
      activeUntil: "2026-02-01T00:00:00.000Z",
      actorType: "user",
    });
    expect(rows[1]).toMatchObject({
      stringValue: "Negotiation",
      activeFrom: "2026-02-01T00:00:00.000Z",
      activeUntil: null,
      actorType: "agent",
      actorId: "agent-1",
    });
  });

  it("updates in place when history is not tracked", async () => {
    const recordId = await createRecord();
    const attr = attribute({ historyTracked: false });

    await asOwner(async () => {
      const first = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "one",
        actor: { type: "system" },
        ownership,
      });
      const second = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: "two",
        actor: { type: "system" },
        ownership,
      });
      expect(second).toMatchObject({
        changed: true,
        mode: "update-in-place",
        fieldId: (first as { fieldId: string }).fieldId,
      });
    });

    const rows = await rowsFor(recordId, attr.apiSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stringValue: "two", activeUntil: null });
  });

  it("rejects an unknown option with a typed error instead of creating it", async () => {
    const recordId = await createRecord();
    const attr = attribute({ attributeType: "status", valueType: "enum" });
    await addOption(attr.id, "Won");

    await asOwner(async () => {
      await expect(
        writeCrmRecordField({
          target: { recordId },
          attribute: attr,
          value: "Nope",
          actor: { type: "user", id: OWNER },
          ownership,
        }),
      ).rejects.toBeInstanceOf(CrmUnknownOptionError);

      await expect(
        writeCrmRecordField({
          target: { recordId },
          attribute: attr,
          value: "Won",
          actor: { type: "user", id: OWNER },
          ownership,
        }),
      ).resolves.toMatchObject({ changed: true });
    });

    const rows = await rowsFor(recordId, attr.apiSlug);
    expect(rows).toHaveLength(1);
    const options = await getDb()
      .select()
      .from(schema.crmAttributeOptions)
      .where(eq(schema.crmAttributeOptions.attributeId, attr.id));
    expect(options).toHaveLength(1);
  });

  it("populates composite sub-fields and clears the ones the type does not own", async () => {
    const recordId = await createRecord();
    const email = attribute({ attributeType: "email-address" });
    const phone = attribute({ attributeType: "phone-number" });
    const name = attribute({ attributeType: "personal-name" });

    await asOwner(async () => {
      await writeCrmRecordField({
        target: { recordId },
        attribute: email,
        value: "Ada@Mail.Example.co.uk",
        actor: { type: "provider" },
        ownership,
      });
      await writeCrmRecordField({
        target: { recordId },
        attribute: phone,
        value: "+44 20 7946 0958",
        actor: { type: "provider" },
        ownership,
      });
      await writeCrmRecordField({
        target: { recordId },
        attribute: name,
        value: "Ada Lovelace",
        actor: { type: "provider" },
        ownership,
      });
    });

    const [emailRow] = await rowsFor(recordId, email.apiSlug);
    expect(emailRow).toMatchObject({
      emailLocal: "ada",
      emailDomain: "mail.example.co.uk",
      emailRootDomain: "example.co.uk",
      phoneE164: null,
      nameFirst: null,
    });
    const [phoneRow] = await rowsFor(recordId, phone.apiSlug);
    expect(phoneRow).toMatchObject({
      phoneE164: "+442079460958",
      phoneCountry: "GB",
      emailLocal: null,
    });
    const [nameRow] = await rowsFor(recordId, name.apiSlug);
    expect(nameRow).toMatchObject({
      nameFirst: "Ada",
      nameLast: "Lovelace",
      domainRoot: null,
    });
  });

  it("compares json values structurally, not byte for byte", async () => {
    const recordId = await createRecord();
    const attr = attribute({ attributeType: "location", valueType: "json" });

    await asOwner(async () => {
      await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: { city: "Berlin", country: "DE" },
        actor: { type: "provider" },
        ownership,
      });
      // Same value, different key order — must not open a history row.
      const reordered = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: { country: "DE", city: "Berlin" },
        actor: { type: "provider" },
        ownership,
      });
      expect(reordered).toMatchObject({ changed: false });

      const different = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: { city: "Berlin", country: "AT" },
        actor: { type: "provider" },
        ownership,
      });
      expect(different).toMatchObject({ changed: true });
    });

    expect(await rowsFor(recordId, attr.apiSlug)).toHaveLength(2);
  });

  it("treats a multi value as one set and suppresses the no-op re-sync", async () => {
    const recordId = await createRecord();
    const attr = attribute({
      attributeType: "email-address",
      multi: true,
      valueType: "multi-enum",
    });

    await asOwner(async () => {
      await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: ["ada@example.com", "ada@work.example.com"],
        actor: { type: "provider" },
        ownership,
      });
      const repeat = await writeCrmRecordField({
        target: { recordId },
        attribute: attr,
        value: ["ada@example.com", "ada@work.example.com"],
        actor: { type: "provider" },
        ownership,
      });
      expect(repeat).toMatchObject({ changed: false });
    });

    const rows = await rowsFor(recordId, attr.apiSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0].jsonValue).toBe(
      '["ada@example.com","ada@work.example.com"]',
    );
    // Sub-fields come from the primary (first) entry of the set.
    expect(rows[0].emailLocal).toBe("ada");
    expect(rows[0].emailRootDomain).toBe("example.com");
  });
});
