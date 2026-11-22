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
  provenanceFailure: null as Error | null,
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => harness.db,
}));
vi.mock("./knowledge-provenance.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./knowledge-provenance.js")>();
  return {
    ...actual,
    buildKnowledgeProvenance: async (
      ...args: Parameters<typeof actual.buildKnowledgeProvenance>
    ) => {
      if (harness.provenanceFailure) throw harness.provenanceFailure;
      return actual.buildKnowledgeProvenance(...args);
    },
  };
});
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getSetting: async () => ({
    sourcePolicy: "strict",
    autoRedactEmails: harness.autoRedactEmails,
  }),
}));

import { isSaveConflict } from "@agent-native/core/save-conflict";
import { EXPECTED_REVISION_DESCRIPTION } from "@agent-native/core/save-conflict/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

import approveProposalAction from "../../actions/approve-proposal.js";
import askBrainAction from "../../actions/ask-brain.js";
import getEntityGraphAction from "../../actions/get-entity-graph.js";
import getKnowledgeAction from "../../actions/get-knowledge.js";
import listKnowledgeAction from "../../actions/list-knowledge.js";
import reviewProposalAction from "../../actions/review-proposal.js";
import searchEverythingAction from "../../actions/search-everything.js";
import searchKnowledgeAction from "../../actions/search-knowledge.js";
import writeKnowledgeAction from "../../actions/write-knowledge.js";
import { schema } from "../db/index.js";
import {
  knowledgeRevision,
  validateEvidence,
  writeKnowledgeRecord,
} from "./brain.js";

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
  harness.provenanceFailure = null;
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
      expect(JSON.stringify(row)).not.toContain("customer-only-contact%");

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
  it("does not save or return a meeting time covered by an explicit redaction", async () => {
    await database
      .update(schema.brainRawCaptures)
      .set({
        externalId: "markdown:meeting.md",
        metadataJson: JSON.stringify({ capturedAtSource: "manual-markdown" }),
      })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    const saved = await asQa(() =>
      writeKnowledgeRecord({
        title: "Atlas launch",
        body: "The launch is planned.",
        evidence: [{ captureId: "capture", quote: "Morgan will ship Atlas" }],
        redactions: ["2026-11"],
        publishTier: "company",
      }),
    );
    const row = await storedRow(saved.knowledge.id);
    expect(row.status).toBe("redacted");
    expect(row.evidenceJson).not.toContain("2026-11");
    const fetched = await asQa(() =>
      getKnowledgeAction.run({ id: saved.knowledge.id }),
    );
    expect(JSON.stringify(fetched)).not.toContain("2026-11-18T12:00:00.000Z");
    expect(fetched.knowledge?.evidence[0]).not.toHaveProperty("capturedAt");
  });

  it.each(["2026-11", "Nov 18", "November 18", "18 novembre"])(
    "does not bring a redacted meeting time back after an edit for %s",
    async (redaction) => {
      await database
        .update(schema.brainRawCaptures)
        .set({
          externalId: "markdown:meeting.md",
          metadataJson: JSON.stringify({ capturedAtSource: "manual-markdown" }),
        })
        .where(eq(schema.brainRawCaptures.id, "capture"));
      const saved = await asQa(() =>
        writeKnowledgeRecord({
          title: "Atlas launch",
          body: "The launch is planned.",
          evidence: [{ captureId: "capture", quote: "Morgan will ship Atlas" }],
          redactions: [redaction],
          publishTier: "company",
        }),
      );
      expect(saved.knowledge.status).toBe("redacted");
      expect(saved.knowledge.evidence[0]).not.toHaveProperty("capturedAt");
      const id = saved.knowledge.id;
      const expectedRevision = knowledgeRevision(await storedRow(id));
      await asQa(() =>
        writeKnowledgeRecord({
          knowledgeId: id,
          expectedRevision,
          title: "Atlas launch plan",
          body: "The launch is planned.",
        }),
      );
      const row = await storedRow(id);
      expect(row.title).toBe("Atlas launch plan");
      expect(row.evidenceJson).not.toContain("2026-11");
      const fetched = await asQa(() => getKnowledgeAction.run({ id }));
      expect(JSON.stringify(fetched)).not.toContain("2026-11-18T12:00:00.000Z");
      expect(fetched.knowledge?.evidence[0]).not.toHaveProperty("capturedAt");
    },
  );
  const safeUrl = "https://example.test/notes/atlas";
  const encodedDestination = (times: number) => {
    let at = "@";
    for (let pass = 0; pass < times; pass += 1) at = encodeURIComponent(at);
    return `https://example.test/?email=${contact.replace("@", at)}`;
  };
  const destinations = {
    literal: encodedDestination(0),
    "percent-encoded": encodedDestination(1),
    "double-encoded": encodedDestination(2),
    "triple-encoded": encodedDestination(3),
    "encoded beyond the decode bound": encodedDestination(9),
  };
  it.each(
    (["explicit", "automatic"] as const).flatMap((mode) =>
      (Object.keys(destinations) as Array<keyof typeof destinations>).map(
        (form) => [mode, form] as const,
      ),
    ),
  )(
    "%s redaction masks topic, citation title and a %s destination",
    async (mode, form) => {
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
              sourceUrl: destinations[form],
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

  it("returns no source URL for a receipt-free transcript that has an omission marker", async () => {
    await database
      .update(schema.brainRawCaptures)
      .set({
        kind: "transcript",
        content: `${captureContent}\n[…]\nThe rest of the call.`,
        metadataJson: JSON.stringify({
          sourceUrl: "https://example.test/full-recording",
        }),
      })
      .where(eq(schema.brainRawCaptures.id, "capture"));
    const [item] = await asQa(() =>
      validateEvidence([
        { captureId: "capture", quote: "Morgan will ship Atlas" },
      ]),
    );
    expect(item).not.toHaveProperty("sourceUrl");
  });

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

  it("denies rows whose capture link and evidence were both cleared while provenance remains", async () => {
    const id = await saveKnowledge();
    await database
      .update(schema.brainKnowledge)
      .set({ captureId: null, evidenceJson: "[]" })
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
      expectedRevision: knowledgeRevision(row),
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
          expectedRevision: knowledgeRevision(before),
          title: "Atlas contact",
          body: "Edited without evidence.",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "evidence_resupply_required" });
    expect(await storedRow(id)).toEqual(before);
  });

  it("accepts fresh exact evidence for a redacted row and re-binds provenance", async () => {
    const id = await saveRedacted("explicit");
    const expectedRevision = knowledgeRevision(await storedRow(id));
    await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        expectedRevision,
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
        expectedRevision: knowledgeRevision(before),
        evidence: [{ captureId: "capture", quote: "Morgan will not ship" }],
      }),
    ).rejects.toThrow("exact substring");
    expect(await storedRow(id)).toEqual(before);
  });

  it("lets an unredacted row be edited without re-supplying evidence", async () => {
    const id = await saveKnowledge();
    const expectedRevision = knowledgeRevision(await storedRow(id));
    await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        expectedRevision,
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

// oracle-change: new regression for the atomic capture-finalization boundary; it runs in the primary suite as well as the real-PostgreSQL suite
describe("capture finalization is atomic with its audience assignment", () => {
  const stamp = "2026-11-18T12:00:00.000Z";
  const finalize = (title: string) =>
    asQa(async () => {
      const { createCapture } = await import("./brain.js");
      return createCapture({
        sourceId: "source",
        externalId: "external-atomic",
        title,
        kind: "generic",
        content: "Morgan will ship Atlas on Friday.",
        audience: { kind: "restricted", memberEmails: [qaEmail] },
      });
    });
  const audienceState = async () => ({
    audiences: (await database.select().from(schema.brainAudiences)).map(
      (row) => row.id,
    ),
    links: (await database.select().from(schema.brainCaptureAudiences))
      .map((row) => `${row.captureId}:${row.audienceId}`)
      .sort(),
  });

  beforeEach(async () => {
    await database.insert(schema.brainRawCaptures).values({
      id: "capture-atomic",
      sourceId: "source",
      externalId: "external-atomic",
      title: "Before",
      content: "Morgan will ship Atlas on Thursday.",
      contentHash: "before-hash",
      capturedAt: stamp,
      sensitivityDisposition: "allowed",
      importedBy: qaEmail,
    });
    await client.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS audience_member_principal ON brain_audience_members (audience_id, principal_type, principal_id)",
    );
    await client.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS capture_audience_pair ON brain_capture_audiences (capture_id, audience_id)",
    );
    await client.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS ingest_queue_dedupe ON brain_ingest_queue (dedupe_key)",
    );
    await client.exec(`CREATE OR REPLACE FUNCTION fail_capture_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced failure before the capture update'; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS fail_capture_update ON brain_raw_captures;
      CREATE TRIGGER fail_capture_update BEFORE UPDATE ON brain_raw_captures FOR EACH ROW WHEN (NEW.title = 'retitled') EXECUTE FUNCTION fail_capture_update()`);
  });
  afterEach(async () => {
    await client.exec(
      "DROP TRIGGER IF EXISTS fail_capture_update ON brain_raw_captures",
    );
  });

  it("rolls back the audience assignment when finalizing the capture fails", async () => {
    const before = await audienceState();
    const failure = await finalize("retitled").catch((error: unknown) => error);
    expect(
      JSON.stringify(failure, Object.getOwnPropertyNames(failure)),
    ).toContain("forced failure");
    expect(await audienceState()).toEqual(before);
  });

  it("commits the audience assignment with the capture when finalizing succeeds", async () => {
    const before = await audienceState();
    await finalize("Planning notes");
    const after = await audienceState();
    expect(after.audiences.length).toBeGreaterThan(before.audiences.length);
    expect(after.links).not.toEqual(before.links);
  });
});

describe("provenance checks reuse each capture's digest within a batch", () => {
  it("hashes a shared capture once and consults the cache for later rows", async () => {
    const first = await saveKnowledge();
    const second = await saveKnowledge({ title: "Atlas plan two" });
    const { checkKnowledgeProvenance } =
      await import("./knowledge-provenance.js");
    const live = new Map([["capture", captureContent]]);
    const cache = new Map<string, { content: string; digest: string }>();
    const firstRow = await storedRow(first);
    const secondRow = await storedRow(second);
    expect(
      (await checkKnowledgeProvenance(firstRow, live, cache)).current,
    ).toBe(true);
    expect(cache.size).toBe(1);
    cache.set("capture", { content: captureContent, digest: "poisoned" });
    expect(await checkKnowledgeProvenance(secondRow, live, cache)).toEqual({
      current: false,
      reason: "capture-content-mismatch",
    });
  });
});

describe("redacted knowledge keeps its graph entities and its draft state", () => {
  const safeEntity = [{ type: "person" as const, name: "Morgan" }];
  const saveWithEntity = (
    mode: "explicit" | "automatic",
    publishTier: "company" | "private",
  ) => {
    harness.autoRedactEmails = mode === "automatic";
    return saveKnowledge({
      title: "Atlas contact",
      body: captureContent,
      entities: safeEntity,
      evidence: [{ captureId: "capture", quote: captureContent }],
      redactions: mode === "explicit" ? [contact] : [],
      publishTier,
    });
  };
  const graph = async () => {
    const result = await asQa(() => getEntityGraphAction.run({}));
    return {
      names: result.entities.map((entity) => entity.name),
      edges: result.edges.length,
      output: JSON.stringify(result),
    };
  };

  it.each(["explicit", "automatic"] as const)(
    "%s redaction keeps the safe entity and its edge in the graph until access is revoked",
    async (mode) => {
      const id = await saveWithEntity(mode, "company");
      expect((await storedRow(id)).status).toBe("redacted");
      const seen = await graph();
      expect(seen.names).toContain("Morgan");
      expect(seen.edges).toBeGreaterThan(0);
      expect(seen.output).not.toContain(contact);
      await database
        .update(schema.brainAudienceMembers)
        .set({ status: "revoked" })
        .where(eq(schema.brainAudienceMembers.id, "member"));
      expect((await graph()).names).toEqual([]);
    },
  );

  const universal = async (id: string) => {
    const found = await asQa(() =>
      searchEverythingAction.run({
        query: "Atlas",
        type: "knowledge",
        limit: 25,
      }),
    );
    return JSON.stringify(found).includes(id);
  };
  const searchKnowledge = async (id: string, includeDrafts: boolean) => {
    const found = await asQa(() =>
      searchKnowledgeAction.run({ query: "Atlas", includeDrafts, limit: 25 }),
    );
    return found.knowledge.some((item) => item.id === id);
  };

  it.each(["explicit", "automatic"] as const)(
    "%s redaction of a private draft stays out of universal and default search but appears with includeDrafts",
    async (mode) => {
      const id = await saveWithEntity(mode, "private");
      expect((await storedRow(id)).status).toBe("redacted");
      expect(await universal(id)).toBe(false);
      expect(await searchKnowledge(id, false)).toBe(false);
      expect(await searchKnowledge(id, true)).toBe(true);
    },
  );

  it("a company-tier redacted record is found by universal and default search", async () => {
    const id = await saveWithEntity("explicit", "company");
    expect(await universal(id)).toBe(true);
    expect(await searchKnowledge(id, false)).toBe(true);
  });

  it("a plain private draft is not found by universal or default search", async () => {
    const id = await saveKnowledge({ publishTier: "private" });
    expect((await storedRow(id)).status).toBe("draft");
    expect(await universal(id)).toBe(false);
    expect(await searchKnowledge(id, false)).toBe(false);
  });
});

describe("knowledge updates send the revision they read", () => {
  const update = (id: string, body: string, expectedRevision?: string) =>
    asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        title: "Atlas launch",
        body,
        publishTier: "company",
      }),
    );

  async function conflictOf(write: Promise<unknown>) {
    const error = await write.then(
      () => {
        throw new Error("Expected a save conflict");
      },
      (caught: unknown) => caught,
    );
    if (!isSaveConflict(error)) throw error;
    return error;
  }

  it("returns the record's revision from every read", async () => {
    const id = await saveKnowledge();
    const revision = knowledgeRevision(await storedRow(id));
    const { listed, fetched, searched } = await asQa(async () => ({
      listed: await listKnowledgeAction.run({ limit: 25 }),
      fetched: await getKnowledgeAction.run({ id }),
      searched: await searchKnowledgeAction.run({
        query: "Atlas",
        includeDrafts: false,
        limit: 25,
      }),
    }));
    expect(fetched.knowledge?.revision).toBe(revision);
    expect(listed.knowledge.find((item) => item.id === id)?.revision).toBe(
      revision,
    );
    expect(searched.knowledge.find((item) => item.id === id)?.revision).toBe(
      revision,
    );
    const parameters = writeKnowledgeAction.tool.parameters as {
      properties?: Record<string, { description?: string } | undefined>;
    };
    expect(parameters.properties?.expectedRevision?.description).toContain(
      EXPECTED_REVISION_DESCRIPTION,
    );
  });

  it("writes an update made on the current revision and returns the new one", async () => {
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    const saved = await update(id, "Morgan will ship Atlas on Friday.", read);
    const row = await storedRow(id);
    expect(row.body).toBe("Morgan will ship Atlas on Friday.");
    expect(saved.knowledge.revision).toBe(knowledgeRevision(row));
    expect(saved.knowledge.revision).not.toBe(read);
  });

  it("returns the stored revision from an update that removes the company-context copy", async () => {
    const id = await saveKnowledge({ evidence: [], publishCanonical: true });
    const published = await storedRow(id);
    expect(published.publishedResourcePath).not.toBeNull();
    const saved = await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        expectedRevision: knowledgeRevision(published),
        title: "Atlas launch",
        body: "Morgan will ship Atlas.",
        evidence: [],
        publishTier: "private",
      }),
    );
    const row = await storedRow(id);
    expect(row.publishedResourcePath).toBeNull();
    expect(saved.knowledge.revision).toBe(knowledgeRevision(row));
  });

  it("refuses an update made on a stale read, writing nothing and returning the current record", async () => {
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    const other = await update(id, "Morgan will ship Atlas on Friday.", read);
    const before = await storedRow(id);
    const conflict = await conflictOf(
      update(id, "Morgan will ship Atlas next month.", read),
    );
    expect(conflict).toMatchObject({ statusCode: 409 });
    expect(conflict.details.currentRevision).toBe(other.knowledge.revision);
    expect(conflict.details.current).toMatchObject({
      id,
      body: "Morgan will ship Atlas on Friday.",
      revision: other.knowledge.revision,
    });
    expect(await storedRow(id)).toEqual(before);

    const redone = await update(
      id,
      "Morgan will ship Atlas on Friday, after review.",
      conflict.details.currentRevision ?? undefined,
    );
    expect((await storedRow(id)).body).toBe(
      "Morgan will ship Atlas on Friday, after review.",
    );
    expect(redone.knowledge.revision).not.toBe(other.knowledge.revision);
  });

  it("refuses an update that sends no revision", async () => {
    const id = await saveKnowledge();
    const before = await storedRow(id);
    const conflict = await conflictOf(update(id, "Unread edit about Atlas."));
    expect(conflict.details.currentRevision).toBe(knowledgeRevision(before));
    expect(await storedRow(id)).toEqual(before);
  });

  it("counts a resent update that already applied as done, without writing again", async () => {
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    const first = await update(id, "Morgan will ship Atlas on Friday.", read);
    const applied = await storedRow(id);
    const resent = await update(id, "Morgan will ship Atlas on Friday.", read);
    expect(resent.knowledge).toEqual(first.knowledge);
    expect(await storedRow(id)).toEqual(applied);
  });

  it.each([
    ["body", { body: "Unread edit about Atlas." }],
    ["confidence", { confidence: 10 }],
    ["tags", { tags: ["launch"] }],
    ["publish tier", { publishTier: "private" as const }],
    ["redactions", { redactions: ["Atlas"] }],
    ["canonical mirror", { publishCanonical: true }],
  ])(
    "refuses an update that sends no revision and differs in %s, returning the current record",
    async (_field, change) => {
      const id = await saveKnowledge({ evidence: [] });
      const before = await storedRow(id);
      const conflict = await conflictOf(
        asQa(() =>
          writeKnowledgeRecord({
            knowledgeId: id,
            title: "Atlas launch",
            body: "Morgan will ship Atlas.",
            publishTier: "company",
            ...change,
          }),
        ),
      );
      expect(conflict).toMatchObject({ statusCode: 409 });
      expect(conflict.details.current).toMatchObject({
        id,
        revision: knowledgeRevision(before),
      });
      expect(await storedRow(id)).toEqual(before);
    },
  );

  it("refuses a stale resend that asks for a canonical mirror the first save did not publish", async () => {
    const id = await saveKnowledge({ evidence: [] });
    const read = knowledgeRevision(await storedRow(id));
    await asQa(() =>
      writeKnowledgeRecord({
        knowledgeId: id,
        expectedRevision: read,
        title: "Atlas launch",
        body: "Morgan will ship Atlas on Friday.",
        evidence: [],
        publishTier: "company",
      }),
    );
    const applied = await storedRow(id);
    expect(applied.publishedResourcePath).toBeNull();
    const conflict = await conflictOf(
      asQa(() =>
        writeKnowledgeRecord({
          knowledgeId: id,
          expectedRevision: read,
          title: "Atlas launch",
          body: "Morgan will ship Atlas on Friday.",
          evidence: [],
          publishTier: "company",
          publishCanonical: true,
        }),
      ),
    );
    expect(conflict.details.current).toMatchObject({
      id,
      publishedResourcePath: null,
      revision: knowledgeRevision(applied),
    });
    expect(await storedRow(id)).toEqual(applied);
  });

  describe("after an edit that redacted the stored quote", () => {
    async function redactInPlace() {
      const id = await saveKnowledge({
        title: "Atlas contact",
        body: "Morgan will ship Atlas.",
        evidence: [{ captureId: "capture", quote: captureContent }],
      });
      const read = knowledgeRevision(await storedRow(id));
      const edit = {
        knowledgeId: id,
        expectedRevision: read,
        title: "Atlas contact",
        body: "Morgan will ship Atlas.",
        redactions: [contact],
        publishTier: "company" as const,
      };
      const first = await asQa(() => writeKnowledgeRecord(edit));
      const applied = await storedRow(id);
      expect(applied.status).toBe("redacted");
      expect(applied.evidenceJson).not.toContain(contact);
      return { id, read, edit, first, applied };
    }

    it("answers an identical resend with the current record, not an evidence error", async () => {
      const { edit, first, applied, id } = await redactInPlace();
      const conflict = await conflictOf(asQa(() => writeKnowledgeRecord(edit)));
      expect(conflict.details).toMatchObject({
        current: first.knowledge,
        currentRevision: first.knowledge.revision,
      });
      expect(await storedRow(id)).toEqual(applied);
    });

    it("refuses a different stale edit with the current record, not an evidence error", async () => {
      const { edit, applied, id } = await redactInPlace();
      const conflict = await conflictOf(
        asQa(() =>
          writeKnowledgeRecord({ ...edit, body: "A different stale edit." }),
        ),
      );
      expect(conflict.details).toMatchObject({
        current: { id, body: "Morgan will ship Atlas." },
        currentRevision: knowledgeRevision(applied),
      });
      expect(await storedRow(id)).toEqual(applied);
    });
  });

  it("writes no audience or dependency rows when an update backed by two audiences is resent", async () => {
    await client.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_dependency_unique_idx ON brain_audience_dependencies (audience_id, depends_on_audience_id); CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_source_dependency_unique_idx ON brain_audience_source_dependencies (audience_id, source_id); CREATE UNIQUE INDEX IF NOT EXISTS brain_audience_member_principal_idx ON brain_audience_members (audience_id, principal_type, principal_id)",
    );
    await addSecondCapture();
    await database.insert(schema.brainAudiences).values({
      id: "audience-2",
      sourceId: "source",
      kind: "restricted",
      aclHash: "acl-2",
      membershipState: "current",
    });
    await database.insert(schema.brainAudienceMembers).values({
      id: "member-2",
      audienceId: "audience-2",
      principalType: "user",
      principalId: qaEmail,
      syncedAt: "2026-11-18T12:00:00.000Z",
    });
    await database
      .update(schema.brainCaptureAudiences)
      .set({ audienceId: "audience-2", aclHash: "acl-2" })
      .where(eq(schema.brainCaptureAudiences.captureId, "capture-2"));
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    const edit = {
      knowledgeId: id,
      expectedRevision: read,
      title: "Atlas launch",
      body: "Morgan will ship Atlas after the security review.",
      evidence: [
        { captureId: "capture", quote: plainQuote },
        { captureId: "capture-2", quote: "Atlas ships" },
      ],
      publishTier: "company" as const,
    };
    const first = await asQa(() => writeKnowledgeRecord(edit));
    const audienceState = async () => ({
      knowledge: await storedRow(id),
      audiences: await database
        .select()
        .from(schema.brainAudiences)
        .orderBy(schema.brainAudiences.id),
      dependencies: await database
        .select()
        .from(schema.brainAudienceDependencies)
        .orderBy(schema.brainAudienceDependencies.id),
      sourceDependencies: await database
        .select()
        .from(schema.brainAudienceSourceDependencies)
        .orderBy(schema.brainAudienceSourceDependencies.id),
      members: await database
        .select()
        .from(schema.brainAudienceMembers)
        .orderBy(schema.brainAudienceMembers.id),
    });
    const applied = await audienceState();
    expect(applied.knowledge.audienceId).not.toBe("audience");
    expect(applied.dependencies).toHaveLength(2);
    const resent = await asQa(() => writeKnowledgeRecord(edit));
    expect(resent.knowledge).toEqual(first.knowledge);
    expect(await audienceState()).toEqual(applied);
  });

  describe("a resend counts as applied only when it would store what is stored", () => {
    const citedEdit = (
      id: string,
      change: Partial<Parameters<typeof writeKnowledgeRecord>[0]> = {},
    ) => ({
      knowledgeId: id,
      title: "Atlas launch",
      body: "Morgan will ship the launch.",
      evidence: [{ captureId: "capture", quote: plainQuote }],
      publishTier: "company" as const,
      ...change,
    });

    it("refuses a resend that adds the citation title to the redactions", async () => {
      const id = await saveKnowledge();
      const read = knowledgeRevision(await storedRow(id));
      await asQa(() =>
        writeKnowledgeRecord(
          citedEdit(id, { expectedRevision: read, redactions: ["Atlas"] }),
        ),
      );
      const applied = await storedRow(id);
      expect(applied.evidenceJson).toContain("Planning");
      const conflict = await conflictOf(
        asQa(() =>
          writeKnowledgeRecord(
            citedEdit(id, { redactions: ["Atlas", "Planning"] }),
          ),
        ),
      );
      expect(conflict.details.currentRevision).toBe(knowledgeRevision(applied));
      expect(await storedRow(id)).toEqual(applied);
    });

    it("counts an exact resend that redacts only the citation title as applied", async () => {
      const id = await saveKnowledge();
      const edit = citedEdit(id, {
        expectedRevision: knowledgeRevision(await storedRow(id)),
        redactions: ["Planning"],
      });
      const first = await asQa(() => writeKnowledgeRecord(edit));
      const applied = await storedRow(id);
      expect(applied.status).toBe("redacted");
      expect(applied.evidenceJson).not.toContain("Planning");
      const resent = await asQa(() => writeKnowledgeRecord(edit));
      expect(resent.knowledge).toEqual(first.knowledge);
      expect(await storedRow(id)).toEqual(applied);
    });

    it("refuses a resend without a revision that drops an explicit citation URL", async () => {
      const id = await saveKnowledge();
      const cited = [
        {
          captureId: "capture",
          quote: plainQuote,
          sourceUrl: "https://example.test/planning",
        },
      ];
      const read = knowledgeRevision(await storedRow(id));
      await asQa(() =>
        writeKnowledgeRecord(
          citedEdit(id, { expectedRevision: read, evidence: cited }),
        ),
      );
      const applied = await storedRow(id);
      expect(applied.evidenceJson).toContain("https://example.test/planning");
      await asQa(() =>
        writeKnowledgeRecord(citedEdit(id, { evidence: cited })),
      );
      expect(await storedRow(id)).toEqual(applied);
      const conflict = await conflictOf(
        asQa(() => writeKnowledgeRecord(citedEdit(id))),
      );
      expect(conflict.details.currentRevision).toBe(knowledgeRevision(applied));
      expect(await storedRow(id)).toEqual(applied);
    });
  });

  it("refuses an update that supersedes itself", async () => {
    const id = await saveKnowledge();
    const before = await storedRow(id);
    await expect(
      saveKnowledge({
        knowledgeId: id,
        expectedRevision: knowledgeRevision(before),
        supersedesId: id,
      }),
    ).rejects.toMatchObject({
      errorCode: "knowledge_supersedes_self",
      statusCode: 400,
    });
    expect(await storedRow(id)).toEqual(before);
  });

  it("creates without a revision", async () => {
    const first = await saveKnowledge();
    const second = await saveKnowledge();
    expect(second).not.toBe(first);
    expect((await storedRow(second)).body).toBe("Morgan will ship Atlas.");
  });
});

async function caughtError(write: unknown) {
  return Promise.resolve(write).then(
    () => {
      throw new Error("Expected the write to fail");
    },
    (caught: unknown) => caught,
  );
}

describe("a stale update's replay check reports failures it did not expect", () => {
  it("passes an unexpected error from the check through instead of a save conflict", async () => {
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    await saveKnowledge({
      knowledgeId: id,
      expectedRevision: read,
      body: "Morgan will ship Atlas on Friday.",
    });
    const before = await storedRow(id);
    harness.provenanceFailure = new Error("provenance store offline");
    const error = await caughtError(
      saveKnowledge({
        knowledgeId: id,
        expectedRevision: read,
        body: "Morgan will ship Atlas next month.",
      }),
    );
    expect(isSaveConflict(error)).toBe(false);
    expect(error).toBe(harness.provenanceFailure);
    expect(await storedRow(id)).toEqual(before);
  });

  it("still answers a stale update whose evidence no longer validates with the current record", async () => {
    const id = await saveKnowledge();
    const read = knowledgeRevision(await storedRow(id));
    await saveKnowledge({
      knowledgeId: id,
      expectedRevision: read,
      body: "Morgan will ship Atlas on Friday.",
    });
    const before = await storedRow(id);
    const error = await caughtError(
      saveKnowledge({
        knowledgeId: id,
        expectedRevision: read,
        evidence: [{ captureId: "capture", quote: "Not in the capture." }],
      }),
    );
    expect(isSaveConflict(error)).toBe(true);
    expect(error).toMatchObject({
      details: { currentRevision: knowledgeRevision(before) },
    });
    expect(await storedRow(id)).toEqual(before);
  });
});

describe("superseding knowledge sends the superseded record's revision", () => {
  async function olderAndNewer() {
    const older = await saveKnowledge({ title: "Atlas launch v1" });
    const newer = await saveKnowledge({ title: "Atlas launch v2" });
    return { older, newer };
  }

  const supersede = (
    newer: string,
    older: string,
    supersedesRevision: string | undefined,
    expectedRevision?: string,
  ) =>
    saveKnowledge({
      knowledgeId: newer,
      expectedRevision,
      title: "Atlas launch v2",
      body: "Morgan will ship Atlas after review.",
      supersedesId: older,
      supersedesRevision,
    });

  it("archives the superseded record when its revision is current", async () => {
    const { older, newer } = await olderAndNewer();
    const read = await storedRow(older);
    const before = await storedRow(newer);
    await supersede(
      newer,
      older,
      knowledgeRevision(read),
      knowledgeRevision(before),
    );
    const archived = await storedRow(older);
    expect(archived).toMatchObject({
      status: "archived",
      supersededById: newer,
    });
    expect(archived.updatedAt > read.updatedAt).toBe(true);
    expect(await storedRow(newer)).toMatchObject({
      supersedesId: older,
      body: "Morgan will ship Atlas after review.",
    });
  });

  it("refuses a stale superseded revision, writing nothing and returning the superseded record", async () => {
    const { older, newer } = await olderAndNewer();
    const stale = knowledgeRevision(await storedRow(older));
    await saveKnowledge({
      knowledgeId: older,
      expectedRevision: stale,
      title: "Atlas launch v1",
      body: "Morgan will ship Atlas next quarter.",
    });
    const olderBefore = await storedRow(older);
    const newerBefore = await storedRow(newer);
    const error = await caughtError(
      supersede(newer, older, stale, knowledgeRevision(newerBefore)),
    );
    expect(isSaveConflict(error)).toBe(true);
    expect(error).toMatchObject({
      statusCode: 409,
      details: {
        current: {
          id: older,
          body: "Morgan will ship Atlas next quarter.",
          revision: knowledgeRevision(olderBefore),
        },
        currentRevision: knowledgeRevision(olderBefore),
      },
    });
    expect(String(error)).toContain(`superseded knowledge ${older}`);
    expect(await storedRow(older)).toEqual(olderBefore);
    expect(await storedRow(newer)).toEqual(newerBefore);
  });

  it("refuses a new record that supersedes on a stale read without creating it", async () => {
    const { older } = await olderAndNewer();
    const stale = knowledgeRevision(await storedRow(older));
    await saveKnowledge({
      knowledgeId: older,
      expectedRevision: stale,
      body: "Morgan will ship Atlas next quarter.",
    });
    const olderBefore = await storedRow(older);
    const count = (await database.select().from(schema.brainKnowledge)).length;
    const error = await caughtError(
      saveKnowledge({
        title: "Atlas launch v3",
        supersedesId: older,
        supersedesRevision: stale,
      }),
    );
    expect(error).toMatchObject({
      details: { currentRevision: knowledgeRevision(olderBefore) },
    });
    expect(await storedRow(older)).toEqual(olderBefore);
    expect(await database.select().from(schema.brainKnowledge)).toHaveLength(
      count,
    );
  });

  it("rejects supersedesId without supersedesRevision as invalid input", async () => {
    const { older } = await olderAndNewer();
    const olderBefore = await storedRow(older);
    const count = (await database.select().from(schema.brainKnowledge)).length;
    await expect(
      asQa(() =>
        writeKnowledgeAction.run({
          title: "Atlas launch v3",
          body: "Morgan will ship Atlas.",
          supersedesId: older,
        }),
      ),
    ).rejects.toThrow(/supersedesRevision/);
    await expect(
      saveKnowledge({ title: "Atlas launch v3", supersedesId: older }),
    ).rejects.toMatchObject({
      errorCode: "supersedes_revision_required",
      statusCode: 400,
    });
    expect(await storedRow(older)).toEqual(olderBefore);
    expect(await database.select().from(schema.brainKnowledge)).toHaveLength(
      count,
    );
    const parameters = writeKnowledgeAction.tool.parameters as {
      properties?: Record<string, { description?: string } | undefined>;
    };
    expect(parameters.properties?.supersedesRevision?.description).toContain(
      EXPECTED_REVISION_DESCRIPTION,
    );
  });

  it("counts a resent supersession that already applied as done", async () => {
    const { older, newer } = await olderAndNewer();
    const olderRead = knowledgeRevision(await storedRow(older));
    const newerRead = knowledgeRevision(await storedRow(newer));
    await supersede(newer, older, olderRead, newerRead);
    const olderApplied = await storedRow(older);
    const newerApplied = await storedRow(newer);
    await supersede(newer, older, olderRead, newerRead);
    expect(await storedRow(older)).toEqual(olderApplied);
    expect(await storedRow(newer)).toEqual(newerApplied);

    await saveKnowledge({
      knowledgeId: newer,
      expectedRevision: knowledgeRevision(newerApplied),
      title: "Atlas launch v2",
      body: "Morgan will ship Atlas after the final review.",
      supersedesId: older,
      supersedesRevision: olderRead,
    });
    expect(await storedRow(older)).toEqual(olderApplied);
    expect((await storedRow(newer)).body).toBe(
      "Morgan will ship Atlas after the final review.",
    );
  });

  it("refuses a resent create once its first send superseded the record", async () => {
    const { older } = await olderAndNewer();
    const read = knowledgeRevision(await storedRow(older));
    const create = {
      title: "Atlas launch v3",
      body: "Morgan will ship Atlas after review.",
      supersedesId: older,
      supersedesRevision: read,
    };
    const first = await saveKnowledge(create);
    const archived = await storedRow(older);
    expect(archived).toMatchObject({
      status: "archived",
      supersededById: first,
    });
    const count = (await database.select().from(schema.brainKnowledge)).length;
    const refusal = {
      errorCode: "knowledge_already_superseded",
      statusCode: 409,
      details: { supersededById: first },
    };
    await expect(saveKnowledge(create)).rejects.toMatchObject(refusal);
    await expect(
      saveKnowledge({
        ...create,
        supersedesRevision: knowledgeRevision(archived),
      }),
    ).rejects.toMatchObject(refusal);
    expect(await storedRow(older)).toEqual(archived);
    expect(await database.select().from(schema.brainKnowledge)).toHaveLength(
      count,
    );
  });
});

describe("approving a legacy proposal checks the record has not changed since", () => {
  async function proposeUpdate(
    knowledgeId: string,
    createdAt: string,
    payload: Record<string, unknown> = {},
  ) {
    const id = `proposal-${knowledgeId}-${createdAt}`;
    await database.insert(schema.brainProposals).values({
      id,
      knowledgeId,
      title: "Atlas launch",
      body: "Morgan will ship Atlas in spring.",
      proposedAction: "update",
      payloadJson: JSON.stringify({
        knowledgeId,
        title: "Atlas launch",
        body: "Morgan will ship Atlas in spring.",
        publishTier: "company",
        ...payload,
      }),
      createdBy: qaEmail,
      createdAt,
      updatedAt: createdAt,
      ownerEmail: qaEmail,
      visibility: "private",
    });
    return id;
  }

  function justAfter(at: string) {
    return new Date(Date.parse(at) + 1).toISOString();
  }

  async function proposalStatus(id: string) {
    const rows = await database
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, id));
    return rows.find((row) => row.id === id)?.status;
  }

  const approvals = [
    [
      "approve-proposal",
      (proposalId: string) => approveProposalAction.run({ proposalId }),
    ],
    [
      "review-proposal",
      (proposalId: string) =>
        reviewProposalAction.run({ id: proposalId, decision: "approve" }),
    ],
  ] as const;

  it.each(approvals)(
    "%s applies a proposal for a record unchanged since it was proposed",
    async (_action, approve) => {
      const id = await saveKnowledge();
      const proposal = await proposeUpdate(
        id,
        justAfter((await storedRow(id)).updatedAt),
      );
      await asQa(() => approve(proposal));
      expect((await storedRow(id)).body).toBe(
        "Morgan will ship Atlas in spring.",
      );
      expect(await proposalStatus(proposal)).toBe("approved");
    },
  );

  it.each(approvals)(
    "%s refuses a proposal for a record edited after it was proposed, changing nothing",
    async (_action, approve) => {
      const id = await saveKnowledge();
      const proposed = await storedRow(id);
      const proposal = await proposeUpdate(id, justAfter(proposed.updatedAt));
      await saveKnowledge({
        knowledgeId: id,
        expectedRevision: knowledgeRevision(proposed),
        body: "Morgan will ship Atlas on Friday.",
      });
      const before = await storedRow(id);
      const error = await caughtError(asQa(() => approve(proposal)));
      expect(isSaveConflict(error)).toBe(true);
      expect(error).toMatchObject({
        details: {
          current: { id, body: "Morgan will ship Atlas on Friday." },
          currentRevision: knowledgeRevision(before),
        },
      });
      expect(await storedRow(id)).toEqual(before);
      expect(await proposalStatus(proposal)).toBe("pending");
    },
  );

  it.each(approvals)(
    "%s refuses a proposal made in the same millisecond as the record's last edit",
    async (_action, approve) => {
      const id = await saveKnowledge();
      const before = await storedRow(id);
      const proposal = await proposeUpdate(id, before.updatedAt);
      const error = await caughtError(asQa(() => approve(proposal)));
      expect(isSaveConflict(error)).toBe(true);
      expect(await storedRow(id)).toEqual(before);
      expect(await proposalStatus(proposal)).toBe("pending");
    },
  );

  it.each(approvals)(
    "%s refuses a proposal whose superseded record was edited after it was proposed",
    async (_action, approve) => {
      const target = await saveKnowledge({ title: "Atlas launch v2" });
      const older = await saveKnowledge({ title: "Atlas launch v1" });
      const proposedOlder = await storedRow(older);
      const proposal = await proposeUpdate(
        target,
        justAfter(proposedOlder.updatedAt),
        {
          supersedesId: older,
        },
      );
      await saveKnowledge({
        knowledgeId: older,
        expectedRevision: knowledgeRevision(proposedOlder),
        title: "Atlas launch v1",
        body: "Morgan will ship Atlas next quarter.",
      });
      const olderBefore = await storedRow(older);
      const targetBefore = await storedRow(target);
      const error = await caughtError(asQa(() => approve(proposal)));
      expect(error).toMatchObject({
        details: {
          current: { id: older },
          currentRevision: knowledgeRevision(olderBefore),
        },
      });
      expect(await storedRow(older)).toEqual(olderBefore);
      expect(await storedRow(target)).toEqual(targetBefore);
      expect(await proposalStatus(proposal)).toBe("pending");
    },
  );
});
