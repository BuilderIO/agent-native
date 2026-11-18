import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { handleMcpFetchRequest } from "@agent-native/core/mcp/fetch";
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

const harness = vi.hoisted(() => ({
  db: null as unknown,
  autoRedactEmails: false,
}));
const email = "qa-fleet@builder.io";

vi.mock("../db/index.js", async () => ({
  schema: await import("../db/schema.js"),
  getDb: () => harness.db,
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "qa-fleet@builder.io",
    getRequestOrgId: () => "qa-org",
    getRequestTimezone: () => "UTC",
  }),
);
vi.mock("@agent-native/core/settings", () => ({
  getSetting: vi.fn(async () => ({
    privacyClassifier: "deterministic",
    defaultPublishTier: "company",
    autoRedactEmails: harness.autoRedactEmails,
  })),
  getUserSetting: vi.fn(async (_email: string, key: string) =>
    key === "localization" ? { timezone: "America/Los_Angeles" } : null,
  ),
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

import getEntityGraphAction from "../../actions/get-entity-graph.js";
import getKnowledge from "../../actions/get-knowledge.js";
import getPilotReport from "../../actions/get-pilot-report.js";
import listIntelligenceAction from "../../actions/list-intelligence.js";
import readPrioritiesAction from "../../actions/read-priorities.js";
import verifyKnowledgeAction from "../../actions/verify-knowledge.js";
import writeIntelligenceAction from "../../actions/write-intelligence.js";
import { intelligenceItemSchema } from "../../shared/intelligence.js";
import { searchKnowledgeRows, assertDerivedAudienceAccess } from "./brain.js";
import { runBrainDemoEval } from "./demo.js";
import {
  writeIntelligence,
  listIntelligence,
  readPriorities,
  getEntityGraph,
  verifyKnowledge,
} from "./intelligence.js";
import { lookupKnowledgeReferences } from "./knowledge-references.js";
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
  harness.autoRedactEmails = false;
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
      "Morgan will ship Atlas by 2020-01-01. Atlas is the customer migration project.",
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

async function mcpCall(name: string, args: Record<string, unknown>) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const response = await handleMcpFetchRequest(
    new Request("https://brain.example.test/_agent-native/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }),
    {
      parsedBody: body,
      createServer: () =>
        createMCPServerForRequest(
          {
            name: "Brain",
            appId: "brain",
            description: "Company intelligence",
            builtinCrossAppTools: false,
            profile: "app",
            actions: {
              "write-intelligence": writeIntelligenceAction,
              "list-intelligence": listIntelligenceAction,
              "read-priorities": readPrioritiesAction,
              "get-entity-graph": getEntityGraphAction,
              "verify-knowledge": verifyKnowledgeAction,
            },
          } as Parameters<typeof createMCPServerForRequest>[0],
          {
            userEmail: email,
            orgDomain: undefined,
            orgId: "qa-org",
            oauthScopes: ["mcp:read", "mcp:write"],
          },
        ),
    },
  );
  const text = await response.text();
  const event = text.split("\n").find((line) => line.startsWith("data:"));
  const message = JSON.parse(event ? event.slice(5) : text) as {
    error?: unknown;
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  expect(message.error).toBeUndefined();
  if (!message.result) throw new Error("MCP returned no action result");
  expect(message.result.isError).not.toBe(true);
  return message.result;
}

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
      {
        captureId: "capture-a",
        quote: "Morgan will ship Atlas by 2020-01-01.",
      },
    ],
    publishTier: "company" as const,
  };
}

describe("evidence-backed intelligence", () => {
  it("rolls back redacted writes with a privacy-specific refusal and accepts a safe exact excerpt", async () => {
    harness.autoRedactEmails = true;
    const quote = `${email} will ship Atlas by 2020-01-01.`;
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    await expect(
      writeIntelligence({
        ...input(),
        body: `${email} owns shipping Atlas.`,
        owner: email,
        entities: [{ type: "person", name: email }],
        evidence: [{ captureId: "capture-a", quote }],
      }),
    ).rejects.toMatchObject({ errorCode: "intelligence_redaction_required" });
    expect(await database.select().from(schema.brainKnowledge)).toEqual([]);
    expect(
      await database.select().from(schema.brainKnowledgeIntelligence),
    ).toEqual([]);
    expect(
      await database.select().from(schema.brainKnowledgeVerifications),
    ).toEqual([]);
    const { item } = await writeIntelligence({
      ...input(),
      body: "Ship Atlas.",
      owner: null,
      ownershipConfidence: "ambiguous",
      entities: [{ type: "project", name: "Atlas" }],
      evidence: [
        { captureId: "capture-a", quote: "ship Atlas by 2020-01-01." },
      ],
    });
    expect(item.owner).toBeNull();
    expect(item.evidence.map((entry) => entry.quote)).toEqual([
      "ship Atlas by 2020-01-01.",
    ]);
    expect((await listIntelligence()).records.map((entry) => entry.id)).toEqual(
      [item.id],
    );
  });

  it("excludes substring-only legacy people while keeping distinct source-backed project mentions", async () => {
    const quote = "Annual planning mentions Atlas.";
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    await database.insert(schema.brainKnowledge).values({
      id: "legacy-mention",
      sourceId: "source-a",
      captureId: "capture-a",
      audienceId: "audience-a",
      title: "Annual planning",
      body: quote,
      kind: "fact",
      status: "published",
      publishTier: "company",
      ownerEmail: email,
      createdBy: email,
      orgId: "qa-org",
      visibility: "org",
      entitiesJson: JSON.stringify([
        { type: "person", name: "Ann" },
        { type: "project", name: "Atlas" },
      ]),
      evidenceJson: JSON.stringify([
        { captureId: "capture-a", sourceId: "source-a", quote },
      ]),
    });
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 110 }, (_value, index) => ({
        id: `archived-mention-${index}`,
        sourceId: "source-a",
        captureId: "capture-a",
        audienceId: "audience-a",
        title: "Archived planning",
        body: quote,
        kind: "fact" as const,
        status: "archived" as const,
        publishTier: "company" as const,
        ownerEmail: email,
        createdBy: email,
        orgId: "qa-org",
        visibility: "org" as const,
        updatedAt: "2030-01-01T00:00:00.000Z",
        entitiesJson: JSON.stringify([{ type: "project", name: "Atlas" }]),
        evidenceJson: JSON.stringify([
          { captureId: "capture-a", sourceId: "source-a", quote },
        ]),
      })),
    );
    const people = await getEntityGraph({ type: "person" });
    expect(people.entities).toEqual([]);
    expect(people.edges).toEqual([]);
    expect(
      (await getEntityGraph({ type: "project" })).entities.map(
        (entry) => entry.name,
      ),
    ).toEqual(["Atlas"]);
    expect(
      (
        await searchKnowledgeRows({
          status: "archived",
          includeDrafts: true,
          limit: 200,
        })
      ).length,
    ).toBe(110);
  });

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
    for (const query of ["atlas", " sHiP aTlAs ", "MORGAN", "SHIPPING"])
      expect(
        (await listIntelligence({ query })).records.map((record) => record.id),
      ).toEqual([item.id]);
    expect(first(item.evidence).quote).toBe(
      "Morgan will ship Atlas by 2020-01-01.",
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
        owner: "Casey",
        ownershipConfidence: "ambiguous",
      }),
    ).rejects.toMatchObject({ errorCode: "owner_not_in_evidence" });
    await expect(
      writeIntelligence({ ...input(), dueDate: "2026-11-30" }),
    ).rejects.toMatchObject({ errorCode: "due_date_not_in_evidence" });
    await expect(
      writeIntelligence({
        ...input(),
        entities: [{ type: "person", name: "Casey" }],
      }),
    ).rejects.toMatchObject({ errorCode: "entity_not_in_evidence" });
    expect((await listIntelligence()).records).toEqual([]);
  });

  it("requires distinct owner and entity mentions while accepting case and terminal punctuation", async () => {
    const quote = "Annual planning will ship Atlas by 2020-01-01.";
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    const evidence = [{ captureId: "capture-a", quote }];
    await expect(
      writeIntelligence({
        ...input(),
        owner: "Ann",
        entities: [{ type: "project", name: "Atlas" }],
        evidence,
      }),
    ).rejects.toMatchObject({ errorCode: "owner_not_in_evidence" });
    await expect(
      writeIntelligence({
        ...input(),
        owner: null,
        ownershipConfidence: "ambiguous",
        entities: [{ type: "person", name: "Ann" }],
        evidence,
      }),
    ).rejects.toMatchObject({ errorCode: "entity_not_in_evidence" });
    const supported = "Atlas ships by 2020-01-01. Owner: ANN.";
    await database
      .update(schema.brainRawCaptures)
      .set({ content: supported })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    const { item } = await writeIntelligence({
      ...input(),
      body: "Ann owns shipping Atlas.",
      owner: "Ann",
      entities: [{ type: "person", name: "Ann" }],
      evidence: [{ captureId: "capture-a", quote: supported }],
    });
    expect(item.owner).toBe("Ann");
  });

  it.each(["quarantine", "delete", "change", "revoke"])(
    "withdraws derived facts from lists, graph, briefs and all shared knowledge reads after evidence %s",
    async (operation) => {
      const { item } = await writeIntelligence(input());
      expect((await searchKnowledgeRows({ query: "Atlas" })).length).toBe(1);
      expect(await lookupKnowledgeReferences("Atlas")).toEqual([
        expect.objectContaining({ id: item.id, label: "Ship Atlas" }),
      ]);
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
      expect(await lookupKnowledgeReferences("Atlas")).toEqual([]);
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
    expect((await getEntityGraph()).entities).toEqual([]);
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
    const beyondStalePage = await getEntityGraph({ query: "morgan" });
    expect(beyondStalePage.entities.map((node) => node.name)).toEqual([
      "Morgan",
    ]);
    expect(beyondStalePage.hasMore).toBe(false);
    await database.insert(schema.brainKnowledge).values(
      Array.from({ length: 899 }, (_, index) => ({
        id: `extra-stale-${index}`,
        title: "Morgan project notes",
        body: "Stale project notes",
        ownerEmail: email,
        orgId: "qa-org",
        visibility: "org" as const,
        status: "published" as const,
        intelligenceKind: "action" as const,
        createdBy: email,
        updatedAt: "2035-01-01T00:00:00.000Z",
      })),
    );
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
  it("uses the user's local day near UTC midnight and adds calendar days across the weekly horizon", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T01:00:00.000Z"));
    try {
      await database
        .update(schema.brainRawCaptures)
        .set({
          content: "Morgan will ship Atlas by 2026-11-19.",
          contentHash: "midnight-evidence",
        })
        .where(eq(schema.brainRawCaptures.id, "capture-a"));
      await writeIntelligence({
        ...input(),
        dueDate: "2026-11-19",
        evidence: [
          {
            captureId: "capture-a",
            quote: "Morgan will ship Atlas by 2026-11-19.",
          },
        ],
      });
      const daily = await readPriorities({ owner: "Morgan", period: "daily" });
      expect(daily).toMatchObject({
        timezone: "America/Los_Angeles",
        through: "2026-11-18",
        highConfidence: [],
      });
      const weekly = await readPriorities({
        owner: "Morgan",
        period: "weekly",
      });
      expect(weekly.through).toBe("2026-11-24");
      expect(weekly.highConfidence).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("serves structured writes, cited reads, people lookup and human verification through MCP", async () => {
    const empty = await mcpCall("list-intelligence", { query: "Ship Atlas" });
    expect(empty.structuredContent?.records).toEqual([]);
    expect(await database.select().from(schema.brainKnowledge)).toEqual([]);
    await mcpCall("write-intelligence", input());
    const listed = await mcpCall("list-intelligence", { query: "Ship Atlas" });
    const records = intelligenceItemSchema
      .array()
      .parse(listed.structuredContent?.records);
    expect(records).toHaveLength(1);
    const item = first(records);
    expect(item.title).toBe("Ship Atlas");
    const persisted = first(
      await database
        .select()
        .from(schema.brainKnowledge)
        .where(eq(schema.brainKnowledge.id, item.id)),
    );
    expect(persisted).toMatchObject({
      title: "Ship Atlas",
      ownerEmail: email,
      intelligenceKind: "action",
    });
    expect(item.verification.state).toBe("unverified");
    expect(
      (await mcpCall("get-entity-graph", { query: "Morgan" })).structuredContent
        ?.entities,
    ).toEqual([expect.objectContaining({ name: "Morgan" })]);
    expect(
      (await mcpCall("read-priorities", { owner: "Morgan", period: "weekly" }))
        .structuredContent?.highConfidence,
    ).toEqual([expect.objectContaining({ id: item.id })]);
    await mcpCall("verify-knowledge", {
      knowledgeId: item.id,
      state: "verified",
      attested: true,
      expectedRevision: item.revision,
    });
    const after = await mcpCall("list-intelligence", { id: item.id });
    const verified = first(
      intelligenceItemSchema.array().parse(after.structuredContent?.records),
    );
    expect(verified.verification).toMatchObject({
      state: "verified",
      verifiedBy: email,
    });
    const attestation = first(
      await database
        .select()
        .from(schema.brainKnowledgeVerifications)
        .where(eq(schema.brainKnowledgeVerifications.knowledgeId, item.id)),
    );
    expect(attestation).toMatchObject({ state: "verified", actorEmail: email });
  });
  it("keeps structured facts out of legacy pilot diagnostics while ordinary report controls remain visible", async () => {
    const { item } = await writeIntelligence(input());
    await database.insert(schema.brainKnowledge).values({
      id: "pilot-control",
      sourceId: "source-a",
      title: "Authored report control",
      body: "Ordinary source bookkeeping",
      createdBy: email,
      ownerEmail: email,
      orgId: "qa-org",
      visibility: "org",
      status: "published",
    });
    const before = await getPilotReport.run({
      sourceId: "source-a",
      targetChannel: "#qa",
    });
    expect(before.knowledge.recent.map((record) => record.id)).toEqual([
      "pilot-control",
    ]);
    await database
      .update(schema.brainRawCaptures)
      .set({ sensitivityDisposition: "pending" })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    const after = await getPilotReport.run({
      sourceId: "source-a",
      targetChannel: "#qa",
    });
    expect(after.knowledge.recent.some((record) => record.id === item.id)).toBe(
      false,
    );
    expect(JSON.stringify(after)).not.toContain("Ship Atlas");
  });
  it("retains relative deadline wording without inventing a structured date", async () => {
    const quote = "Morgan will ship Atlas next Friday.";
    await database
      .update(schema.brainRawCaptures)
      .set({ content: quote, contentHash: "relative-deadline" })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    const { item } = await writeIntelligence({
      ...input(),
      body: "Morgan owns Atlas, with next Friday stated as the deadline.",
      dueDate: null,
      evidence: [{ captureId: "capture-a", quote }],
    });
    expect(item.dueDate).toBeNull();
    expect(item.body).toContain("next Friday");
    expect(first(item.evidence).quote).toBe(quote);
  });
  it("does not expose structured source facts through the demo evaluator's fixed-title lookups", async () => {
    await writeIntelligence({
      ...input(),
      title: "Freemium signup retired for enterprise-led growth",
      body: "Source-restricted intelligence body.",
    });
    await database.insert(schema.brainKnowledge).values({
      id: "eval-control",
      title: "Freemium signup was the default acquisition path",
      body: "Ordinary authored evaluation control.",
      createdBy: email,
      ownerEmail: email,
      orgId: "qa-org",
      visibility: "org",
      status: "published",
    });
    await database
      .update(schema.brainRawCaptures)
      .set({ sensitivityDisposition: "pending" })
      .where(eq(schema.brainRawCaptures.id, "capture-a"));
    const report = await runBrainDemoEval({ seedIfMissing: false });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("Source-restricted intelligence body.");
    expect(serialized).toContain("Ordinary authored evaluation control.");
    expect(
      report.checks.find((check) => check.id === "freemium-recall")?.evidence,
    ).toBeNull();
  });
  it.each(["quarantine", "revoke"])(
    "keeps private draft references usable while enforcing evidence %s",
    async (operation) => {
      const { item } = await writeIntelligence({
        ...input(),
        publishTier: "private",
      });
      expect(await lookupKnowledgeReferences("Atlas")).toEqual([
        expect.objectContaining({ id: item.id, label: "Ship Atlas" }),
      ]);
      if (operation === "quarantine")
        await database
          .update(schema.brainRawCaptures)
          .set({ sensitivityDisposition: "pending" })
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      else
        await database
          .update(schema.brainAudienceMembers)
          .set({ status: "revoked" })
          .where(eq(schema.brainAudienceMembers.id, "member-a"));
      expect(await lookupKnowledgeReferences("Atlas")).toEqual([]);
    },
  );
});
