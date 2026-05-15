import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "eq"; col: Column; val: unknown }
  | { op: "isNull"; col: Column }
  | { op: "like"; col: Column; val: unknown }
  | { op: "access" };

interface Column {
  table: string;
  name: string;
}

interface Row {
  [key: string]: unknown;
}

const mocks = vi.hoisted(() => {
  const col = (table: string, name: string) => ({ table, name });
  const table = (name: string, columns: string[]) =>
    Object.fromEntries([
      ["__tableName", name],
      ...columns.map((column) => [column, col(name, column)]),
    ]);

  const schema = {
    brainSources: table("brainSources", [
      "id",
      "title",
      "provider",
      "status",
      "configJson",
      "cursorJson",
      "lastSyncedAt",
      "lastError",
      "ownerEmail",
      "orgId",
      "visibility",
      "createdAt",
      "updatedAt",
    ]),
    brainSourceShares: table("brainSourceShares", ["id"]),
    brainRawCaptures: table("brainRawCaptures", [
      "id",
      "sourceId",
      "externalId",
      "title",
      "kind",
      "content",
      "contentHash",
      "metadataJson",
      "capturedAt",
      "importedBy",
      "status",
      "distilledAt",
      "createdAt",
      "updatedAt",
    ]),
    brainKnowledge: table("brainKnowledge", [
      "id",
      "sourceId",
      "captureId",
      "kind",
      "title",
      "body",
      "summary",
      "topic",
      "tagsJson",
      "entitiesJson",
      "evidenceJson",
      "publishedResourcePath",
      "supersedesId",
      "supersededById",
      "confidence",
      "status",
      "publishTier",
      "createdBy",
      "publishedAt",
      "ownerEmail",
      "orgId",
      "visibility",
      "createdAt",
      "updatedAt",
    ]),
    brainKnowledgeShares: table("brainKnowledgeShares", ["id"]),
    brainProposals: table("brainProposals", [
      "id",
      "knowledgeId",
      "sourceId",
      "captureId",
      "title",
      "body",
      "rationale",
      "proposedAction",
      "payloadJson",
      "evidenceJson",
      "status",
      "reviewerNotes",
      "createdBy",
      "reviewedBy",
      "reviewedAt",
      "ownerEmail",
      "orgId",
      "visibility",
      "createdAt",
      "updatedAt",
    ]),
    brainProposalShares: table("brainProposalShares", ["id"]),
    brainSyncRuns: table("brainSyncRuns", [
      "id",
      "sourceId",
      "provider",
      "status",
      "statsJson",
      "error",
      "startedAt",
      "completedAt",
    ]),
    brainIngestQueue: table("brainIngestQueue", ["id"]),
  };

  const rows = {
    sources: [] as Row[],
    captures: [] as Row[],
    knowledge: [] as Row[],
    proposals: [] as Row[],
    syncRuns: [] as Row[],
  };

  const tableRows = (tableRef: Row) => {
    if (tableRef === schema.brainSources) return rows.sources;
    if (tableRef === schema.brainRawCaptures) return rows.captures;
    if (tableRef === schema.brainKnowledge) return rows.knowledge;
    if (tableRef === schema.brainProposals) return rows.proposals;
    if (tableRef === schema.brainSyncRuns) return rows.syncRuns;
    return [];
  };

  const matches = (row: Row, condition?: Condition): boolean => {
    if (!condition) return true;
    if (condition.op === "access") return true;
    if (condition.op === "and") {
      return condition.conditions.every((item) => matches(row, item));
    }
    if (condition.op === "or") {
      return condition.conditions.some((item) => matches(row, item));
    }
    if (condition.op === "isNull") return row[condition.col.name] == null;
    if (condition.op === "like") return true;
    return row[condition.col.name] === condition.val;
  };

  const select = vi.fn(() => ({
    from: vi.fn((tableRef: Row) => ({
      where: vi.fn((condition: Condition) => ({
        limit: vi.fn(async (limit: number) =>
          tableRows(tableRef)
            .filter((row) => matches(row, condition))
            .slice(0, limit),
        ),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async (limit: number) =>
            tableRows(tableRef)
              .filter((row) => matches(row, condition))
              .slice(0, limit),
          ),
        })),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(async (limit: number) =>
          tableRows(tableRef).slice(0, limit),
        ),
      })),
      limit: vi.fn(async (limit: number) =>
        tableRows(tableRef).slice(0, limit),
      ),
    })),
  }));

  const insert = vi.fn((tableRef: Row) => ({
    values: vi.fn(async (row: Row) => {
      tableRows(tableRef).push({ ...row });
    }),
  }));

  const update = vi.fn((tableRef: Row) => ({
    set: vi.fn((fields: Row) => ({
      where: vi.fn(async (condition: Condition) => {
        for (const row of tableRows(tableRef)) {
          if (matches(row, condition)) Object.assign(row, fields);
        }
      }),
    })),
  }));

  return {
    schema,
    db: { select, insert, update },
    rows,
    userEmail: "owner@example.test",
    orgId: "org-1" as string | null,
    settings: {
      requireApprovalForCompanyKnowledge: true,
      autoRedactEmails: true,
      defaultPublishTier: "company",
      distillationInstructions:
        "Distill durable, reusable institutional knowledge. Preserve short direct quotes as evidence.",
      connectorPollMinutes: 60,
    },
    resourceWrites: [] as Row[],
  };
});

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));

vi.mock("@agent-native/core/db", () => ({
  createGetDb: () => () => mocks.db,
}));

vi.mock("@agent-native/core/db/schema", () => ({
  createSharesTable: (name: string) => ({ __tableName: name }),
  integer: (name: string) => ({
    name,
    notNull: () => ({
      default: () => ({ name }),
    }),
  }),
  now: () => "CURRENT_TIMESTAMP",
  ownableColumns: () => ({
    ownerEmail: { name: "ownerEmail" },
    orgId: { name: "orgId" },
    visibility: { name: "visibility" },
  }),
  table: (name: string, columns: Row) => ({ __tableName: name, ...columns }),
  text: (name: string) => ({
    name,
    notNull: () => ({
      default: () => ({ name }),
    }),
    primaryKey: () => ({ name }),
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  desc: (column: Column) => ({ op: "desc", column }),
  eq: (col: Column, val: unknown) => ({ op: "eq", col, val }),
  isNull: (col: Column) => ({ op: "isNull", col }),
  like: (col: Column, val: unknown) => ({ op: "like", col, val }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestOrgId: () => mocks.orgId,
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => ({
    userEmail: mocks.userEmail,
    orgId: mocks.orgId,
  }),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(async () => "test-token"),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: vi.fn(async () => mocks.settings),
  putSetting: vi.fn(async (_key: string, value: typeof mocks.settings) => {
    mocks.settings = { ...mocks.settings, ...value };
  }),
}));

vi.mock("@agent-native/core/resources/store", () => ({
  SHARED_OWNER: "shared",
  resourcePut: vi.fn(
    async (
      owner: string,
      path: string,
      content: string,
      contentType: string,
      opts: Row,
    ) => {
      mocks.resourceWrites.push({ owner, path, content, contentType, opts });
    },
  ),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ op: "access" }),
  assertAccess: vi.fn(async (type: string, id: string) => {
    if (type === "brain-source") {
      const resource = mocks.rows.sources.find((row) => row.id === id);
      if (!resource) throw new Error(`No access to brain source ${id}`);
      return { resource, role: "owner" };
    }
    if (type === "brain-knowledge") {
      const resource = mocks.rows.knowledge.find((row) => row.id === id);
      if (!resource) throw new Error(`No access to brain knowledge ${id}`);
      return { resource, role: "owner" };
    }
    throw new Error(`Unexpected access type ${type}`);
  }),
  registerShareableResource: vi.fn(),
  resolveAccess: vi.fn(async (type: string, id: string) => {
    if (type === "brain-source") {
      const resource = mocks.rows.sources.find((row) => row.id === id);
      return resource ? { resource, role: "owner" } : null;
    }
    if (type === "brain-knowledge") {
      const resource = mocks.rows.knowledge.find((row) => row.id === id);
      return resource ? { resource, role: "owner" } : null;
    }
    return null;
  }),
}));

import {
  applyRedactions,
  validateEvidence,
  writeKnowledgeRecord,
} from "./brain.js";
import {
  isSlackDirectConversation,
  normalizeGranolaNote,
  runConnectorSync,
} from "./connectors.js";

function resetMocks() {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  for (const values of Object.values(mocks.rows)) values.length = 0;
  mocks.resourceWrites.length = 0;
  mocks.userEmail = "owner@example.test";
  mocks.orgId = "org-1";
  mocks.settings = {
    requireApprovalForCompanyKnowledge: true,
    autoRedactEmails: true,
    defaultPublishTier: "company",
    distillationInstructions:
      "Distill durable, reusable institutional knowledge. Preserve short direct quotes as evidence.",
    connectorPollMinutes: 60,
  };
}

function seedSource(overrides: Row = {}) {
  const now = "2026-05-15T12:00:00.000Z";
  const source = {
    id: "source-1",
    title: "Brain source",
    provider: "manual",
    status: "active",
    configJson: "{}",
    cursorJson: "{}",
    lastSyncedAt: null,
    lastError: null,
    ownerEmail: mocks.userEmail,
    orgId: mocks.orgId,
    visibility: "org",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  mocks.rows.sources.push(source);
  return source;
}

function seedCapture(overrides: Row = {}) {
  const now = "2026-05-15T12:00:00.000Z";
  const capture = {
    id: "capture-1",
    sourceId: "source-1",
    externalId: null,
    title: "Planning note",
    kind: "note",
    content: "Decision: ship the beta on May 20. Contact alice@example.com.",
    contentHash: "hash",
    metadataJson: "{}",
    capturedAt: now,
    importedBy: mocks.userEmail,
    status: "queued",
    distilledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  mocks.rows.captures.push(capture);
  return capture;
}

beforeEach(resetMocks);

describe("Brain memory quality gates", () => {
  it("rejects evidence quotes that are not exact capture substrings", async () => {
    seedSource();
    seedCapture();

    await expect(
      validateEvidence([
        { captureId: "capture-1", quote: "ship beta on May 20" },
      ]),
    ).rejects.toThrow(/exact substring/);
  });

  it("redacts email addresses from knowledge fields and evidence", () => {
    const result = applyRedactions({
      title: "Follow up with alice@example.com",
      body: "alice@example.com owns the launch checklist.",
      summary: "Ask alice@example.com for launch notes.",
      evidence: [
        {
          captureId: "capture-1",
          sourceId: "source-1",
          captureTitle: "Planning note",
          quote: "Contact alice@example.com.",
          note: "alice@example.com was the named owner.",
        },
      ],
      autoRedactEmails: true,
    });

    expect(result.redacted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
    expect(result.title).toBe("Follow up with [redacted]");
    expect(result.evidence[0].quote).toBe("Contact [redacted].");
  });

  it("creates a proposal for company-tier knowledge below the auto-publish confidence gate", async () => {
    seedSource();
    seedCapture();

    const result = await writeKnowledgeRecord({
      title: "Beta date",
      body: "The team decided to ship the beta on May 20.",
      summary: "Beta ships May 20.",
      evidence: [
        {
          captureId: "capture-1",
          quote: "Decision: ship the beta on May 20.",
        },
      ],
      confidence: 80,
      publishTier: "company",
      proposalMode: "auto",
    });

    expect(result.mode).toBe("proposal");
    expect(mocks.rows.proposals).toHaveLength(1);
    expect(mocks.rows.knowledge).toHaveLength(0);
    expect(mocks.rows.proposals[0]).toMatchObject({
      status: "pending",
      proposedAction: "create",
      title: "Beta date",
    });
  });

  it("auto-publishes high-confidence company-tier knowledge when no redaction is needed", async () => {
    seedSource();
    seedCapture({
      content: "Decision: ship the beta on May 20.",
    });

    const result = await writeKnowledgeRecord({
      title: "Beta date",
      body: "The team decided to ship the beta on May 20.",
      summary: "Beta ships May 20.",
      evidence: [
        {
          captureId: "capture-1",
          quote: "Decision: ship the beta on May 20.",
        },
      ],
      confidence: 95,
      publishTier: "company",
      proposalMode: "auto",
    });

    expect(result.mode).toBe("knowledge");
    expect(mocks.rows.proposals).toHaveLength(0);
    expect(result.knowledge).toMatchObject({
      status: "published",
      publishTier: "company",
      visibility: "org",
      confidence: 95,
    });
    expect(result.knowledge.publishedAt).toEqual(expect.any(String));
  });

  it("keeps auto-redacted knowledge out of the published state even with high confidence", async () => {
    seedSource();
    seedCapture({
      content: "Contact alice@example.com before publishing the launch plan.",
    });

    const result = await writeKnowledgeRecord({
      title: "Launch contact alice@example.com",
      body: "Contact alice@example.com before publishing the launch plan.",
      summary: "alice@example.com owns launch contact.",
      evidence: [
        {
          captureId: "capture-1",
          quote: "Contact alice@example.com before publishing the launch plan.",
          note: "Owner was alice@example.com.",
        },
      ],
      confidence: 95,
      publishTier: "company",
      proposalMode: "never",
    });

    expect(result.mode).toBe("knowledge");
    expect(result.knowledge.status).toBe("redacted");
    expect(JSON.stringify(result.knowledge)).not.toContain("alice@example.com");
    expect(result.knowledge.publishedAt).toBeNull();
  });
});

describe("Brain connector smoke coverage", () => {
  it("structurally identifies Slack DMs and MPIMs as excluded conversations", () => {
    expect(isSlackDirectConversation({ id: "D123", is_im: true })).toBe(true);
    expect(isSlackDirectConversation({ id: "G123", is_mpim: true })).toBe(true);
    expect(
      isSlackDirectConversation({
        id: "C123",
        name: "product",
        is_channel: true,
      }),
    ).toBe(false);
    expect(
      isSlackDirectConversation({
        id: "G456",
        name: "private-product",
        is_group: true,
      }),
    ).toBe(false);
  });

  it("normalizes a Granola API note into a transcript capture shape", () => {
    const capture = normalizeGranolaNote({
      id: "not_123",
      title: "Pricing council",
      created_at: "2026-05-14T10:00:00Z",
      updated_at: "2026-05-14T11:00:00Z",
      web_url: "https://notes.granola.ai/d/pricing",
      summary_markdown: "## Decision\nKeep annual plans.",
      attendees: [{ name: "Ada", email: "ada@example.com" }],
      calendar_event: {
        event_title: "Pricing council",
        scheduled_start_time: "2026-05-14T10:00:00Z",
      },
      transcript: [
        {
          speaker: { source: "microphone" },
          text: "We should keep annual plans because procurement expects them.",
          start_time: "2026-05-14T10:05:00Z",
        },
      ],
    });

    expect(capture).toMatchObject({
      externalId: "granola:not_123",
      title: "Pricing council",
      capturedAt: "2026-05-14T10:00:00Z",
      sourceUrl: "https://notes.granola.ai/d/pricing",
      metadata: {
        provider: "granola",
        granolaNoteId: "not_123",
        sourceUrl: "https://notes.granola.ai/d/pricing",
      },
    });
    expect(capture.content).toContain("Keep annual plans.");
    expect(capture.content).toContain(
      "We should keep annual plans because procurement expects them.",
    );
  });

  it("syncs only an allow-listed Slack channel and stores a permalink citation", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/conversations.info")) {
        return Response.json({
          ok: true,
          channel: {
            id: "C123",
            name: "product",
            is_channel: true,
            is_archived: false,
          },
        });
      }
      if (url.pathname.endsWith("/conversations.history")) {
        return Response.json({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U123",
              text: "Decision: keep annual plans.",
              ts: "1770919200.000100",
            },
          ],
          has_more: false,
        });
      }
      if (url.pathname.endsWith("/chat.getPermalink")) {
        return Response.json({
          ok: true,
          permalink:
            "https://example.slack.com/archives/C123/p1770919200000100",
        });
      }
      return Response.json({ ok: false, error: "unexpected_method" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "slack-source",
      title: "Slack product",
      provider: "slack",
      configJson: JSON.stringify({ channelIds: ["C123"] }),
    });

    const result = await runConnectorSync(source as never);

    expect(result).toMatchObject({
      provider: "slack",
      status: "success",
      capturesCreated: 1,
    });
    expect(result.captures[0]).toMatchObject({
      sourceId: "slack-source",
      externalId: "slack:C123:1770919200.000100",
      kind: "message",
      metadata: {
        provider: "slack",
        channelId: "C123",
        channelName: "product",
        sourceUrl: "https://example.slack.com/archives/C123/p1770919200000100",
      },
    });
    expect(result.captures[0].content).toContain(
      "Decision: keep annual plans.",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects configured Slack MPIMs before reading history", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/conversations.info")) {
        return Response.json({
          ok: true,
          channel: {
            id: "G123",
            name: "private-group-dm",
            is_mpim: true,
          },
        });
      }
      return Response.json({ ok: false, error: "should_not_scan" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "slack-source",
      title: "Slack DM",
      provider: "slack",
      configJson: JSON.stringify({ channelIds: ["G123"] }),
    });

    const result = await runConnectorSync(source as never);

    expect(result).toMatchObject({
      provider: "slack",
      status: "success",
      capturesCreated: 0,
      stats: { rejectedChannels: 1 },
    });
    expect(mocks.rows.captures).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes configured Granola notes into note captures with connector metadata", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "granola-source",
      title: "Granola",
      provider: "granola",
      configJson: JSON.stringify({
        transcripts: [
          {
            externalId: "granola-note-1",
            title: "Weekly design review",
            text: "Decision: keep keyboard-first capture.",
            kind: "note",
            capturedAt: "2026-05-12T10:00:00.000Z",
            metadata: { sourceUrl: "https://granola.example/notes/1" },
          },
        ],
      }),
    });

    const result = await runConnectorSync(source as never);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "granola",
      status: "success",
      capturesCreated: 1,
    });
    expect(result.captures[0]).toMatchObject({
      sourceId: "granola-source",
      externalId: "granola-note-1",
      title: "Weekly design review",
      kind: "note",
      content: "Decision: keep keyboard-first capture.",
      capturedAt: "2026-05-12T10:00:00.000Z",
      metadata: {
        connector: "granola",
        sourceUrl: "https://granola.example/notes/1",
        syncRunId: expect.any(String),
      },
    });
  });
});
