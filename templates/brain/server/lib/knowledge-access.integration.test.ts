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

vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getSetting: async () => ({ sourcePolicy: "strict" }),
}));

import askBrainAction from "../../actions/ask-brain.js";
import getKnowledgeAction from "../../actions/get-knowledge.js";
import listKnowledgeAction from "../../actions/list-knowledge.js";
import searchKnowledgeAction from "../../actions/search-knowledge.js";
import { withFixtureProvenance } from "../../test-utils/knowledge-provenance.js";
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
  await client.exec(
    "CREATE TABLE org_members (id text PRIMARY KEY, org_id text, email text, role text, federation_removal_pending_at text); CREATE TABLE organizations (id text PRIMARY KEY, identity_authority text, identity_id text); INSERT INTO organizations VALUES ('qa-org', NULL, NULL); INSERT INTO org_members VALUES ('recipient', 'qa-org', 'recipient@example.test', 'member', NULL), ('owner', 'qa-org', 'qa-fleet@builder.io', 'owner', NULL)",
  );
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

type KnowledgeInsert = typeof schema.brainKnowledge.$inferInsert;

async function ordinaryRow(row: KnowledgeInsert): Promise<KnowledgeInsert> {
  const captures = await database.select().from(schema.brainRawCaptures);
  return withFixtureProvenance(
    row,
    new Map(captures.map((capture) => [capture.id, capture.content])),
  );
}

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
    await database.insert(schema.brainSources).values({
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
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          ordinaryRow({
            id: `z-mixed-${String(index).padStart(2, "0")}`,
            title: "Scoped universal fixture",
            body: "Mixed-source result.",
            sourceId: "source",
            captureId: "capture",
            audienceId: "audience",
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
          }),
        ),
      ),
    );
    await database.insert(schema.brainKnowledge).values(
      await ordinaryRow({
        id: "a-fully-scoped",
        title: "Scoped universal fixture",
        body: "Fully scoped result.",
        sourceId: "source",
        captureId: "capture",
        audienceId: "audience",
        ownerEmail: qaEmail,
        visibility: "private",
        status: "published",
        createdBy: qaEmail,
        updatedAt: "2026-11-18T12:00:00.000Z",
        evidenceJson: JSON.stringify([ownEvidence]),
      }),
    );
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

describe("ordinary personal-source knowledge sharing", () => {
  it("blocks real generic grants and notifications for every Google provider, including mixed-source evidence", async () => {
    for (const provider of [
      "google_calendar",
      "gmail",
      "google_drive",
    ] as const) {
      await database.insert(schema.brainSources).values({
        id: provider,
        provider,
        title: "Private account source",
        ownerEmail: qaEmail,
        visibility: "private",
      });
      const captureId = `personal-capture-${provider}`;
      const audienceId = `personal-audience-${provider}`;
      await database.insert(schema.brainRawCaptures).values({
        id: captureId,
        sourceId: provider,
        title: "Private item",
        content: "Private context.",
        contentHash: "personal-hash",
        capturedAt: "2026-11-18T12:00:00Z",
        sensitivityDisposition: "allowed",
        importedBy: qaEmail,
      });
      await database.insert(schema.brainAudiences).values({
        id: audienceId,
        sourceId: provider,
        kind: "restricted",
        aclHash: "personal-acl",
        membershipState: "current",
      });
      await database.insert(schema.brainAudienceMembers).values({
        id: `member-${provider}`,
        audienceId,
        principalType: "user",
        principalId: qaEmail,
        syncedAt: "2026-11-18T12:00:00Z",
      });
      await database.insert(schema.brainCaptureAudiences).values({
        id: `capture-audience-${provider}`,
        captureId,
        audienceId,
        aclHash: "personal-acl",
      });
      for (const mixed of [false, true]) {
        const id = `ordinary-${provider}-${mixed}`;
        await database.insert(schema.brainKnowledge).values(
          await ordinaryRow({
            id,
            title: "Private ordinary account fact",
            body: "Private context.",
            ownerEmail: qaEmail,
            visibility: "private",
            createdBy: qaEmail,
            sourceId: mixed ? "source" : provider,
            ...(mixed ? { captureId: "capture", audienceId: "audience" } : {}),
            evidenceJson: JSON.stringify(
              mixed
                ? [
                    { sourceId: "source", captureId: "capture", quote },
                    {
                      sourceId: "source",
                      captureId,
                      quote: "Private context.",
                    },
                  ]
                : [],
            ),
          }),
        );
        await asQa(async () => {
          let denied: unknown;
          try {
            await shareResource.run({
              resourceType: "brain-knowledge",
              resourceId: id,
              principalType: "user",
              principalId: "recipient@example.test",
              role: "viewer",
              notify: true,
            });
          } catch (error) {
            denied = error;
          }
          expect(denied).toMatchObject({
            message:
              "Knowledge from personal connected sources cannot be shared beyond its source audiences.",
          });
          expect(String(denied)).not.toContain("Private ordinary account fact");
        });
      }
    }
    expect(await database.select().from(schema.brainKnowledgeShares)).toEqual(
      [],
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("denies generic get/status for an org-visible ordinary Google fact while allowing healthy nonGoogle evidence", async () => {
    await database
      .update(schema.brainSources)
      .set({ provider: "google_drive" })
      .where(eq(schema.brainSources.id, "source"));
    await database.insert(schema.brainKnowledge).values(
      await ordinaryRow({
        id: "ordinary-org",
        title: "Private ordinary account fact",
        body: quote,
        ownerEmail: qaEmail,
        orgId: "qa-org",
        visibility: "org",
        createdBy: qaEmail,
        sourceId: "source",
        captureId: "capture",
        audienceId: "audience",
        evidenceJson: JSON.stringify([{ captureId: "capture", quote }]),
      }),
    );
    const reader = <T>(work: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "recipient@example.test", orgId: "qa-org" },
        work,
      );
    expect(
      await reader(() => resolveAccess("brain-knowledge", "ordinary-org")),
    ).toBeNull();
    const status = await reader(() =>
      resolveAccessStatus("brain-knowledge", "ordinary-org"),
    );
    expect(status).toEqual({ state: "denied" });
    expect(JSON.stringify(status)).not.toContain(
      "Private ordinary account fact",
    );
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "ordinary-org")),
    ).toBeNull();
    expect(
      await runWithRequestContext({ userEmail: qaEmail, orgId: "qa-org" }, () =>
        resolveAccess("brain-knowledge", "ordinary-org"),
      ),
    ).toMatchObject({ role: "owner" });
    await database
      .update(schema.brainRawCaptures)
      .set({
        content: "Fresh sanitized allowed passage.",
        contentHash: "resanitized-hash",
        sensitivityDisposition: "allowed",
      })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    expect(
      await runWithRequestContext({ userEmail: qaEmail, orgId: "qa-org" }, () =>
        resolveAccess("brain-knowledge", "ordinary-org"),
      ),
    ).toBeNull();
    const removedQuoteStatus = await runWithRequestContext(
      { userEmail: qaEmail, orgId: "qa-org" },
      () => resolveAccessStatus("brain-knowledge", "ordinary-org"),
    );
    expect(removedQuoteStatus).toEqual({ state: "denied" });
    expect(JSON.stringify(removedQuoteStatus)).not.toContain(
      "Private ordinary account fact",
    );
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote, contentHash: "current-hash" })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    await database
      .update(schema.brainSources)
      .set({ provider: "manual" })
      .where(eq(schema.brainSources.id, "source"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toMatchObject({ role: "owner" });
    await database
      .update(schema.brainKnowledge)
      .set({ orgId: null, visibility: "private" })
      .where(eq(schema.brainKnowledge.id, "ordinary-org"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "ordinary-org")),
    ).toMatchObject({ role: "owner" });
    expect(network).not.toHaveBeenCalled();
  });
  it("freshly checks evidence providers for visibility changes while allowing private tightening and nonGoogle legacy facts", async () => {
    await database.insert(schema.brainSources).values({
      id: "personal-drive",
      provider: "google_drive",
      title: "Private Drive",
      ownerEmail: qaEmail,
      visibility: "private",
    });
    await database
      .update(schema.brainKnowledge)
      .set({
        sourceId: "source",
        evidenceJson: JSON.stringify([
          {
            sourceId: "personal-drive",
            captureId: "capture",
            quote: "Private context.",
          },
        ]),
      })
      .where(eq(schema.brainKnowledge.id, "legacy"));
    const guard = getShareableResource("brain-knowledge")?.assertSharingChange;
    if (!guard) throw new Error("Missing knowledge sharing guard");
    await asQa(async () => {
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).rejects.toThrow("personal connected sources");
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "private" },
        }),
      ).resolves.toBeUndefined();
      await database
        .update(schema.brainSources)
        .set({ ownerEmail: "other@example.test" })
        .where(eq(schema.brainSources.id, "personal-drive"));
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).rejects.toThrow("evidence is unavailable");
      await database
        .update(schema.brainKnowledge)
        .set({
          evidenceJson: JSON.stringify([
            { sourceId: "source", captureId: "capture", quote },
          ]),
        })
        .where(eq(schema.brainKnowledge.id, "legacy"));
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).resolves.toBeUndefined();
    });
    expect(network).not.toHaveBeenCalled();
  });
});

describe("public ordinary knowledge quote survival", () => {
  it.each([
    "not-json",
    "null",
    "[null]",
    "[{}]",
    JSON.stringify([{ captureId: "capture" }]),
    JSON.stringify([{ captureId: "capture", quote: "" }]),
  ])(
    "denies malformed ordinary evidence without exposing its title: %j",
    async (evidenceJson) => {
      await database
        .update(schema.brainKnowledge)
        .set({
          evidenceJson,
          status: "published",
        })
        .where(eq(schema.brainKnowledge.id, "legacy"));
      expect(
        await asQa(() => resolveAccess("brain-knowledge", "legacy")),
      ).toBeNull();
      expect(
        await asQa(() => resolveAccessStatus("brain-knowledge", "legacy")),
      ).toEqual({ state: "denied" });
      const failure = {
        errorCode: "knowledge_evidence_unreadable",
        statusCode: 409,
      };
      await expect(
        asQa(async () => listKnowledgeAction.run({ limit: 25 })),
      ).rejects.toMatchObject(failure);
      await expect(
        asQa(async () =>
          searchKnowledgeAction.run({ query: "Ordinary knowledge" }),
        ),
      ).rejects.toMatchObject(failure);
      await expect(
        asQa(async () =>
          askBrainAction.run({ question: "Ordinary knowledge", mode: "cited" }),
        ),
      ).rejects.toMatchObject(failure);
    },
  );
  it("withdraws removed Google quotes from get, list, search and cited answers and restores healthy evidence", async () => {
    await database
      .update(schema.brainSources)
      .set({ provider: "google_drive" })
      .where(eq(schema.brainSources.id, "source"));
    const id = "ordinary-public";
    const factTitle = "Ordinary Google launch fact";
    await database.insert(schema.brainKnowledge).values(
      await ordinaryRow({
        id,
        title: factTitle,
        body: quote,
        ownerEmail: qaEmail,
        visibility: "private",
        status: "published",
        publishTier: "company",
        createdBy: qaEmail,
        sourceId: "source",
        captureId: "capture",
        audienceId: "audience",
        evidenceJson: JSON.stringify([
          {
            sourceId: "source",
            captureId: "capture",
            captureTitle: "Planning",
            quote,
          },
        ]),
      }),
    );
    const readPublic = () =>
      asQa(async () => ({
        get: await getKnowledgeAction.run({ id }),
        list: await listKnowledgeAction.run({ limit: 25 }),
        search: await searchKnowledgeAction.run({
          query: factTitle,
          includeDrafts: false,
          limit: 25,
        }),
        answer: await askBrainAction.run({
          question: factTitle,
          mode: "cited",
        }),
      }));
    const healthy = await readPublic();
    expect(healthy.get.knowledge?.id).toBe(id);
    expect(healthy.list.knowledge.some((item) => item.id === id)).toBe(true);
    expect(healthy.search.knowledge.some((item) => item.id === id)).toBe(true);
    expect(healthy.answer.knowledge.some((item) => item.id === id)).toBe(true);
    expect(
      healthy.answer.citations.some((item) => item.excerpt === quote),
    ).toBe(true);
    await database
      .update(schema.brainRawCaptures)
      .set({
        content: "New allowed sanitized meeting text.",
        contentHash: "sanitized-current",
        sensitivityDisposition: "allowed",
      })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    const withdrawn = await readPublic();
    expect(withdrawn.get.knowledge).toBeNull();
    expect(withdrawn.list.knowledge.some((item) => item.id === id)).toBe(false);
    expect(withdrawn.search.knowledge).toEqual([]);
    expect(withdrawn.answer.knowledge).toEqual([]);
    expect(withdrawn.answer.citations).toEqual([]);
    expect(JSON.stringify(withdrawn)).not.toContain(factTitle);
    expect(JSON.stringify(withdrawn)).not.toContain(quote);
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote, contentHash: "current-hash" })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    const restored = await readPublic();
    expect(restored.get.knowledge?.id).toBe(id);
    expect(restored.list.knowledge.some((item) => item.id === id)).toBe(true);
    expect(restored.search.knowledge.some((item) => item.id === id)).toBe(true);
    expect(restored.answer.knowledge.some((item) => item.id === id)).toBe(true);
    expect(
      restored.answer.citations.some((item) => item.excerpt === quote),
    ).toBe(true);
    expect(
      await asQa(async () => getKnowledgeAction.run({ id: "legacy" })),
    ).toMatchObject({
      knowledge: { id: "legacy", title: "Ordinary knowledge" },
    });
  });
});
