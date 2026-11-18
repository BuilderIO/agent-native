import { PGlite } from "@electric-sql/pglite";
import { eq, sql, SQL } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../db/schema.js";

const harness = vi.hoisted(() => ({ db: null as unknown }));
const email = "qa-fleet@builder.io";

vi.mock("../db/index.js", async () => ({
  schema: await import("../db/schema.js"),
  getDb: () => harness.db,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "qa-fleet@builder.io",
  getRequestOrgId: () => "qa-org",
}));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: vi.fn(async () => ({
    privacyClassifier: "deterministic",
    defaultPublishTier: "company",
    autoRedactEmails: false,
  })),
  mutateSetting: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("@agent-native/core/sharing", async () => {
  const { and, eq, or } = await import("drizzle-orm");
  const schema = await import("../db/schema.js");
  const permitted = (
    table: typeof schema.brainSources | typeof schema.brainKnowledge,
  ) =>
    or(
      eq(table.ownerEmail, "qa-fleet@builder.io"),
      and(eq(table.visibility, "org"), eq(table.orgId, "qa-org")),
    );
  const resolve = async (type: string, id: string) => {
    const db = harness.db as ReturnType<typeof drizzle>;
    const table =
      type === "brain-source" ? schema.brainSources : schema.brainKnowledge;
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), permitted(table)))
      .limit(1);
    const row = rows.find((record) => record.id === id);
    return row ? { resource: row, role: "owner" } : null;
  };
  return {
    accessFilter: permitted,
    resolveAccess: resolve,
    assertAccess: async (type: string, id: string) => {
      const access = await resolve(type, id);
      if (!access || access.resource.ownerEmail !== "qa-fleet@builder.io")
        throw new Error("Access denied");
      return access;
    },
  };
});
vi.mock("./hybrid-search.js", () => ({
  hybridSearchArtifacts: vi.fn(async () => ({
    results: [],
    lanes: { fts: { status: "ok" }, semantic: { status: "ok" } },
  })),
}));

import getKnowledge from "../../actions/get-knowledge.js";
import { searchKnowledgeRows, assertDerivedAudienceAccess } from "./brain.js";
import {
  writeIntelligence,
  listIntelligence,
  readPriorities,
  getEntityGraph,
  verifyKnowledge,
} from "./intelligence.js";
import { searchEverythingWithLanes } from "./search.js";

const client = new PGlite();
const database = drizzle(client, { schema });
function first<T>(values: readonly T[]): T {
  const value = values.find((_entry, index) => index === 0);
  if (value === undefined) throw new Error("Expected a fixture record");
  return value;
}

const quoted = (value: string) => `"${value.split('"').join('""')}"`;

beforeAll(async () => {
  const dialect = new PgDialect();
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `${quoted(column.name)} ${column.getSQLType()}`;
      if (column.primary) definition += " PRIMARY KEY";
      if (column.notNull) definition += " NOT NULL";
      if (column.default !== undefined) {
        const value = column.default;
        const expression =
          value instanceof SQL
            ? dialect.sqlToQuery(value).sql
            : typeof value === "number"
              ? String(value)
              : `'${String(value).split("'").join("''")}'`;
        definition += ` DEFAULT ${expression}`;
      }
      return definition;
    });
    await client.exec(
      `CREATE TABLE ${quoted(config.name)} (${columns.join(", ")})`,
    );
  }
  await client.exec(
    "CREATE UNIQUE INDEX audience_principal_unique ON brain_audience_members (audience_id, principal_type, principal_id)",
  );
  harness.db = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction")
        return (callback: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const original = harness.db;
            harness.db = tx;
            try {
              return await callback(tx);
            } finally {
              harness.db = original;
            }
          });
      return Reflect.get(target, property, receiver);
    },
  });
});
afterAll(async () => client.close());

beforeEach(async () => {
  for (const table of Object.values(schema)) await database.delete(table);
  const now = "2026-11-18T10:00:00.000Z";
  await database.insert(schema.brainSources).values({
    id: "source-a",
    title: "Project notes",
    provider: "manual",
    ownerEmail: email,
    orgId: "qa-org",
    visibility: "org",
  });
  await database.insert(schema.brainRawCaptures).values({
    id: "capture-a",
    sourceId: "source-a",
    title: "Planning",
    content:
      "Morgan will ship Atlas by Friday. Atlas is the customer migration project.",
    contentHash: "capture-hash",
    sensitivityDisposition: "allowed",
    audienceAclHash: "acl",
    capturedAt: now,
    importedBy: email,
  });
  await database.insert(schema.brainAudiences).values({
    id: "audience-a",
    sourceId: "source-a",
    kind: "org",
    aclHash: "acl",
    membershipState: "current",
  });
  await database.insert(schema.brainAudienceMembers).values({
    id: "member-a",
    audienceId: "audience-a",
    principalType: "org",
    principalId: "qa-org",
    syncedAt: now,
  });
  await database.insert(schema.brainCaptureAudiences).values({
    id: "capture-audience-a",
    captureId: "capture-a",
    audienceId: "audience-a",
    aclHash: "acl",
  });
});

function input() {
  return {
    kind: "action" as const,
    title: "Ship Atlas",
    body: "Morgan owns shipping Atlas.",
    owner: "Morgan",
    dueDate: "2020-01-01",
    status: "open" as const,
    ownershipConfidence: "explicit" as const,
    confidence: 90,
    entities: [
      { type: "person" as const, name: "Morgan" },
      { type: "project" as const, name: "Atlas" },
    ],
    evidence: [
      { captureId: "capture-a", quote: "Morgan will ship Atlas by Friday." },
    ],
    publishTier: "company" as const,
  };
}

describe("evidence-backed intelligence", () => {
  it("persists structured work and exact provenance, shows people relationships, and keeps overdue personal work in weekly priorities", async () => {
    const { item } = await writeIntelligence(input());
    expect(item).toMatchObject({
      title: "Ship Atlas",
      owner: "Morgan",
      dueDate: "2020-01-01",
      status: "open",
      ownershipConfidence: "explicit",
    });
    expect(
      (await listIntelligence({ captureId: "capture-a" })).records.map(
        (record) => record.id,
      ),
    ).toEqual([item.id]);
    expect(
      (await listIntelligence({ captureId: "unrelated-capture" })).records,
    ).toEqual([]);
    expect(first(item.evidence).quote).toBe(
      "Morgan will ship Atlas by Friday.",
    );
    const graph = await getEntityGraph({ type: "person" });
    expect(graph.entities.map((node) => node.name)).toEqual(["Morgan"]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: "person:morgan",
        relation: "owns",
        knowledgeId: item.id,
      }),
    ]);
    const brief = await readPriorities({ owner: "Morgan", period: "weekly" });
    expect(brief.highConfidence.map((entry) => entry.id)).toEqual([item.id]);
    expect((await readPriorities()).highConfidence).toEqual([]);
  });

  it("rejects fabricated quotes, entities and explicit owners", async () => {
    await expect(
      writeIntelligence({
        ...input(),
        evidence: [{ captureId: "capture-a", quote: "Fabricated decision" }],
      }),
    ).rejects.toThrow("exact substring");
    await expect(
      writeIntelligence({ ...input(), owner: "Casey" }),
    ).rejects.toMatchObject({ errorCode: "owner_not_in_evidence" });
    await expect(
      writeIntelligence({
        ...input(),
        entities: [{ type: "person", name: "Casey" }],
      }),
    ).rejects.toMatchObject({ errorCode: "entity_not_in_evidence" });
    expect((await listIntelligence()).records).toEqual([]);
  });

  it.each(["quarantine", "delete", "change", "revoke"])(
    "withdraws derived facts from lists, graph, briefs and all shared knowledge reads after evidence %s",
    async (operation) => {
      const { item } = await writeIntelligence(input());
      expect((await searchKnowledgeRows({ query: "Atlas" })).length).toBe(1);
      if (operation === "quarantine")
        await database
          .update(schema.brainRawCaptures)
          .set({ sensitivityDisposition: "pending" })
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      if (operation === "delete")
        await database
          .delete(schema.brainRawCaptures)
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      if (operation === "change")
        await database
          .update(schema.brainRawCaptures)
          .set({ contentHash: "changed" })
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      if (operation === "revoke")
        await database
          .update(schema.brainAudienceMembers)
          .set({ status: "revoked" })
          .where(eq(schema.brainAudienceMembers.id, "member-a"));
      expect((await listIntelligence()).records).toEqual([]);
      expect((await getEntityGraph()).entities).toEqual([]);
      expect(
        (await readPriorities({ owner: "Morgan" })).highConfidence,
      ).toEqual([]);
      expect(await searchKnowledgeRows({ query: "Atlas" })).toEqual([]);
      expect(
        (await searchEverythingWithLanes({ query: "Atlas", type: "knowledge" }))
          .rows,
      ).toEqual([]);
      await expect(getKnowledge.run({ id: item.id })).rejects.toThrow();
    },
  );

  it("records explicit verification, rejects stale updates and clears verification on task changes", async () => {
    const { item } = await writeIntelligence(input());
    await verifyKnowledge({
      knowledgeId: item.id,
      state: "verified",
      attested: true,
      expectedRevision: item.revision,
    });
    const current = first((await listIntelligence({ id: item.id })).records);
    expect(current.verification).toMatchObject({
      state: "verified",
      verifiedBy: email,
    });
    await expect(
      writeIntelligence({
        ...input(),
        id: item.id,
        status: "completed",
        expectedRevision: "stale",
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    const saved = await writeIntelligence({
      ...input(),
      id: item.id,
      status: "completed",
      expectedRevision: current.revision,
      publishTier: undefined,
    });
    const persistedRows = await database
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, item.id));
    expect(first(persistedRows).publishTier).toBe("company");
    expect(saved.item.status).toBe("completed");
    expect(saved.item.verification.state).toBe("unverified");
    expect((await readPriorities({ owner: "Morgan" })).highConfidence).toEqual(
      [],
    );
    await expect(
      verifyKnowledge({
        knowledgeId: item.id,
        state: "verified",
        attested: true,
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
  });

  it("keeps deprecated facts out of shared answers and resets generic-edited structured facts until re-extracted", async () => {
    const { item } = await writeIntelligence(input());
    await verifyKnowledge({
      knowledgeId: item.id,
      state: "deprecated",
      attested: true,
      expectedRevision: item.revision,
    });
    expect(await searchKnowledgeRows({ query: "Atlas" })).toEqual([]);
    const rows = await database
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, item.id));
    await assertDerivedAudienceAccess(first(rows));
    await database
      .update(schema.brainKnowledge)
      .set({ body: "Changed through generic knowledge editor" })
      .where(eq(schema.brainKnowledge.id, item.id));
    expect((await listIntelligence()).records).toEqual([]);
    expect(await searchKnowledgeRows({ query: "Atlas" })).toEqual([]);
    await expect(getKnowledge.run({ id: item.id })).rejects.toMatchObject({
      errorCode: "evidence_unavailable",
    });
  });
  it("refuses static workspace export of records that require live evidence gates", async () => {
    const { item } = await writeIntelligence(input());
    const {
      setKnowledgeCanonicalResource,
      previewKnowledgeCanonicalResource,
      writeKnowledgeRecord,
    } = await import("./brain.js");
    await expect(
      setKnowledgeCanonicalResource(item.id, true),
    ).rejects.toMatchObject({ errorCode: "intelligence_canonical_forbidden" });
    await expect(
      previewKnowledgeCanonicalResource({ knowledgeId: item.id }),
    ).rejects.toMatchObject({ errorCode: "intelligence_canonical_forbidden" });
    await expect(
      writeKnowledgeRecord({
        knowledgeId: item.id,
        title: item.title,
        body: item.body,
        evidence: item.evidence,
        publishCanonical: true,
      }),
    ).rejects.toMatchObject({ errorCode: "intelligence_canonical_forbidden" });
  });
  it("finds older people beyond the recent-record window and discloses a capped scan even when stale candidates are hidden", async () => {
    const { item } = await writeIntelligence(input());
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 102 }, (_, index) => ({
        id: `distractor-${index}`,
        title: `General notes ${index}`,
        body: "Unrelated project notes",
        ownerEmail: email,
        orgId: "qa-org",
        visibility: "org" as const,
        status: "published" as const,
        createdBy: email,
        updatedAt: "2035-01-01T00:00:00.000Z",
      })),
    );
    const found = await getEntityGraph({ query: "morgan", type: "person" });
    expect(found.entities.map((node) => node.name)).toEqual(["Morgan"]);
    expect(first(found.edges).knowledgeId).toBe(item.id);
    await database
      .update(schema.brainKnowledge)
      .set({ title: "Morgan project notes", intelligenceKind: "action" })
      .where(sql`${schema.brainKnowledge.id} like 'distractor-%'`);
    const capped = await getEntityGraph({ query: "morgan" });
    expect(capped.entities).toEqual([]);
    expect(capped.hasMore).toBe(true);
  });
  it("bounds entity provenance previews while preserving evidence totals and knowledge links", async () => {
    const args = input();
    await writeIntelligence({
      ...args,
      evidence: Array.from({ length: 5 }, () => first(args.evidence)),
    });
    const graph = await getEntityGraph({ type: "person" });
    expect(first(graph.entities)).toMatchObject({
      evidenceCount: 5,
      evidenceTruncated: true,
    });
    expect(first(graph.entities).evidence).toHaveLength(3);
    expect(first(graph.edges)).toMatchObject({
      evidenceCount: 5,
      evidenceTruncated: true,
    });
    expect(first(graph.edges).evidence).toHaveLength(1);
    expect(first(graph.entities).knowledgeIds).toEqual([
      first(graph.edges).knowledgeId,
    ]);
  });
});
