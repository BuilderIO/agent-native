import { PGlite } from "@electric-sql/pglite";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const harness = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => harness.db,
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  getShareableResource,
  resolveAccess,
  resolveAccessStatus,
} from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";

import { schema } from "../db/index.js";
import { searchKnowledgePage, searchKnowledgeRows } from "./brain.js";
import { knowledgeContentRevision } from "./intelligence.js";
import { searchEverythingWithLanes } from "./search.js";

const qaEmail = "qa-fleet@builder.io";
const title = "Private launch decision";
const quote = "Morgan will ship Atlas.";
const client = new PGlite();
const database = drizzle(client, { schema });
const quoted = (value: string) => `"${value.split('"').join('""')}"`;
const network = vi.fn(() => {
  throw new Error("No external requests are permitted in this test.");
});

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
  harness.db = database;
});
afterAll(async () => client.close());
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  for (const table of Object.values(schema)) await database.delete(table);
  network.mockClear();
  vi.stubGlobal("fetch", network);
  const now = "2026-11-18T12:00:00.000Z";
  await database.insert(schema.brainSources).values({
    id: "source",
    title: "Meeting notes",
    provider: "manual",
    ownerEmail: qaEmail,
    visibility: "private",
  });
  await database.insert(schema.brainRawCaptures).values({
    id: "capture",
    sourceId: "source",
    title: "Planning",
    content: quote,
    contentHash: "current-hash",
    capturedAt: now,
    sensitivityDisposition: "allowed",
    importedBy: qaEmail,
  });
  await database.insert(schema.brainAudiences).values({
    id: "audience",
    sourceId: "source",
    kind: "restricted",
    aclHash: "acl",
    membershipState: "current",
  });
  await database.insert(schema.brainAudienceMembers).values({
    id: "member",
    audienceId: "audience",
    principalType: "user",
    principalId: qaEmail,
    syncedAt: now,
  });
  await database.insert(schema.brainCaptureAudiences).values({
    id: "capture-audience",
    captureId: "capture",
    audienceId: "audience",
    aclHash: "acl",
  });
  await database.insert(schema.brainKnowledge).values({
    id: "derived",
    title,
    body: quote,
    ownerEmail: qaEmail,
    visibility: "private",
    createdBy: qaEmail,
    sourceId: "source",
    captureId: "capture",
    audienceId: "audience",
    intelligenceKind: "action",
    evidenceJson: JSON.stringify([
      {
        captureId: "capture",
        sourceId: "source",
        captureTitle: "Planning",
        quote,
      },
    ]),
  });
  const row = (
    await database
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, "derived"))
  ).find((record) => record.id === "derived");
  if (!row) throw new Error("Missing knowledge fixture");
  await database.insert(schema.brainKnowledgeIntelligence).values({
    knowledgeId: "derived",
    kind: "action",
    knowledgeRevision: await knowledgeContentRevision(row),
    evidenceSnapshotsJson: JSON.stringify([
      { captureId: "capture", contentHash: "current-hash" },
    ]),
    updatedAt: now,
  });
  await database.insert(schema.brainKnowledge).values({
    id: "legacy",
    title: "Ordinary knowledge",
    body: "Unmarked manual knowledge.",
    ownerEmail: qaEmail,
    visibility: "private",
    createdBy: qaEmail,
  });
});

async function asQa<T>(work: () => Promise<T>) {
  return runWithRequestContext(
    { userEmail: qaEmail, orgScope: "personal" },
    work,
  );
}

describe("generic intelligence resource access", () => {
  it("denies owner resolution and title exposure after source access is revoked, including status-only loads", async () => {
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toMatchObject({ role: "owner" });
    await database
      .update(schema.brainSources)
      .set({ ownerEmail: "other@example.test" })
      .where(eq(schema.brainSources.id, "source"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toBeNull();
    const status = await asQa(() =>
      resolveAccessStatus("brain-knowledge", "derived"),
    );
    expect(status).toEqual({ state: "denied" });
    expect(JSON.stringify(status)).not.toContain(title);
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "legacy")),
    ).toMatchObject({
      role: "owner",
      resource: { title: "Ordinary knowledge" },
    });
  });

  it("uses the requested target identity instead of the actor's readable source context", async () => {
    await database
      .update(schema.brainKnowledge)
      .set({ ownerEmail: "recipient@example.test" })
      .where(eq(schema.brainKnowledge.id, "derived"));
    const access = await asQa(() =>
      resolveAccess("brain-knowledge", "derived", {
        userEmail: "recipient@example.test",
      }),
    );
    expect(access).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("fails closed when the derived audience no longer includes the current owner", async () => {
    await database
      .update(schema.brainAudienceMembers)
      .set({ status: "revoked" })
      .where(eq(schema.brainAudienceMembers.id, "member"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toBeNull();
  });
});

describe("generic sharing boundaries", () => {
  it("refuses new grants before persistence or notification without leaking the private title", async () => {
    await asQa(async () => {
      let rejected: unknown;
      try {
        await shareResource.run({
          resourceType: "brain-knowledge",
          resourceId: "derived",
          principalType: "user",
          principalId: qaEmail,
          role: "viewer",
          notify: true,
        });
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toMatchObject({
        message:
          "Evidence-backed intelligence cannot be shared beyond its source audiences.",
      });
      expect(String(rejected)).not.toContain(title);
      expect(JSON.stringify(rejected)).not.toContain(title);
    });
    expect(await database.select().from(schema.brainKnowledgeShares)).toEqual(
      [],
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects visibility broadening from fresh marker state while allowing private tightening and legacy behavior", async () => {
    const registration = getShareableResource("brain-knowledge");
    if (!registration?.assertSharingChange)
      throw new Error("Missing knowledge sharing policy");
    const guard = registration.assertSharingChange;
    await asQa(async () => {
      await expect(
        guard({
          resource: { id: "derived" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).rejects.toThrow("source audiences");
      await expect(
        guard({
          resource: { id: "derived" },
          change: { kind: "visibility", visibility: "private" },
        }),
      ).resolves.toBeUndefined();
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("current knowledge search pagination", () => {
  it("fills the requested limit past stale evidence while preserving deterministic equal-date ordering", async () => {
    const updatedAt = "2026-11-18T12:00:00.000Z";
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 30 }, (_, index) => ({
        id: `z-stale-${String(index).padStart(2, "0")}`,
        title: "Pagination fixture",
        body: "Stale derived material.",
        ownerEmail: qaEmail,
        createdBy: qaEmail,
        visibility: "private" as const,
        status: "published" as const,
        intelligenceKind: "action" as const,
        updatedAt,
        sourceId: "source",
        captureId: "capture",
        audienceId: "audience",
        evidenceJson: JSON.stringify([
          {
            captureId: "capture",
            sourceId: "source",
            captureTitle: "Planning",
            quote,
          },
        ]),
      })),
    );
    const staleRows = await database
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.title, "Pagination fixture"));
    await database.insert(schema.brainKnowledgeIntelligence).values(
      await Promise.all(
        staleRows.map(async (row) => ({
          knowledgeId: row.id,
          kind: "action" as const,
          updatedAt,
          knowledgeRevision: await knowledgeContentRevision(row),
          evidenceSnapshotsJson: JSON.stringify([
            { captureId: "capture", contentHash: "superseded-hash" },
          ]),
        })),
      ),
    );
    await database.insert(schema.brainKnowledge).values(
      ["a-current", "b-current", "c-current"].map((id) => ({
        id,
        title: "Pagination fixture",
        body: "Current ordinary knowledge.",
        ownerEmail: qaEmail,
        createdBy: qaEmail,
        visibility: "private" as const,
        status: "published" as const,
        updatedAt,
      })),
    );
    const page = await asQa(() =>
      searchKnowledgePage({ query: "Pagination fixture", limit: 2 }),
    );
    expect(page.rows.map((row) => row.id)).toEqual(["c-current", "b-current"]);
    expect(page.scanLimited).toBe(true);
    expect(
      (
        await asQa(() =>
          searchKnowledgeRows({ query: "Pagination fixture", limit: 3 }),
        )
      ).map((row) => row.id),
    ).toEqual(["c-current", "b-current", "a-current"]);
    const exhausted = await asQa(() =>
      searchKnowledgePage({ query: "Pagination fixture", limit: 4 }),
    );
    expect(exhausted.rows).toHaveLength(3);
    expect(exhausted.scanLimited).toBe(false);
  });
  it("keeps candidate scans bounded and signals an incomplete scan without returning stale records", async () => {
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `bounded-${String(index).padStart(4, "0")}`,
        title: "Bounded fixture",
        body: "Stale derived material.",
        ownerEmail: qaEmail,
        createdBy: qaEmail,
        visibility: "private" as const,
        status: "published" as const,
        intelligenceKind: "action" as const,
        updatedAt: "2026-11-18T12:00:00.000Z",
      })),
    );
    const page = await asQa(() =>
      searchKnowledgePage({ query: "Bounded fixture", limit: 2 }),
    );
    expect(page).toEqual({ rows: [], scanLimited: true });
  });
});

describe("scoped universal knowledge search", () => {
  it("finds older fully scoped evidence after a default page of mixed-source matches", async () => {
    await database
      .insert(schema.brainSources)
      .values({
        id: "other-source",
        title: "Other private notes",
        provider: "manual",
        ownerEmail: qaEmail,
        visibility: "private",
      });
    const ownEvidence = {
      sourceId: "source",
      captureId: "capture",
      captureTitle: "Planning",
      quote,
    };
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 30 }, (_, index) => ({
        id: `z-mixed-${String(index).padStart(2, "0")}`,
        title: "Scoped universal fixture",
        body: "Mixed-source result.",
        sourceId: "source",
        ownerEmail: qaEmail,
        visibility: "private" as const,
        status: "published" as const,
        createdBy: qaEmail,
        updatedAt: "2026-11-18T12:00:00.000Z",
        evidenceJson: JSON.stringify([
          ownEvidence,
          {
            sourceId: "other-source",
            captureId: "other-capture",
            captureTitle: "Other notes",
            quote: "Private context.",
          },
        ]),
      })),
    );
    await database.insert(schema.brainKnowledge).values({
      id: "a-fully-scoped",
      title: "Scoped universal fixture",
      body: "Fully scoped result.",
      sourceId: "source",
      ownerEmail: qaEmail,
      visibility: "private",
      status: "published",
      createdBy: qaEmail,
      updatedAt: "2026-11-18T12:00:00.000Z",
      evidenceJson: JSON.stringify([ownEvidence]),
    });
    const result = await asQa(() =>
      searchEverythingWithLanes({
        query: "Scoped universal fixture",
        type: "knowledge",
        sourceIds: ["source"],
      }),
    );
    expect(result.rows.map((row) => row.id)).toEqual(["a-fully-scoped"]);
    expect(result.knowledgeScanLimited).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Private context.");
    expect(JSON.stringify(result)).not.toContain("z-mixed-");
  });
  it("signals the bounded scan when mixed-source candidates reach its ceiling", async () => {
    const mixedEvidence = JSON.stringify([
      { sourceId: "source", captureId: "capture", quote },
      { sourceId: "outside", captureId: "outside", quote: "Excluded context." },
    ]);
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `z-scope-cap-${String(index).padStart(4, "0")}`,
        title: "Scoped ceiling fixture",
        body: "Mixed-source result.",
        sourceId: "source",
        ownerEmail: qaEmail,
        visibility: "private" as const,
        status: "published" as const,
        createdBy: qaEmail,
        updatedAt: "2026-11-18T12:00:00.000Z",
        evidenceJson: mixedEvidence,
      })),
    );
    const result = await asQa(() =>
      searchEverythingWithLanes({
        query: "Scoped ceiling fixture",
        type: "knowledge",
        sourceIds: ["source"],
      }),
    );
    expect(result.rows).toEqual([]);
    expect(result.knowledgeScanLimited).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Excluded context.");
  });
});
