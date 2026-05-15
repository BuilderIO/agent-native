import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "eq"; col: Column; val: unknown }
  | { op: "inArray"; col: Column; vals: unknown[] }
  | { op: "isNull"; col: Column }
  | { op: "lte"; col: Column; val: unknown }
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
      "sourceKey",
      "ingestTokenHash",
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
    brainIngestQueue: table("brainIngestQueue", [
      "id",
      "sourceId",
      "captureId",
      "operation",
      "status",
      "priority",
      "attempts",
      "payloadJson",
      "error",
      "runAfter",
      "createdAt",
      "updatedAt",
    ]),
  };

  const rows = {
    sources: [] as Row[],
    captures: [] as Row[],
    knowledge: [] as Row[],
    proposals: [] as Row[],
    syncRuns: [] as Row[],
    ingestQueue: [] as Row[],
  };

  const insertControls = {
    error: null as Error | null,
    beforeThrow: null as ((tableRef: Row, row: Row) => void) | null,
  };

  const tableRows = (tableRef: Row) => {
    if (tableRef === schema.brainSources) return rows.sources;
    if (tableRef === schema.brainRawCaptures) return rows.captures;
    if (tableRef === schema.brainKnowledge) return rows.knowledge;
    if (tableRef === schema.brainProposals) return rows.proposals;
    if (tableRef === schema.brainSyncRuns) return rows.syncRuns;
    if (tableRef === schema.brainIngestQueue) return rows.ingestQueue;
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
    if (condition.op === "inArray") {
      return condition.vals.includes(row[condition.col.name]);
    }
    if (condition.op === "lte") {
      const value = row[condition.col.name];
      return typeof value === "string" && typeof condition.val === "string"
        ? value <= condition.val
        : Number(value) <= Number(condition.val);
    }
    if (condition.op === "like") return true;
    return row[condition.col.name] === condition.val;
  };

  const select = vi.fn(() => ({
    from: vi.fn((tableRef: Row) => ({
      where: vi.fn((condition: Condition) => {
        const filteredRows = async () =>
          tableRows(tableRef).filter((row) => matches(row, condition));
        return {
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
          then: (
            onFulfilled: (rows: Row[]) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => filteredRows().then(onFulfilled, onRejected),
        };
      }),
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
      if (insertControls.error) {
        const error = insertControls.error;
        insertControls.error = null;
        insertControls.beforeThrow?.(tableRef, row);
        insertControls.beforeThrow = null;
        throw error;
      }
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
    insertControls,
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
  asc: (column: Column) => ({ op: "asc", column }),
  desc: (column: Column) => ({ op: "desc", column }),
  eq: (col: Column, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: Column, vals: unknown[]) => ({ op: "inArray", col, vals }),
  isNull: (col: Column) => ({ op: "isNull", col }),
  like: (col: Column, val: unknown) => ({ op: "like", col, val }),
  lte: (col: Column, val: unknown) => ({ op: "lte", col, val }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestOrgId: () => mocks.orgId,
  runWithRequestContext: async (_context: Row, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: () => ({
    userEmail: mocks.userEmail,
    orgId: mocks.orgId,
  }),
  readBody: vi.fn(async (event: { body?: unknown }) => event.body),
}));

vi.mock("h3", () => ({
  createError: (input: { statusCode: number; statusMessage?: string }) =>
    Object.assign(new Error(input.statusMessage), input),
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (event: { headers?: Record<string, string> }, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
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

import getCaptureAction from "../../actions/get-capture.js";
import listCapturesAction from "../../actions/list-captures.js";
import {
  applyRedactions,
  createCapture,
  serializeSource,
  sha256Hex,
  validateEvidence,
  writeKnowledgeRecord,
} from "./brain.js";
import {
  isSlackDirectConversation,
  normalizeGranolaNote,
  runConnectorSync,
  runSlackPilot,
  testSlackConnection,
} from "./connectors.js";
import { runBrainDemoEval } from "./demo.js";
import { processBrainIngestQueueOnce } from "../../jobs/process-ingest-queue.js";
import ingestHandler from "../routes/api/_agent-native/brain/ingest.post.js";

function resetMocks() {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  for (const values of Object.values(mocks.rows)) values.length = 0;
  mocks.resourceWrites.length = 0;
  mocks.insertControls.error = null;
  mocks.insertControls.beforeThrow = null;
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
    sourceKey: null,
    ingestTokenHash: null,
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
      tags: ["launch", "alice@example.com"],
      entities: [{ type: "person", name: "alice@example.com" }],
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
    expect(result.tags).toEqual(["launch", "[redacted]"]);
    expect(result.entities).toEqual([{ type: "person", name: "[redacted]" }]);
    expect(result.evidence[0].quote).toBe("Contact [redacted].");
  });

  it("validates evidence with a canonical sourceUrl citation", async () => {
    seedSource();
    seedCapture({
      metadataJson: JSON.stringify({
        sourceUrl: "https://example.test/captures/1",
      }),
    });

    const evidence = await validateEvidence([
      {
        captureId: "capture-1",
        quote: "Decision: ship the beta on May 20.",
      },
    ]);

    expect(evidence[0]).toMatchObject({
      sourceUrl: "https://example.test/captures/1",
    });
    expect(evidence[0]).not.toHaveProperty("url");
  });

  it("serializes sources without signed ingest secrets", () => {
    const source = seedSource({
      configJson: JSON.stringify({
        sourceKey: "clips",
        ingestTokenHash: "secret-hash",
        reviewRequired: true,
      }),
    });

    expect(serializeSource(source as never).config).toEqual({
      reviewRequired: true,
    });
  });

  it("lists captures with redacted review previews", async () => {
    seedSource({
      title: "Slack source alice@example.com",
    });
    seedCapture({
      externalId: "thread-alice@example.com",
      title: "Launch note from alice@example.com",
      content:
        "Ask <mailto:alice@example.com|Alice> or call +1 415 555 1212 by 2026-05-15. Link https://example.test/users/4155551212",
      metadataJson: JSON.stringify({
        sourceUrl: "https://example.test/users/4155551212",
      }),
    });
    mocks.rows.ingestQueue.push({
      id: "queue-1",
      sourceId: "source-1",
      captureId: "capture-1",
      operation: "distill",
      status: "queued",
      priority: 50,
      attempts: 0,
      payloadJson: "{}",
      error: "Failed for alice@example.com",
      runAfter: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    });

    const result = await listCapturesAction.run({
      sourceId: "source-1",
      includePreview: true,
      previewLength: 220,
    });

    expect(result.captures[0]).toMatchObject({
      externalId: "[redacted]",
      title: "Launch note from [redacted]",
      source: {
        title: "Slack source [redacted]",
      },
      sourceUrl: "https://example.test/users/4155551212",
      preview:
        "Ask [redacted] or call [redacted] by 2026-05-15. Link https://example.test/users/4155551212",
      distillationQueue: {
        error: "Failed for [redacted]",
      },
    });
  });

  it("redacts get-capture by default and keeps explicit raw access for distillation", async () => {
    seedSource({
      title: "Slack source alice@example.com",
    });
    seedCapture({
      externalId: "thread-alice@example.com",
      title: "Launch note from alice@example.com",
      content:
        "Ask <mailto:alice@example.com|Alice> or call +1 415 555 1212 by 2026-05-15. Link https://example.test/users/4155551212",
      metadataJson: JSON.stringify({
        requester: "alice@example.com",
        attendees: [{ email: "bob@example.com" }],
        sourceUrl: "https://example.test/users/4155551212",
      }),
    });

    const redacted = await getCaptureAction.run({ id: "capture-1" });

    expect(redacted.capture).toMatchObject({
      externalId: "[redacted]",
      title: "Launch note from [redacted]",
      content:
        "Ask [redacted] or call [redacted] by 2026-05-15. Link https://example.test/users/4155551212",
      contentRedacted: true,
      rawContentIncluded: false,
      metadata: {
        requester: "[redacted]",
        attendees: [{ email: "[redacted]" }],
        sourceUrl: "https://example.test/users/4155551212",
      },
      importedBy: "[redacted]",
    });
    expect(redacted.source.title).toBe("Slack source [redacted]");

    const raw = await getCaptureAction.run({
      id: "capture-1",
      includeRawContent: true,
    });

    expect(raw.capture).toMatchObject({
      externalId: "thread-alice@example.com",
      title: "Launch note from alice@example.com",
      content:
        "Ask <mailto:alice@example.com|Alice> or call +1 415 555 1212 by 2026-05-15. Link https://example.test/users/4155551212",
      contentRedacted: false,
      rawContentIncluded: true,
      metadata: {
        requester: "alice@example.com",
        attendees: [{ email: "bob@example.com" }],
      },
      importedBy: "owner@example.test",
    });
    expect(raw.source.title).toBe("Slack source alice@example.com");
  });

  it("requires signed ingest payload sourceKey to match the source config", async () => {
    const tokenHash = await sha256Hex("ingest-token");
    seedSource({
      id: "wrong-source-key",
      configJson: JSON.stringify({
        sourceKey: "other",
        ingestTokenHash: tokenHash,
      }),
    });

    const handler = ingestHandler as unknown as (event: Row) => Promise<Row>;
    await expect(
      handler({
        headers: { authorization: "Bearer ingest-token" },
        body: {
          sourceKey: "clips",
          externalId: "clip-1",
          title: "Clip",
          transcript: "Decision: ship the beta on May 20.",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    seedSource({
      id: "clips-source",
      sourceKey: "clips",
      ingestTokenHash: tokenHash,
      configJson: JSON.stringify({
        sourceKey: "clips",
        ingestTokenHash: tokenHash,
      }),
    });

    const result = await handler({
      headers: { authorization: "Bearer ingest-token" },
      body: {
        sourceKey: "clips",
        externalId: "clip-1",
        title: "Clip",
        transcript: "Decision: ship the beta on May 20.",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      sourceId: "clips-source",
    });
    expect(mocks.rows.captures[0]).toMatchObject({
      sourceId: "clips-source",
      externalId: "clip-1",
    });
  });

  it("uses a SHA-256 content hash for new captures", async () => {
    seedSource();

    const capture = await createCapture({
      sourceId: "source-1",
      externalId: "capture-ext-1",
      title: "Planning note",
      kind: "note",
      content: "Decision: ship the beta on May 20.",
    });

    expect(capture.contentHash).toBe(
      await sha256Hex("Decision: ship the beta on May 20."),
    );
    expect(String(capture.contentHash)).toHaveLength(64);
  });

  it("returns the raced-in capture when source/external unique insert conflicts", async () => {
    seedSource();
    mocks.insertControls.error = new Error(
      "UNIQUE constraint failed: brain_raw_captures.source_id, brain_raw_captures.external_id",
    );
    mocks.insertControls.beforeThrow = (_tableRef, row) => {
      mocks.rows.captures.push({ ...row, id: "capture-from-race" });
    };

    const capture = await createCapture({
      sourceId: "source-1",
      externalId: "external-1",
      title: "Planning note",
      kind: "note",
      content: "Decision: ship the beta on May 20.",
    });

    expect(capture.id).toBe("capture-from-race");
    expect(mocks.rows.captures).toHaveLength(1);
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

  it("keeps distillation queue items queued when no distillation worker completed them", async () => {
    const now = "2026-05-15T12:00:00.000Z";
    mocks.rows.ingestQueue.push({
      id: "queue-1",
      sourceId: "source-1",
      captureId: "capture-1",
      operation: "distill",
      status: "queued",
      priority: 50,
      attempts: 0,
      payloadJson: "{}",
      error: null,
      runAfter: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await processBrainIngestQueueOnce({ limit: 1 });

    expect(result).toMatchObject({
      processed: [],
      deferred: ["queue-1"],
      failed: [],
    });
    expect(mocks.rows.ingestQueue[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      error:
        "Distillation is still queued; no distillation worker completed this item.",
    });
    expect(typeof mocks.rows.ingestQueue[0].runAfter).toBe("string");
  });

  it("runs headless distillation and treats mark-capture completion as processed", async () => {
    const now = "2026-05-15T12:00:00.000Z";
    const source = seedSource();
    const capture = seedCapture({ status: "distilling" });
    mocks.rows.ingestQueue.push({
      id: "queue-1",
      sourceId: source.id,
      captureId: capture.id,
      operation: "distill",
      status: "queued",
      priority: 50,
      attempts: 0,
      payloadJson: JSON.stringify({ instructions: "Prefer decisions." }),
      error: "waiting",
      runAfter: null,
      createdAt: now,
      updatedAt: now,
    });

    const seen: Row[] = [];
    const result = await processBrainIngestQueueOnce({
      limit: 1,
      runDistillation: true,
      distillationRunner: async (context) => {
        seen.push({
          queueId: context.queue.id,
          captureId: context.capture.id,
          sourceId: context.source.id,
          instructions: context.payload.instructions,
        });
        Object.assign(mocks.rows.ingestQueue[0], {
          status: "done",
          error: null,
          updatedAt: "2026-05-15T12:01:00.000Z",
        });
      },
    });

    expect(result).toMatchObject({
      processed: ["queue-1"],
      deferred: [],
      failed: [],
    });
    expect(seen).toEqual([
      {
        queueId: "queue-1",
        captureId: "capture-1",
        sourceId: "source-1",
        instructions: "Prefer decisions.",
      },
    ]);
    expect(mocks.rows.ingestQueue[0]).toMatchObject({
      status: "done",
      attempts: 1,
      error: null,
    });
  });

  it("requeues headless distillation when the agent does not close the capture", async () => {
    const now = "2026-05-15T12:00:00.000Z";
    const source = seedSource();
    const capture = seedCapture({ status: "distilling" });
    mocks.rows.ingestQueue.push({
      id: "queue-1",
      sourceId: source.id,
      captureId: capture.id,
      operation: "distill",
      status: "queued",
      priority: 50,
      attempts: 0,
      payloadJson: "{}",
      error: null,
      runAfter: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await processBrainIngestQueueOnce({
      limit: 1,
      runDistillation: true,
      distillationRunner: async () => {},
    });

    expect(result).toMatchObject({
      processed: [],
      deferred: ["queue-1"],
      failed: [],
    });
    expect(mocks.rows.ingestQueue[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      error:
        "Headless distillation agent did not mark this capture distilled or ignored.",
    });
    expect(typeof mocks.rows.ingestQueue[0].runAfter).toBe("string");
  });
});

describe("Brain connector smoke coverage", () => {
  it("tests Slack credentials and channel metadata without reading history", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth.test")) {
        return Response.json({
          ok: true,
          team: "Acme",
          team_id: "T123",
          user: "brain-bot",
          user_id: "U123",
          url: "https://acme.slack.com/",
        });
      }
      if (url.pathname.endsWith("/conversations.info")) {
        return Response.json({
          ok: true,
          channel: {
            id: "C123",
            name: "product-decisions",
            is_channel: true,
            is_archived: false,
          },
        });
      }
      return Response.json({ ok: false, error: "should_not_call_history" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await testSlackConnection({ channelRefs: ["C123"] });

    expect(result).toMatchObject({
      ok: true,
      team: "Acme",
      checkedChannels: 1,
      historyRead: false,
      channels: [
        {
          id: "C123",
          name: "product-decisions",
          status: "ok",
        },
      ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes("conversations.history"),
      ),
    ).toBe(false);
  });

  it("runs a Slack pilot report without reading history by default", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth.test")) {
        return Response.json({
          ok: true,
          team: "Acme",
          team_id: "T123",
          user: "brain-bot",
          url: "https://acme.slack.com/",
        });
      }
      if (url.pathname.endsWith("/conversations.info")) {
        return Response.json({
          ok: true,
          channel: {
            id: "C123",
            name: "product-decisions",
            is_channel: true,
            is_archived: false,
          },
        });
      }
      return Response.json({ ok: false, error: "should_not_call_history" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "slack-source",
      title: "Slack product",
      provider: "slack",
      configJson: JSON.stringify({ channelIds: ["C123"] }),
    });

    const report = await runSlackPilot(source as never);

    expect(report).toMatchObject({
      sourceId: "slack-source",
      ok: true,
      status: "validated",
      historyRead: false,
      capturesCreated: 0,
      channelValidation: {
        requested: 1,
        ok: 1,
      },
      guardrails: {
        historyReadRequested: false,
        maxChannels: 2,
        historyLimit: 10,
        pagesPerChannel: 1,
        permalinkLimit: 10,
        autoSync: false,
      },
    });
    expect(mocks.rows.captures).toHaveLength(0);
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes("conversations.history"),
      ),
    ).toBe(false);
  });

  it("caps a Slack pilot history sync and reports captures and stats", async () => {
    const historyUrls: URL[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth.test")) {
        return Response.json({
          ok: true,
          team: "Acme",
          team_id: "T123",
          user: "brain-bot",
          url: "https://acme.slack.com/",
        });
      }
      if (url.pathname.endsWith("/conversations.info")) {
        const channel = url.searchParams.get("channel") ?? "C123";
        return Response.json({
          ok: true,
          channel: {
            id: channel,
            name: `channel-${channel.slice(1)}`,
            is_channel: true,
            is_archived: false,
          },
        });
      }
      if (url.pathname.endsWith("/conversations.history")) {
        historyUrls.push(url);
        const channel = url.searchParams.get("channel") ?? "C123";
        return Response.json({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U123",
              text: `Decision from ${channel}`,
              ts:
                channel === "C123" ? "1770919200.000100" : "1770919300.000100",
            },
          ],
          has_more: true,
          response_metadata: { next_cursor: "next-page" },
        });
      }
      if (url.pathname.endsWith("/chat.getPermalink")) {
        return Response.json({
          ok: true,
          permalink: `https://example.slack.com/archives/${url.searchParams.get(
            "channel",
          )}/p${url.searchParams.get("message_ts")}`,
        });
      }
      return Response.json({ ok: false, error: "unexpected_method" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "slack-source",
      title: "Slack product",
      provider: "slack",
      configJson: JSON.stringify({
        channelIds: ["C123", "C456", "C789"],
        historyLimit: 50,
        pagesPerChannel: 5,
        permalinkLimit: 50,
        autoSync: true,
      }),
    });

    const report = await runSlackPilot(source as never, {
      readHistory: true,
      historyLimit: 99,
      maxChannels: 9,
      permalinkLimit: 99,
      recentDays: 90,
    });

    expect(report).toMatchObject({
      sourceId: "slack-source",
      ok: true,
      status: "synced",
      historyRead: true,
      capturesCreated: 2,
      guardrails: {
        historyReadRequested: true,
        maxChannels: 2,
        historyLimit: 10,
        pagesPerChannel: 1,
        permalinkLimit: 10,
        autoSync: false,
      },
      sync: {
        status: "success",
        stats: {
          configuredChannels: 2,
          scannedChannels: 2,
          messagesSeen: 2,
          capturesCreated: 2,
        },
      },
      currentKnowledge: { total: 0 },
      proposals: { pending: 0 },
    });
    expect(report.captures).toHaveLength(2);
    expect(historyUrls).toHaveLength(2);
    expect(historyUrls.map((url) => url.searchParams.get("channel"))).toEqual([
      "C123",
      "C456",
    ]);
    expect(
      historyUrls.every((url) => url.searchParams.get("limit") === "10"),
    ).toBe(true);
    expect(historyUrls.every((url) => url.searchParams.has("oldest"))).toBe(
      true,
    );
    expect(mocks.rows.captures).toHaveLength(2);
  });

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

  it("syncs GitHub issues and pull requests from configured repositories", async () => {
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/repos/acme/brain/issues");
        expect(url.searchParams.get("state")).toBe("all");
        expect(url.searchParams.get("per_page")).toBe("2");
        return Response.json([
          {
            id: 101,
            number: 7,
            title: "Document onboarding source rules",
            body: "Decision: keep source setup bounded to approved repos.",
            html_url: "https://github.com/acme/brain/issues/7",
            state: "open",
            created_at: "2026-05-14T10:00:00Z",
            updated_at: "2026-05-14T11:00:00Z",
            user: {
              login: "ada",
              html_url: "https://github.com/ada",
            },
            labels: [{ name: "docs" }, { name: "brain" }],
          },
          {
            id: 102,
            number: 8,
            title: "Add GitHub connector proof",
            body: "Adds a small reusable connector proof for Brain.",
            html_url: "https://github.com/acme/brain/pull/8",
            state: "closed",
            created_at: "2026-05-14T12:00:00Z",
            updated_at: "2026-05-14T13:00:00Z",
            user: { login: "grace" },
            labels: ["connector"],
            pull_request: {
              html_url: "https://github.com/acme/brain/pull/8",
              merged_at: "2026-05-14T14:00:00Z",
            },
          },
        ]);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);
    const source = seedSource({
      id: "github-source",
      title: "GitHub repos",
      provider: "github",
      configJson: JSON.stringify({
        repositories: ["acme/brain"],
        state: "all",
        limit: 2,
      }),
    });

    const result = await runConnectorSync(source as never);

    expect(result).toMatchObject({
      provider: "github",
      status: "success",
      capturesCreated: 2,
      stats: {
        configuredRepositories: 1,
        scannedRepositories: 1,
        itemsSeen: 2,
        issuesSeen: 1,
        pullRequestsSeen: 1,
      },
    });
    expect(result.captures).toEqual([
      expect.objectContaining({
        sourceId: "github-source",
        externalId: "github:acme/brain:issue:7",
        kind: "note",
        metadata: expect.objectContaining({
          provider: "github",
          repository: "acme/brain",
          type: "issue",
          sourceUrl: "https://github.com/acme/brain/issues/7",
          author: "ada",
          labels: ["docs", "brain"],
        }),
      }),
      expect.objectContaining({
        sourceId: "github-source",
        externalId: "github:acme/brain:pull:8",
        kind: "document",
        metadata: expect.objectContaining({
          provider: "github",
          repository: "acme/brain",
          type: "pull_request",
          sourceUrl: "https://github.com/acme/brain/pull/8",
          author: "grace",
          labels: ["connector"],
        }),
      }),
    ]);
    expect(result.captures[0].content).toContain(
      "Decision: keep source setup bounded to approved repos.",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
        Accept: "application/vnd.github+json",
      }),
    });
  });

  it("imports GitHub PR context linked from Slack captures", async () => {
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/repos/acme/brain/issues/42") {
          return Response.json({
            id: 420,
            number: 42,
            title: "Tighten Slack-linked GitHub imports",
            body: "Adds bounded issue and pull request context for Brain.",
            html_url: "https://github.com/acme/brain/pull/42",
            state: "closed",
            created_at: "2026-05-14T09:00:00Z",
            updated_at: "2026-05-14T10:00:00Z",
            closed_at: "2026-05-14T11:00:00Z",
            user: { login: "ada" },
            labels: [{ name: "brain" }],
            pull_request: {
              html_url: "https://github.com/acme/brain/pull/42",
              merged_at: "2026-05-14T11:00:00Z",
            },
          });
        }
        if (url.pathname === "/repos/acme/brain/issues/42/comments") {
          expect(url.searchParams.get("per_page")).toBe("2");
          return Response.json([
            {
              id: 1,
              body: "This should unblock the Slack source follow-up.",
              html_url: "https://github.com/acme/brain/pull/42#issuecomment-1",
              updated_at: "2026-05-14T10:15:00Z",
              user: { login: "grace" },
            },
          ]);
        }
        if (url.pathname === "/repos/acme/brain/pulls/42") {
          return Response.json({
            html_url: "https://github.com/acme/brain/pull/42",
            merged: true,
            merged_at: "2026-05-14T11:00:00Z",
            changed_files: 3,
          });
        }
        if (url.pathname === "/repos/acme/brain/pulls/42/reviews") {
          expect(url.searchParams.get("per_page")).toBe("2");
          return Response.json([
            {
              id: 2,
              state: "APPROVED",
              body: "Looks good with the bounded fetches.",
              html_url:
                "https://github.com/acme/brain/pull/42#pullrequestreview-2",
              submitted_at: "2026-05-14T10:45:00Z",
              user: { login: "linus" },
            },
          ]);
        }
        throw new Error(`Unexpected GitHub URL ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);
    seedSource({
      id: "slack-source",
      title: "Slack product channel",
      provider: "slack",
    });
    seedCapture({
      id: "slack-capture",
      sourceId: "slack-source",
      title: "#product message 2026-05-14",
      kind: "message",
      content:
        "We should bring in https://github.com/acme/brain/pull/42 before the review.",
      metadataJson: JSON.stringify({
        provider: "slack",
        sourceUrl: "https://example.slack.com/archives/C123/p1",
      }),
    });
    const source = seedSource({
      id: "github-source",
      title: "GitHub from Slack",
      provider: "github",
      configJson: JSON.stringify({
        linkedSlackSourceIds: ["slack-source"],
        linkedCaptureLimit: 10,
        linkedRefLimit: 5,
        linkedDetailLimit: 5,
        commentLimit: 2,
        reviewLimit: 2,
      }),
    });

    const result = await runConnectorSync(source as never);

    expect(result).toMatchObject({
      provider: "github",
      status: "success",
      capturesCreated: 1,
      stats: {
        linkedSourceIds: 1,
        linkedCapturesScanned: 1,
        linkedRefsFound: 1,
        linkedRefsImported: 1,
        detailsFetched: 1,
        commentsFetched: 1,
        reviewsFetched: 1,
      },
    });
    expect(result.captures[0]).toMatchObject({
      externalId: "github:acme/brain:pull:42",
      title: "Tighten Slack-linked GitHub imports",
      metadata: expect.objectContaining({
        provider: "github",
        repository: "acme/brain",
        type: "pull_request",
        merged: true,
        mergedAt: "2026-05-14T11:00:00Z",
        bodyExcerpt: "Adds bounded issue and pull request context for Brain.",
        linkedFrom: expect.objectContaining({
          sourceId: "slack-source",
          captureId: "slack-capture",
          sourceUrl: "https://example.slack.com/archives/C123/p1",
        }),
        comments: [
          expect.objectContaining({
            author: "grace",
            bodyExcerpt: "This should unblock the Slack source follow-up.",
          }),
        ],
        reviews: [
          expect.objectContaining({
            author: "linus",
            state: "APPROVED",
            bodyExcerpt: "Looks good with the bounded fetches.",
          }),
        ],
      }),
    });
    expect(result.captures[0].content).toContain("Merged: yes");
    expect(result.captures[0].content).toContain("Comment summary");
    expect(result.captures[0].content).toContain("Review summary");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("records GitHub rate limits as retryable connector state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 120),
            },
          },
        ),
      ),
    );
    const source = seedSource({
      id: "github-source",
      title: "GitHub repos",
      provider: "github",
      configJson: JSON.stringify({ repos: ["acme/brain"], limit: 1 }),
    });

    const result = await runConnectorSync(source as never);

    expect(result).toMatchObject({
      provider: "github",
      status: "success",
      capturesCreated: 0,
      stats: { rateLimited: true },
    });
    const updatedSource = mocks.rows.sources.find(
      (row) => row.id === "github-source",
    );
    expect(updatedSource?.status).toBe("active");
    expect(updatedSource?.lastError).toContain(
      "github rate limited /repos/acme/brain/issues",
    );
    expect(JSON.parse(String(updatedSource?.cursorJson))).toMatchObject({
      retry: {
        provider: "github",
        endpoint: "/repos/acme/brain/issues",
      },
    });
  });
});

describe("Brain demo eval", () => {
  it("seeds the product-decision demo corpus and passes the trust checks", async () => {
    const result = await runBrainDemoEval({ publishCanonical: false });

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(result.total);
    expect(result.checks.map((item) => item.id)).toEqual([
      "freemium-recall",
      "supersede-chain",
      "how-it-works-recall",
      "proposal-gate",
      "pii-redaction",
      "personal-exclusion",
    ]);
    expect(mocks.rows.sources).toHaveLength(4);
    expect(mocks.rows.proposals).toHaveLength(1);
    expect(mocks.rows.knowledge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Freemium signup retired for enterprise-led growth",
          status: "published",
        }),
        expect.objectContaining({
          title: "Freemium signup was the default acquisition path",
          status: "archived",
        }),
        expect.objectContaining({
          title:
            "Escalation owner notes are redacted when personal data appears",
          status: "redacted",
        }),
      ]),
    );
    expect(JSON.stringify(mocks.rows.knowledge)).not.toContain(
      "ava.cho@example.com",
    );
    expect(mocks.rows.captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "brain-product-decisions-demo-v1:slack:personal-aside",
          status: "ignored",
        }),
      ]),
    );
  });
});
