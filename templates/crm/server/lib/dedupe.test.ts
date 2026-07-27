// Duplicate detection against a real libsql (SQLite) database with the app's own
// migrations applied. The whole point of this module is that it reads the sparse
// sub-field columns the attribute writer populates, so the queries — not a
// mocked builder — are the thing under test.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  normalizeCrmDisplayName,
  normalizeCrmLocation,
  type CrmDuplicateSeed,
} from "./dedupe.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-dedupe-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "other@example.test";
const CONNECTION_ID = "conn_dedupe";

type Schema = typeof import("../db/schema.js");
let getDb: () => any;
let schema: Schema;
let findCrmDuplicateCandidates: typeof import("./dedupe.js").findCrmDuplicateCandidates;
let writeCrmRecordField: typeof import("./record-fields.js").writeCrmRecordField;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

const asOwner = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
const asOther = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OTHER }, fn) as Promise<T>;

const ATTRIBUTES = {
  email: {
    id: "attr_email",
    apiSlug: "email_address",
    attributeType: "email-address" as const,
    valueType: "string",
    multi: false,
  },
  website: {
    id: "attr_website",
    apiSlug: "website",
    attributeType: "domain" as const,
    valueType: "string",
    multi: false,
  },
  hq: {
    id: "attr_hq",
    apiSlug: "hq",
    attributeType: "location" as const,
    valueType: "json",
    multi: false,
  },
};

type AttributeKey = keyof typeof ATTRIBUTES;

let counter = 0;

async function createRecord(input: {
  objectType: string;
  kind: "account" | "person";
  displayName: string;
  primaryEmail?: string;
  domain?: string;
  tombstone?: boolean;
}): Promise<string> {
  const id = `rec_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: input.objectType,
      kind: input.kind,
      remoteId: id,
      displayName: input.displayName,
      primaryEmail: input.primaryEmail ?? null,
      domain: input.domain ?? null,
      tombstone: input.tombstone ?? false,
      accessScopeKey: "native",
      accessScopeJson: "{}",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function setValue(
  recordId: string,
  key: AttributeKey,
  value: unknown,
): Promise<void> {
  const attribute = ATTRIBUTES[key];
  await asOwner(() =>
    writeCrmRecordField({
      target: { recordId },
      attribute: {
        id: attribute.id,
        apiSlug: attribute.apiSlug,
        attributeType: attribute.attributeType,
        multi: attribute.multi,
        historyTracked: true,
        valueType: attribute.valueType,
        storagePolicy: "local-authoritative",
        fieldPolicyId: attribute.id,
      },
      value: value as never,
      actor: { type: "user", id: OWNER },
      ownership,
    }),
  );
}

function seedFor(
  seeds: CrmDuplicateSeed[],
  recordId: string,
): CrmDuplicateSeed {
  const seed = seeds.find((entry) => entry.recordId === recordId);
  if (!seed) throw new Error(`no seed for ${recordId}`);
  return seed;
}

async function find(recordIds: string[], minConfidence?: number) {
  return asOwner(() =>
    findCrmDuplicateCandidates({
      db: getDb(),
      recordIds,
      ...(minConfidence === undefined ? {} : { minConfidence }),
    }),
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;

  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);

  findCrmDuplicateCandidates = (await import("./dedupe.js"))
    .findCrmDuplicateCandidates;
  writeCrmRecordField = (await import("./record-fields.js"))
    .writeCrmRecordField;

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
  for (const [key, attribute] of Object.entries(ATTRIBUTES)) {
    await getDb()
      .insert(schema.crmFieldPolicies)
      .values({
        id: attribute.id,
        connectionId: CONNECTION_ID,
        objectType: "shared",
        fieldName: attribute.apiSlug,
        label: key,
        valueType: attribute.valueType,
        storagePolicy: "local-authoritative",
        attributeType: attribute.attributeType,
        target: "object",
        targetId: "shared",
        apiSlug: attribute.apiSlug,
        authority: "local-authoritative",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
  }
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("normalizeCrmDisplayName", () => {
  it("folds case, punctuation, diacritics, and legal-form suffixes", () => {
    expect(normalizeCrmDisplayName("Acme, Inc.")).toBe("acme");
    expect(normalizeCrmDisplayName("ACME Corporation")).toBe("acme");
    expect(normalizeCrmDisplayName("Zürich Holdings")).toBe("zurich");
    expect(normalizeCrmDisplayName("Ada Lovelace")).toBe("ada lovelace");
  });
});

describe("normalizeCrmLocation", () => {
  it("reads a structured location and refuses to invent one", () => {
    expect(
      normalizeCrmLocation({ locality: "San Francisco", country: "US" }),
    ).toBe("san francisco us");
    expect(normalizeCrmLocation({ latitude: 1, longitude: 2 })).toBeNull();
    expect(normalizeCrmLocation(null)).toBeNull();
  });
});

describe("email matching", () => {
  it("scores an exact address as a near-certain duplicate and says why", async () => {
    const a = await createRecord({
      objectType: "people",
      kind: "person",
      displayName: "Ada Lovelace",
    });
    const b = await createRecord({
      objectType: "people",
      kind: "person",
      displayName: "A. Lovelace",
    });
    await setValue(a, "email", "ada@analytical.example");
    await setValue(b, "email", "ADA@analytical.example");

    const seeds = await find([a]);
    const [candidate] = seedFor(seeds, a).candidates;
    expect(candidate.recordId).toBe(b);
    expect(candidate.signals).toContainEqual({
      reason: "email",
      value: "ada@analytical.example",
      confidence: 0.95,
    });
    expect(candidate.confidence).toBe(0.95);
  });

  it("matches the denormalized primaryEmail column too", async () => {
    const a = await createRecord({
      objectType: "leads",
      kind: "person",
      displayName: "Grace Hopper",
    });
    const b = await createRecord({
      objectType: "leads",
      kind: "person",
      displayName: "G. Hopper",
      primaryEmail: "Grace@navy.example",
    });
    await setValue(a, "email", "grace@navy.example");

    const seeds = await find([a]);
    expect(seedFor(seeds, a).candidates.map((entry) => entry.recordId)).toEqual(
      [b],
    );
  });

  it("treats a shared corporate mail domain as a hint, not a duplicate", async () => {
    const a = await createRecord({
      objectType: "colleagues",
      kind: "person",
      displayName: "Alice Alpha",
    });
    const b = await createRecord({
      objectType: "colleagues",
      kind: "person",
      displayName: "Bob Beta",
    });
    await setValue(a, "email", "alice@shared-corp.example");
    await setValue(b, "email", "bob@shared-corp.example");

    const seeds = await find([a]);
    const [candidate] = seedFor(seeds, a).candidates;
    expect(candidate.signals).toEqual([
      {
        reason: "email-root-domain",
        value: "shared-corp.example",
        confidence: 0.2,
      },
    ]);
    // Below the action's default floor, so a colleague never surfaces as a
    // duplicate without someone explicitly asking for weak signals.
    expect(candidate.confidence).toBeLessThan(0.4);
  });

  it("never treats a consumer mailbox host as a shared identity", async () => {
    const a = await createRecord({
      objectType: "consumers",
      kind: "person",
      displayName: "Personal One",
    });
    const b = await createRecord({
      objectType: "consumers",
      kind: "person",
      displayName: "Personal Two",
    });
    await setValue(a, "email", "one@gmail.com");
    await setValue(b, "email", "two@gmail.com");

    const seeds = await find([a]);
    expect(seedFor(seeds, a).candidates).toEqual([]);
  });
});

describe("domain matching", () => {
  it("matches two companies on the registrable domain", async () => {
    const a = await createRecord({
      objectType: "companies",
      kind: "account",
      displayName: "Acme Inc",
    });
    const b = await createRecord({
      objectType: "companies",
      kind: "account",
      displayName: "Acme Corporation",
      domain: "acme.example",
    });
    await setValue(a, "website", "https://www.acme.example/about");

    const seeds = await find([a]);
    const [candidate] = seedFor(seeds, a).candidates;
    expect(candidate.recordId).toBe(b);
    const reasons = candidate.signals.map((signal) => signal.reason).sort();
    // Same domain AND the same normalized name — two independent signals.
    expect(reasons).toEqual(["domain", "name-and-location"]);
    expect(candidate.confidence).toBeCloseTo(0.88, 3);
  });

  it("does not report colleagues at one company domain as duplicates", async () => {
    const a = await createRecord({
      objectType: "staff",
      kind: "person",
      displayName: "Carol Gamma",
    });
    await createRecord({
      objectType: "staff",
      kind: "person",
      displayName: "Dave Delta",
      domain: "one-co.example",
    });
    await setValue(a, "website", "one-co.example");

    const seeds = await find([a]);
    expect(seedFor(seeds, a).candidates).toEqual([]);
  });
});

describe("name and location matching", () => {
  it("requires the location to agree for people with the same name", async () => {
    const a = await createRecord({
      objectType: "humans",
      kind: "person",
      displayName: "John Smith",
    });
    const same = await createRecord({
      objectType: "humans",
      kind: "person",
      displayName: "john  smith",
    });
    const elsewhere = await createRecord({
      objectType: "humans",
      kind: "person",
      displayName: "John Smith",
    });
    await setValue(a, "hq", { locality: "Berlin", country: "DE" });
    await setValue(same, "hq", { locality: "berlin", country: "de" });
    await setValue(elsewhere, "hq", { locality: "Tokyo", country: "JP" });

    const seeds = await find([a]);
    const candidates = seedFor(seeds, a).candidates;
    expect(candidates.map((entry) => entry.recordId)).toEqual([same]);
    expect(candidates[0].signals[0]).toMatchObject({
      reason: "name-and-location",
      confidence: 0.6,
    });
    expect(candidates.some((entry) => entry.recordId === elsewhere)).toBe(
      false,
    );
  });
});

describe("scope and safety", () => {
  it("ignores tombstoned records on both sides", async () => {
    const a = await createRecord({
      objectType: "ghosts",
      kind: "account",
      displayName: "Ghost Co",
      domain: "ghost.example",
    });
    const dead = await createRecord({
      objectType: "ghosts",
      kind: "account",
      displayName: "Ghost Co",
      domain: "ghost.example",
      tombstone: true,
    });

    expect(seedFor(await find([a]), a).candidates).toEqual([]);
    expect(await find([dead])).toEqual([]);
  });

  it("never pairs records of different object types", async () => {
    const person = await createRecord({
      objectType: "people_x",
      kind: "person",
      displayName: "Cross Type",
    });
    await createRecord({
      objectType: "companies_x",
      kind: "account",
      displayName: "Cross Type",
    });
    await setValue(person, "email", "cross@type.example");

    expect(seedFor(await find([person]), person).candidates).toEqual([]);
  });

  it("returns no seed at all for a record the caller cannot read", async () => {
    const hidden = await createRecord({
      objectType: "private_x",
      kind: "account",
      displayName: "Owner Only",
      domain: "owner-only.example",
    });

    const seeds = await asOther(() =>
      findCrmDuplicateCandidates({ db: getDb(), recordIds: [hidden] }),
    );
    // An empty seed list is "you cannot see it", which the action reports as
    // unreadable — distinct from a seed with zero candidates.
    expect(seeds).toEqual([]);

    const [row] = await getDb()
      .select()
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, hidden));
    expect(row.displayName).toBe("Owner Only");
  });
});
