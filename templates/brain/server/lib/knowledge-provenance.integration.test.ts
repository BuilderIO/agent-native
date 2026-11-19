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

const harness = vi.hoisted(() => ({
  db: null as unknown,
  autoRedactEmails: false,
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => harness.db,
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getSetting: async () => ({
    sourcePolicy: "strict",
    autoRedactEmails: harness.autoRedactEmails,
  }),
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";

import askBrainAction from "../../actions/ask-brain.js";
import getKnowledgeAction from "../../actions/get-knowledge.js";
import listKnowledgeAction from "../../actions/list-knowledge.js";
import searchEverythingAction from "../../actions/search-everything.js";
import searchKnowledgeAction from "../../actions/search-knowledge.js";
import { schema } from "../db/index.js";
import { writeKnowledgeRecord } from "./brain.js";

const qaEmail = "qa-fleet@builder.io";
const client = new PGlite();
const database = drizzle(client, { schema });
const quoted = (value: string) => `"${value.split('"').join('""')}"`;
const network = vi.fn(() => {
  throw new Error("No external requests are permitted in this test.");
});

const contact = "customer-only-contact@example.test";
const captureContent = `Morgan will ship Atlas for ${contact}.`;

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
    "CREATE TABLE org_members (id text PRIMARY KEY, org_id text, email text, role text, federation_removal_pending_at text); CREATE TABLE organizations (id text PRIMARY KEY, identity_authority text, identity_id text); INSERT INTO organizations VALUES ('qa-org', NULL, NULL); INSERT INTO org_members VALUES ('owner', 'qa-org', 'qa-fleet@builder.io', 'owner', NULL)",
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
afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  harness.autoRedactEmails = false;
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
    content: captureContent,
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
});

function asQa<T>(work: () => T) {
  return runWithRequestContext(
    { userEmail: qaEmail, orgScope: "personal" },
    async () => await work(),
  );
}

async function saveRedacted(mode: "explicit" | "automatic") {
  harness.autoRedactEmails = mode === "automatic";
  const saved = await asQa(() =>
    writeKnowledgeRecord({
      title: "Atlas contact",
      body: captureContent,
      evidence: [{ captureId: "capture", quote: captureContent }],
      redactions: mode === "explicit" ? [contact] : [],
      publishTier: "company",
    }),
  );
  return saved.knowledge.id;
}

describe("redacted evidence-backed knowledge stays retrievable", () => {
  it.each(["explicit", "automatic"] as const)(
    "%s redaction is saved safely and read back through every reader",
    async (mode) => {
      const id = await saveRedacted(mode);
      const row = await storedRow(id);
      expect(row.status).toBe("redacted");
      expect(JSON.stringify(row)).not.toContain(contact);

      const listed = await asQa(() => listKnowledgeAction.run({ limit: 25 }));
      expect(listed.knowledge.map((item) => item.id)).toContain(id);

      const fetched = await asQa(() => getKnowledgeAction.run({ id }));
      expect(fetched.knowledge?.id).toBe(id);

      const searched = await asQa(() =>
        searchKnowledgeAction.run({
          query: "Atlas",
          includeDrafts: false,
          limit: 25,
        }),
      );
      expect(searched.knowledge.map((item) => item.id)).toContain(id);

      const answered = await asQa(() =>
        askBrainAction.run({ question: "Atlas contact", mode: "cited" }),
      );
      expect(answered.knowledge.map((item) => item.id)).toContain(id);
      expect(
        answered.citations.map((item) =>
          "knowledgeId" in item ? item.knowledgeId : null,
        ),
      ).toContain(id);

      for (const output of [listed, fetched, searched, answered])
        expect(JSON.stringify(output)).not.toContain(contact);
      expect(network).not.toHaveBeenCalled();
    },
  );
});

describe("redaction covers every displayed field", () => {
  const safeUrl = "https://example.test/notes/atlas";
  it.each(["explicit", "automatic"] as const)(
    "%s redaction masks topic, citation title and destination",
    async (mode) => {
      harness.autoRedactEmails = mode === "automatic";
      await database
        .update(schema.brainRawCaptures)
        .set({ title: `Planning with ${contact}` })
        .where(eq(schema.brainRawCaptures.id, "capture"));
      const saved = await asQa(() =>
        writeKnowledgeRecord({
          title: "Atlas contact",
          body: captureContent,
          topic: `Atlas for ${contact}`,
          evidence: [
            {
              captureId: "capture",
              quote: captureContent,
              sourceUrl: `https://example.test/?email=${contact}`,
            },
          ],
          redactions: mode === "explicit" ? [contact] : [],
          publishTier: "company",
        }),
      );
      const id = saved.knowledge.id;
      const row = await storedRow(id);
      expect(JSON.stringify(row)).not.toContain(contact);
      expect(row.status).toBe("redacted");
      const evidence = (
        JSON.parse(row.evidenceJson) as Array<
          { sourceUrl?: string } | undefined
        >
      )[0];
      expect(evidence?.sourceUrl).toBeUndefined();
      const seen = await readers(id);
      expect([seen.list, seen.get, seen.search, seen.ask]).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(seen.output).not.toContain(contact);
    },
  );

  it("keeps an ordinary safe citation URL on a redacted row", async () => {
    const saved = await asQa(() =>
      writeKnowledgeRecord({
        title: "Atlas contact",
        body: captureContent,
        evidence: [
          { captureId: "capture", quote: captureContent, sourceUrl: safeUrl },
        ],
        redactions: [contact],
        publishTier: "company",
      }),
    );
    const row = await storedRow(saved.knowledge.id);
    expect(row.status).toBe("redacted");
    const evidence = (
      JSON.parse(row.evidenceJson) as Array<{ sourceUrl?: string } | undefined>
    )[0];
    expect(evidence?.sourceUrl).toBe(safeUrl);
  });

  it("returns redacted knowledge from universal search", async () => {
    const id = await saveRedacted("explicit");
    const found = await asQa(() =>
      searchEverythingAction.run({
        query: "Atlas",
        type: "knowledge",
        limit: 25,
      }),
    );
    expect(JSON.stringify(found)).toContain(id);
    expect(JSON.stringify(found)).not.toContain(contact);
  });
});

const plainQuote = "Morgan will ship Atlas";

async function saveKnowledge(
  overrides: Partial<Parameters<typeof writeKnowledgeRecord>[0]> = {},
) {
  const saved = await asQa(() =>
    writeKnowledgeRecord({
      title: "Atlas launch",
      body: "Morgan will ship Atlas.",
      evidence: [{ captureId: "capture", quote: plainQuote }],
      publishTier: "company",
      ...overrides,
    }),
  );
  return saved.knowledge.id;
}

async function readers(id: string) {
  return asQa(async () => {
    const listed = await listKnowledgeAction.run({ limit: 25 });
    const fetched = await getKnowledgeAction.run({ id });
    const searched = await searchKnowledgeAction.run({
      query: "Atlas",
      includeDrafts: false,
      limit: 25,
    });
    const answered = await askBrainAction.run({
      question: "Atlas launch",
      mode: "cited",
    });
    return {
      list: listed.knowledge.some((item) => item.id === id),
      get: Boolean(fetched.knowledge),
      search: searched.knowledge.some((item) => item.id === id),
      ask: answered.knowledge.some((item) => item.id === id),
      output: JSON.stringify([listed, fetched, searched, answered]),
    };
  });
}

async function expectVisible(id: string, visible: boolean) {
  const seen = await readers(id);
  expect([seen.list, seen.get, seen.search, seen.ask]).toEqual(
    Array(4).fill(visible),
  );
  return seen;
}

async function expectStandaloneVisible(id: string) {
  const seen = await readers(id);
  expect([seen.list, seen.get, seen.search]).toEqual([true, true, true]);
}

async function storedRow(id: string) {
  const rows = await database
    .select()
    .from(schema.brainKnowledge)
    .where(eq(schema.brainKnowledge.id, id));
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error("Missing knowledge row");
  return row;
}

async function addSecondCapture() {
  await database.insert(schema.brainRawCaptures).values({
    id: "capture-2",
    sourceId: "source",
    title: "Follow-up",
    content: "Atlas ships after the security review.",
    contentHash: null,
    capturedAt: "2026-11-18T12:00:00.000Z",
    sensitivityDisposition: "allowed",
    importedBy: qaEmail,
  });
  await database.insert(schema.brainCaptureAudiences).values({
    id: "capture-audience-2",
    captureId: "capture-2",
    audienceId: "audience",
    aclHash: "acl",
  });
}

describe("provenance binds every stored field to the validated captures", () => {
  it.each([
    ["title", { title: "Changed title" }],
    ["body", { body: "Changed body about Atlas." }],
    ["summary", { summary: "Changed summary" }],
    ["topic", { topic: "Changed topic" }],
    ["tags", { tagsJson: JSON.stringify(["changed"]) }],
    [
      "entities",
      { entitiesJson: JSON.stringify([{ type: "person", name: "Eve" }]) },
    ],
    ["confidence", { confidence: 1 }],
    [
      "evidence",
      {
        evidenceJson: JSON.stringify([
          { captureId: "capture", quote: "Morgan", sourceId: "source" },
        ]),
      },
    ],
  ] as const)(
    "hides the row when %s is edited outside the writer",
    async (_field, change) => {
      const id = await saveKnowledge();
      await expectVisible(id, true);
      await database
        .update(schema.brainKnowledge)
        .set(change)
        .where(eq(schema.brainKnowledge.id, id));
      await expectVisible(id, false);
    },
  );

  it("keeps the row readable across status, visibility and supersession changes", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ visibility: "private", supersedesId: "older" })
      .where(eq(schema.brainKnowledge.id, id));
    await expectVisible(id, true);
  });

  it.each([
    ["missing", null],
    ["not json", "not-json"],
    [
      "wrong version",
      JSON.stringify({ version: 99, revision: "0".repeat(64), captures: [] }),
    ],
    ["unknown shape", JSON.stringify({ version: 1 })],
    [
      "wrong revision",
      JSON.stringify({ version: 1, revision: "0".repeat(64), captures: [] }),
    ],
  ] as const)(
    "fails closed on %s provenance",
    async (_name, provenanceJson) => {
      const id = await saveKnowledge();
      await database
        .update(schema.brainKnowledge)
        .set({ provenanceJson })
        .where(eq(schema.brainKnowledge.id, id));
      await expectVisible(id, false);
    },
  );

  it("fails closed when the bound capture set no longer matches the evidence", async () => {
    const id = await saveKnowledge();
    const row = await storedRow(id);
    const provenance = JSON.parse(row.provenanceJson ?? "{}");
    await database
      .update(schema.brainKnowledge)
      .set({
        provenanceJson: JSON.stringify({
          ...provenance,
          captures: [...provenance.captures, provenance.captures[0]],
        }),
      })
      .where(eq(schema.brainKnowledge.id, id));
    await expectVisible(id, false);
  });

  it("denies capture-linked rows whose evidence was emptied", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ evidenceJson: "[]" })
      .where(eq(schema.brainKnowledge.id, id));
    await expectVisible(id, false);
  });

  it("denies legacy evidence-backed rows that carry no provenance", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ provenanceJson: null })
      .where(eq(schema.brainKnowledge.id, id));
    await expectVisible(id, false);
  });

  it("keeps standalone knowledge without evidence readable and editable", async () => {
    const id = await saveKnowledge({ title: "Atlas notes", evidence: [] });
    const row = await storedRow(id);
    expect(row.provenanceJson).toBeNull();
    expect(row.captureId).toBeNull();
    await expectStandaloneVisible(id);
    await saveKnowledge({
      knowledgeId: id,
      title: "Atlas notes",
      body: "Edited standalone body about Atlas.",
      evidence: [],
    });
    expect((await storedRow(id)).body).toBe(
      "Edited standalone body about Atlas.",
    );
    await expectStandaloneVisible(id);
  });
});

describe("provenance follows the actual capture content", () => {
  it("denies when content changes under an unchanged stored hash, and recovers on restore", async () => {
    const id = await saveKnowledge();
    await expectVisible(id, true);
    await database
      .update(schema.brainRawCaptures)
      .set({ content: `${captureContent} Amended.` })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    expect(
      (await database.select().from(schema.brainRawCaptures))[0]?.contentHash,
    ).toBe("current-hash");
    await expectVisible(id, false);
    await database
      .update(schema.brainRawCaptures)
      .set({ content: captureContent })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    await expectVisible(id, true);
  });

  it("does not need a stored content hash", async () => {
    await database
      .update(schema.brainRawCaptures)
      .set({ contentHash: null })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    const id = await saveKnowledge();
    await expectVisible(id, true);
  });

  it("denies when only a non-primary capture changes or loses access", async () => {
    await addSecondCapture();
    const id = await saveKnowledge({
      evidence: [
        { captureId: "capture", quote: plainQuote },
        { captureId: "capture-2", quote: "Atlas ships" },
      ],
    });
    const row = await storedRow(id);
    expect(row.captureId).toBe("capture");
    expect(JSON.parse(row.provenanceJson ?? "{}").captures).toHaveLength(2);
    await expectVisible(id, true);
    await database
      .update(schema.brainRawCaptures)
      .set({ content: "Atlas ships after a different review." })
      .where(eq(schema.brainRawCaptures.id, "capture-2"));
    await expectVisible(id, false);
    await database
      .update(schema.brainRawCaptures)
      .set({ content: "Atlas ships after the security review." })
      .where(eq(schema.brainRawCaptures.id, "capture-2"));
    await expectVisible(id, true);
    await database
      .delete(schema.brainCaptureAudiences)
      .where(eq(schema.brainCaptureAudiences.captureId, "capture-2"));
    await expectVisible(id, false);
  });
});

describe("live access still gates provenance-valid knowledge", () => {
  it.each([
    [
      "source access revoked",
      () =>
        database
          .update(schema.brainSources)
          .set({ ownerEmail: "other@example.test" })
          .where(eq(schema.brainSources.id, "source")),
    ],
    [
      "audience membership revoked",
      () =>
        database
          .update(schema.brainAudienceMembers)
          .set({ status: "revoked" })
          .where(eq(schema.brainAudienceMembers.id, "member")),
    ],
    [
      "capture disposition no longer allowed",
      () =>
        database
          .update(schema.brainRawCaptures)
          .set({ sensitivityDisposition: "pending" })
          .where(eq(schema.brainRawCaptures.id, "capture")),
    ],
  ])("hides content, citations and ranking after %s", async (_name, revoke) => {
    const id = await saveKnowledge();
    await expectVisible(id, true);
    await revoke();
    const seen = await expectVisible(id, false);
    expect(seen.output).not.toContain("Atlas launch");
    expect(seen.output).not.toContain(plainQuote);
  });
});

describe("editing evidence-backed knowledge", () => {
  it("refuses an edit that omits evidence once the saved quotes were redacted, leaving the row untouched", async () => {
    const id = await saveRedacted("explicit");
    const before = await storedRow(id);
    await expect(
      asQa(() =>
        writeKnowledgeRecord({
          knowledgeId: id,
          title: "Atlas contact",
          body: "Edited without evidence.",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "evidence_resupply_required" });
    expect(await storedRow(id)).toEqual(before);
  });

  it("accepts fresh exact evidence for a redacted row and re-binds provenance", async () => {
    const id = await saveRedacted("explicit");
    await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        title: "Atlas contact",
        body: "Edited with fresh evidence.",
        evidence: [{ captureId: "capture", quote: captureContent }],
        redactions: [contact],
        publishTier: "company",
      }),
    );
    const row = await storedRow(id);
    expect(row.body).toBe("Edited with fresh evidence.");
    expect(JSON.stringify(row)).not.toContain(contact);
    const listed = await asQa(() => listKnowledgeAction.run({ limit: 25 }));
    expect(listed.knowledge.map((item) => item.id)).toContain(id);
  });

  it("rejects fresh evidence that is not an exact quote and keeps the old row", async () => {
    const id = await saveKnowledge();
    const before = await storedRow(id);
    await expect(
      saveKnowledge({
        knowledgeId: id,
        evidence: [{ captureId: "capture", quote: "Morgan will not ship" }],
      }),
    ).rejects.toThrow("exact substring");
    expect(await storedRow(id)).toEqual(before);
  });

  it("lets an unredacted row be edited without re-supplying evidence", async () => {
    const id = await saveKnowledge();
    await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        title: "Atlas launch",
        body: "Edited body about Atlas.",
      }),
    );
    expect((await storedRow(id)).body).toBe("Edited body about Atlas.");
    await expectVisible(id, true);
  });

  it("refuses to edit a legacy row without provenance and allows recreating it", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ provenanceJson: null })
      .where(eq(schema.brainKnowledge.id, id));
    const before = await storedRow(id);
    await expect(
      saveKnowledge({
        knowledgeId: id,
        evidence: [{ captureId: "capture", quote: plainQuote }],
      }),
    ).rejects.toMatchObject({ errorCode: "knowledge_provenance_unavailable" });
    expect(await storedRow(id)).toEqual(before);
    const recreated = await saveKnowledge();
    await expectVisible(recreated, true);
  });

  it("does not tell other users that a legacy row exists", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ provenanceJson: null, ownerEmail: "someone-else@example.test" })
      .where(eq(schema.brainKnowledge.id, id));
    const outcome = await saveKnowledge({
      knowledgeId: id,
      evidence: [{ captureId: "capture", quote: plainQuote }],
    }).catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({
      errorCode: "knowledge_provenance_unavailable",
    });
    expect(outcome).toBeInstanceOf(Error);
  });
});

describe("blast radius of capture changes", () => {
  it("hides knowledge once the capture it cites is invalidated", async () => {
    const id = await saveKnowledge();
    await asQa(async () => {
      const { invalidateDerivedForCapture } = await import("./brain.js");
      await invalidateDerivedForCapture("capture");
    });
    await expectVisible(id, false);
    expect((await storedRow(id)).evidenceJson).toBe("[]");
  });
});
