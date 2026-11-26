import { beforeEach, describe, expect, it, vi } from "vitest";

import "./intelligence.js";
import {
  createJoinedQuery,
  fixtureColumnValue,
} from "../../test-utils/joined-query.js";

const testString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URLSearchParams
      ? value.toString()
      : (JSON.stringify(value) ?? "");

type Condition =
  | { op: "access" }
  | { op: "never" }
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "eq" | "ne" | "lowerEq"; col: Column; val: unknown }
  | { op: "inArray"; col: Column; vals: unknown[] }
  | { op: "like"; col: Column; val: unknown }
  | { op: "captureSourceAccessible" };

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
      "sensitivityDisposition",
      "sensitivityPolicyVersion",
      "audienceAclHash",
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
      "provenanceJson",
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
    brainCaptureAudiences: table("brainCaptureAudiences", [
      "id",
      "captureId",
      "audienceId",
      "aclHash",
    ]),
  };

  const rows = {
    sources: [] as Row[],
    captures: [] as Row[],
    knowledge: [] as Row[],
    audiences: [] as Row[],
  };

  const tableRows = (tableRef: Row) => {
    if (tableRef === schema.brainSources) return rows.sources;
    if (tableRef === schema.brainRawCaptures) return rows.captures;
    if (tableRef === schema.brainKnowledge) return rows.knowledge;
    if (tableRef === schema.brainCaptureAudiences) return rows.audiences;
    return [];
  };

  function likeNeedle(value: unknown) {
    return testString(value ?? "")
      .replace(/^%|%$/g, "")
      .replace(/\\([\\%_])/g, "$1")
      .toLowerCase();
  }

  const matches = (row: Row, condition?: Condition): boolean => {
    if (!condition) return true;
    if (condition.op === "access") return true;
    if (condition.op === "never") return false;
    if (condition.op === "captureSourceAccessible") {
      return rows.sources.some((source) => source.id === row.sourceId);
    }
    if (condition.op === "and") {
      return condition.conditions.every((item) => matches(row, item));
    }
    if (condition.op === "or") {
      return condition.conditions.some((item) => matches(row, item));
    }
    if (condition.op === "eq") {
      const value = condition.val;
      return (
        fixtureColumnValue(row, condition.col) ===
        (value &&
        typeof value === "object" &&
        "table" in value &&
        "name" in value
          ? fixtureColumnValue(row, value as Column)
          : value)
      );
    }
    if (condition.op === "ne")
      return fixtureColumnValue(row, condition.col) !== condition.val;
    if (condition.op === "lowerEq")
      return (
        testString(fixtureColumnValue(row, condition.col)).toLowerCase() ===
        testString(condition.val).toLowerCase()
      );
    if (condition.op === "inArray") {
      return condition.vals.includes(fixtureColumnValue(row, condition.col));
    }
    if (condition.op === "like") {
      const value = testString(row[condition.col.name] ?? "").toLowerCase();
      return value.includes(likeNeedle(condition.val));
    }
    return false;
  };

  const applyOrder = (items: Row[], order?: { column?: Column }) => {
    if (!order?.column) return items;
    return [...items].sort((a, b) =>
      testString(b[order.column!.name] ?? "").localeCompare(
        testString(a[order.column!.name] ?? ""),
      ),
    );
  };

  const from = (tableRef: Row) => ({
    where: (condition: Condition) => {
      const filteredRows = async () =>
        tableRows(tableRef)
          .filter((row) => matches(row, condition))
          .slice();
      return {
        orderBy: (order?: { column?: Column }) => ({
          limit: async (limit: number) =>
            applyOrder(await filteredRows(), order).slice(0, limit),
        }),
        limit: async (limit: number) => (await filteredRows()).slice(0, limit),
        then: (
          onFulfilled: (rows: Row[]) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => filteredRows().then(onFulfilled, onRejected),
      };
    },
    orderBy: (order?: { column?: Column }) => ({
      limit: async (limit: number) =>
        applyOrder(tableRows(tableRef), order).slice(0, limit),
    }),
    limit: async (limit: number) => tableRows(tableRef).slice(0, limit),
  });

  return {
    schema,
    rows,
    listWorkspaceConnectionProviderCatalogForApp: vi.fn(),
    discoverAgents: vi.fn(),
    hybridSearchArtifacts: vi.fn(),
    db: {
      select: vi.fn(() => ({ from })),
      selectDistinct: vi.fn((selection: Record<string, Column>) => ({
        from: (tableRef: Row) =>
          createJoinedQuery(selection, tableRef, tableRows, matches),
      })),
    },
  };
});

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ op: "access" }),
}));

vi.mock("./audiences.js", () => ({
  listAccessibleAudienceIds: vi.fn(async () => ["aud_org"]),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionProviderCatalogForApp:
    mocks.listWorkspaceConnectionProviderCatalogForApp,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("./hybrid-search.js", () => ({
  hybridSearchArtifacts: mocks.hybridSearchArtifacts,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  desc: (column: Column) => ({ column }),
  eq: (col: Column, val: unknown) => ({ op: "eq", col, val }),
  ne: (col: Column, val: unknown) => ({ op: "ne", col, val }),
  inArray: (col: Column, vals: unknown[]) => ({ op: "inArray", col, vals }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("${}");
    if (text === "false") return { op: "never" };
    if (text.startsWith("lower(") && text.includes(" = "))
      return { op: "lowerEq", col: values[0], val: values[1] };
    if (text.startsWith("lower(")) {
      return { op: "like", col: values[0] as Column, val: values[1] };
    }
    if (text.includes("exists")) return { op: "captureSourceAccessible" };
    return { op: "access" };
  },
}));

import { bindFixtureProvenance } from "../../test-utils/knowledge-provenance.js";
import { publicCaptureTitle } from "./capture-sanitization.js";
import {
  parseCaptureMetadata,
  publicCaptureExternalId,
  publicCaptureMetadata,
  withheldPassageCount,
  withOmissionReceipt,
} from "./search-index-contracts.js";
import {
  buildFederatedSearchCoverage,
  buildSnippet,
  citationEvidenceMatchesCapture,
  escapeLikeTerm,
  normalizeSearchTerms,
  redactSensitiveText,
  scoreSearchText,
  searchEverythingRows,
  searchEverythingWithLanes,
  sourceUrlFromMetadata,
} from "./search.js";

const OK_LANES = {
  fts: { status: "ok" as const },
  semantic: { status: "ok" as const },
};

async function resetRows() {
  for (const values of Object.values(mocks.rows)) values.length = 0;
  mocks.hybridSearchArtifacts.mockReset();
  mocks.hybridSearchArtifacts.mockResolvedValue({
    results: [],
    lanes: OK_LANES,
  });
  mocks.listWorkspaceConnectionProviderCatalogForApp.mockResolvedValue({
    providers: [
      {
        id: "slack",
        label: "Slack",
        capabilities: ["messages"],
        readiness: { status: "ready" },
        workspaceConnection: {
          grantState: "granted",
          hasActiveWorkspaceConnection: true,
          activeConnectionCount: 1,
          grantedConnectionCount: 1,
        },
      },
      {
        id: "google",
        label: "Google Workspace",
        capabilities: ["mail", "calendar", "drive"],
        readiness: { status: "needs_grant" },
        workspaceConnection: {
          grantState: "needs_grant",
          hasActiveWorkspaceConnection: true,
          activeConnectionCount: 1,
          grantedConnectionCount: 0,
        },
      },
    ],
  });
  mocks.discoverAgents.mockResolvedValue([
    {
      id: "analytics",
      name: "Analytics",
      description: "Dashboards and data analysis",
      url: "https://analytics.example.test",
      color: "#123456",
    },
    {
      id: "mail",
      name: "Mail",
      description: "Mailbox and Gmail search",
      url: "https://mail.example.test",
      color: "#654321",
    },
  ]);
  const now = "2026-05-15T12:00:00.000Z";
  mocks.rows.sources.push(
    {
      id: "source-slack",
      title: "Demo Slack #product-decisions",
      provider: "slack",
      status: "active",
      sourceKey: null,
      ingestTokenHash: null,
      configJson: "{}",
      cursorJson: "{}",
      lastSyncedAt: null,
      lastError: null,
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "org",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "source-generic",
      title: "Demo Transcript Webhook",
      provider: "generic",
      status: "active",
      sourceKey: null,
      ingestTokenHash: null,
      configJson: "{}",
      cursorJson: "{}",
      lastSyncedAt: null,
      lastError: null,
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "org",
      createdAt: now,
      updatedAt: now,
    },
  );
  mocks.rows.captures.push(
    {
      id: "capture-freemium-current",
      sourceId: "source-slack",
      externalId: "slack:freemium-current",
      title: "#product-decisions freemium retirement thread",
      kind: "message",
      content:
        "Decision: retire the self-serve freemium path because trial activation stayed under 6% and support load blocked enterprise onboarding.",
      contentHash: "hash-current",
      metadataJson: JSON.stringify({
        sourceUrl:
          "https://slack.example.com/archives/CDEMO_PRODUCT/p1777657200000100",
      }),
      capturedAt: now,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "capture-retention-open-question",
      sourceId: "source-generic",
      externalId: "generic:retention-open-question",
      title: "Transcript retention policy import",
      kind: "generic",
      content:
        "Open question: Legal has not confirmed retention settings for meeting transcripts beyond 180 days.",
      contentHash: "hash-retention",
      metadataJson: JSON.stringify({
        sourceUrl: "https://legal.example.com/imports/transcript-retention",
      }),
      capturedAt: now,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "capture-redaction",
      sourceId: "source-generic",
      externalId: "generic:redaction",
      title: "Support escalation owner note",
      kind: "note",
      content:
        "The escalation owner is ava.cho@example.com and phone +1 415 555 1212 until support automation ships.",
      contentHash: "hash-redaction",
      metadataJson: JSON.stringify({
        sourceUrl: "https://support.example.com/escalations/owner-note",
      }),
      capturedAt: now,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: now,
      createdAt: now,
      updatedAt: now,
    },
  );
  mocks.rows.knowledge.push(
    {
      id: "knowledge-freemium-old",
      sourceId: "source-generic",
      captureId: "capture-freemium-old",
      kind: "decision",
      title: "Freemium signup was the default acquisition path",
      body: "The previous acquisition assumption kept freemium as the default path until onboarding conversion data justified a change.",
      summary:
        "Freemium was the default acquisition path before the May decision.",
      topic: "Growth",
      tagsJson: JSON.stringify(["freemium", "growth", "superseded"]),
      entitiesJson: "[]",
      evidenceJson: "[]",
      publishedResourcePath: null,
      supersedesId: null,
      supersededById: "knowledge-freemium-current",
      confidence: 94,
      status: "archived",
      publishTier: "company",
      createdBy: "owner@example.test",
      publishedAt: "2026-03-28T09:00:00.000Z",
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "org",
      createdAt: now,
      updatedAt: "2026-03-28T09:00:00.000Z",
    },
    {
      id: "knowledge-freemium-current",
      sourceId: "source-slack",
      captureId: "capture-freemium-current",
      kind: "decision",
      title: "Freemium signup retired for enterprise-led growth",
      body: "The team retired the self-serve freemium path because activation stayed under 6% while support load blocked enterprise onboarding. The new motion emphasizes sales-led pilots with named implementation owners.",
      summary:
        "The self-serve freemium path was retired because low activation and support load hurt enterprise onboarding.",
      topic: "Growth",
      tagsJson: JSON.stringify(["freemium", "enterprise"]),
      entitiesJson: JSON.stringify([{ type: "person", name: "Nick Nestle" }]),
      evidenceJson: JSON.stringify([
        {
          captureId: "capture-freemium-current",
          captureTitle: "#product-decisions freemium retirement thread",
          quote:
            "Decision: retire the self-serve freemium path because trial activation stayed under 6% and support load blocked enterprise onboarding.",
          sourceUrl:
            "https://slack.example.com/archives/CDEMO_PRODUCT/p1777657200000100",
        },
      ]),
      publishedResourcePath: null,
      supersedesId: "knowledge-freemium-old",
      supersededById: null,
      confidence: 96,
      status: "published",
      publishTier: "company",
      createdBy: "owner@example.test",
      publishedAt: now,
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "org",
      createdAt: now,
      updatedAt: now,
    },
  );
  for (const row of mocks.rows.knowledge)
    if (row.evidenceJson !== "[]")
      await bindFixtureProvenance(row, mocks.rows.captures);
  for (const capture of mocks.rows.captures) {
    capture.sensitivityDisposition = "allowed";
    capture.sensitivityPolicyVersion = "1";
    capture.audienceAclHash = "acl-hash";
    mocks.rows.audiences.push({
      captureId: capture.id,
      audienceId: "aud_org",
      aclHash: "acl-hash",
    });
  }
}

beforeEach(resetRows);

describe("Brain universal search helpers", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLikeTerm(String.raw`100%_done\ship`)).toBe(
      String.raw`100\%\_done\\ship`,
    );
  });

  it("keeps the phrase and useful terms for query expansion", () => {
    expect(
      normalizeSearchTerms("What did Platform decide about OAuth?"),
    ).toEqual([
      "what did platform decide about oauth",
      "platform",
      "decide",
      "oauth",
    ]);
  });

  it("builds a short snippet around the first matching term", () => {
    const snippet = buildSnippet(
      `${"intro ".repeat(80)}The rollout policy requires approvals before launch.`,
      ["policy"],
      80,
    );
    expect(snippet).toContain("policy requires approvals");
    expect(snippet.startsWith("...")).toBe(true);
  });

  it("requires citation text to match the accessible capture", () => {
    const content =
      "Contact ava@example.com. The rollout policy requires approvals before launch.";

    expect(
      citationEvidenceMatchesCapture(
        { quote: "rollout policy requires approvals" },
        content,
      ),
    ).toBe(true);
    expect(
      citationEvidenceMatchesCapture({ quote: "Contact [redacted]." }, content),
    ).toBe(false);
    expect(
      citationEvidenceMatchesCapture(
        { quote: "Contact mallory@example.com." },
        content,
      ),
    ).toBe(false);
    expect(
      citationEvidenceMatchesCapture(
        {
          quote: null,
          preview: "...Contact [redacted]. The rollout policy requires...",
          verbatim: false,
        },
        content,
      ),
    ).toBe(true);
    expect(
      citationEvidenceMatchesCapture(
        {
          quote: null,
          preview: "unrelated generated preview",
          verbatim: false,
        },
        content,
      ),
    ).toBe(false);
    expect(
      citationEvidenceMatchesCapture(
        {
          quote: null,
          preview: "The rollout policy requires approvals",
          verbatim: true,
        },
        content,
      ),
    ).toBe(false);
  });

  it("redacts emails, Slack mailto tokens, and phone-like values", () => {
    expect(
      redactSensitiveText(
        "Email: <mailto:ava@example.com|Ava> or ava@example.com call +1 415 555 1212",
      ),
    ).toBe("Email: [redacted] or [redacted] call [redacted]");
  });

  it("preserves ISO dates and URLs while redacting phone-like values", () => {
    expect(
      redactSensitiveText(
        "Launch 2026-05-15 from https://example.test/users/4155551212, call (415) 555-1212.",
      ),
    ).toBe(
      "Launch 2026-05-15 from https://example.test/users/4155551212, call [redacted].",
    );
  });

  it("redacts Slack user identifiers in default review text", () => {
    expect(
      redactSensitiveText("User: U0GCV21HC pinged <@U02JPJEU67J> in channel"),
    ).toBe("User: [redacted] pinged [redacted] in channel");
  });

  it("scores title matches higher than body-only matches", () => {
    const terms = normalizeSearchTerms("retention policy");
    const titleScore = scoreSearchText(
      { title: "Retention policy", body: "short note" },
      terms,
    );
    const bodyScore = scoreSearchText(
      { title: "Random note", body: "Retention policy details" },
      terms,
    );
    expect(titleScore).toBeGreaterThan(bodyScore);
  });

  it("extracts source links from common metadata keys", () => {
    expect(
      sourceUrlFromMetadata({ permalink: "https://slack.example/p/1" }),
    ).toBe("https://slack.example/p/1");
    expect(sourceUrlFromMetadata({ sourceUrl: "https://docs.example/a" })).toBe(
      "https://docs.example/a",
    );
    expect(
      sourceUrlFromMetadata({
        sourceUrl: "https://notes.granola.ai/d/private-call",
      }),
    ).toBeNull();
    expect(
      sourceUrlFromMetadata({ sourceUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(
      sourceUrlFromMetadata({ sourceUrl: "data:text/html,test" }),
    ).toBeNull();
    expect(
      sourceUrlFromMetadata({ sourceUrl: "http://docs.example/a" }),
    ).toBeNull();
  });

  it("summarizes federated coverage without searching other apps", async () => {
    const coverage = await buildFederatedSearchCoverage({
      query: "Which dashboard explains mailbox conversion?",
      provider: "slack",
    });

    expect(coverage.mode).toBe("brain-index-plus-delegation-hints");
    expect(coverage.brainSourceProviders).toContainEqual(
      expect.objectContaining({
        id: "slack",
        configuredSourceCount: 1,
        activeSourceCount: 1,
      }),
    );
    expect(coverage.workspaceProviderCoverage.providers).toContainEqual(
      expect.objectContaining({
        id: "slack",
        readiness: "ready",
        grantState: "granted",
        connected: true,
      }),
    );
    expect(coverage.delegationHints.map((hint) => hint.target)).toEqual([
      "analytics",
      "mail",
    ]);
    expect(coverage.discoveredAgents.agents).toEqual([
      {
        id: "analytics",
        name: "Analytics",
        description: "Dashboards and data analysis",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mailbox and Gmail search",
      },
    ]);
    expect(mocks.discoverAgents).toHaveBeenCalledWith("brain");
  });
});

describe("Brain universal search regressions", () => {
  it("ranks the current published decision above raw captures and archived knowledge", async () => {
    const results = await searchEverythingRows({
      query: "Why did we retire freemium?",
      limit: 5,
    });

    expect(results[0]).toMatchObject({
      type: "knowledge",
      title: "Freemium signup retired for enterprise-led growth",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_PRODUCT/p1777657200000100",
      citation: {
        sourceUrl:
          "https://slack.example.com/archives/CDEMO_PRODUCT/p1777657200000100",
      },
    });
    expect(results[0]?.citation?.quote).toContain("trial activation");
    expect(
      results.some(
        (result) =>
          result.type === "knowledge" &&
          result.title === "Freemium signup was the default acquisition path",
      ),
    ).toBe(false);
  });

  it("does not expose pending proposal-only facts as published knowledge", async () => {
    const results = await searchEverythingRows({
      query: "transcript retention policy legal review",
      type: "knowledge",
      limit: 5,
    });

    expect(results).toEqual([]);
  });

  it("searches structured entity metadata for named-person questions", async () => {
    const results = await searchEverythingRows({
      query: "Nick Nestle",
      type: "knowledge",
      limit: 5,
    });

    expect(results[0]).toMatchObject({
      id: "knowledge-freemium-current",
      type: "knowledge",
    });
  });

  it("redacts PII in raw capture search output while preserving source links", async () => {
    const results = await searchEverythingRows({
      query: "support automation escalation owner",
      type: "capture",
      limit: 5,
    });

    expect(results[0]).toMatchObject({
      type: "capture",
      title: "Support escalation owner note",
      sourceUrl: "https://support.example.com/escalations/owner-note",
    });
    expect(results[0]?.snippet).toContain("[redacted]");
    expect(JSON.stringify(results)).not.toContain("ava.cho@example.com");
    expect(JSON.stringify(results)).not.toContain("+1 415 555 1212");
  });

  it("returns an honest empty set for unsupported questions", async () => {
    await expect(
      searchEverythingRows({
        query: "Which snack supplier replaced the lunch menu?",
        limit: 5,
      }),
    ).resolves.toEqual([]);
  });
});

describe("Brain semantic capture hits", () => {
  const capturedAt = "2026-07-20T09:30:00.000Z";

  function seedSemanticCapture(input: {
    id: string;
    sourceId: string;
    metadata: Record<string, unknown>;
  }) {
    mocks.rows.captures.push({
      id: input.id,
      sourceId: input.sourceId,
      externalId: input.id,
      title: "Onboarding thread",
      kind: "message",
      content: "Shorten enterprise onboarding latency. Ping ava@example.com.",
      contentHash: `hash-${input.id}`,
      metadataJson: JSON.stringify(input.metadata),
      capturedAt,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: capturedAt,
      sensitivityDisposition: "allowed",
      sensitivityPolicyVersion: "1",
      audienceAclHash: "acl-hash",
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
    mocks.hybridSearchArtifacts.mockResolvedValue({
      results: [
        {
          id: `artifact-${input.id}`,
          artifactId: `artifact-${input.id}`,
          captureId: input.id,
          sourceId: input.sourceId,
          audienceId: "aud_org",
          title: "Onboarding thread",
          text: "Shorten enterprise onboarding latency.",
          capturedAt,
          semanticRank: 1,
          score: 0.02,
          reasons: ["semantic-match"],
          lane: "semantic",
        },
      ],
      lanes: OK_LANES,
    });
  }

  it("omits an undated Markdown capture's fallback time from semantic results", async () => {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-manual",
      provider: "manual",
      title: "Manual",
    });
    seedSemanticCapture({
      id: "markdown:undated.md",
      sourceId: "source-manual",
      metadata: {},
    });
    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });
    expect(rows[0]?.capturedAt).toBeUndefined();
    expect(rows[0]?.citation?.capturedAt).toBeUndefined();
  });

  it("returns the supplied Markdown time rather than an index timestamp", async () => {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-manual",
      provider: "manual",
      title: "Manual",
    });
    seedSemanticCapture({
      id: "markdown:dated.md",
      sourceId: "source-manual",
      metadata: { capturedAtSource: "manual-markdown" },
    });
    const capture = mocks.rows.captures.find(
      (row) => row.id === "markdown:dated.md",
    );
    if (!capture) throw new Error("Missing capture fixture");
    capture.capturedAt = "2026-05-20T15:00:00.000Z";
    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });
    expect(rows[0]?.capturedAt).toBe("2026-05-20T15:00:00.000Z");
    expect(rows[0]?.citation?.capturedAt).toBe("2026-05-20T15:00:00.000Z");
  });

  it("preserves semantic timestamp behavior for other manual captures", async () => {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-manual",
      provider: "manual",
      title: "Manual",
    });
    seedSemanticCapture({
      id: "ordinary-capture",
      sourceId: "source-manual",
      metadata: {},
    });
    const capture = mocks.rows.captures.find(
      (row) => row.id === "ordinary-capture",
    );
    if (!capture) throw new Error("Missing capture fixture");
    capture.capturedAt = "2026-05-20T15:00:00.000Z";
    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });
    expect(rows[0]?.capturedAt).toBe(capturedAt);
    expect(rows[0]?.citation?.capturedAt).toBeUndefined();
  });

  it("returns Slack channel, content, date and permalink for semantic hits", async () => {
    seedSemanticCapture({
      id: "capture-semantic-slack",
      sourceId: "source-slack",
      metadata: {
        provider: "slack",
        channelName: "eng",
        permalink: "https://example.slack.com/archives/C1/p1",
      },
    });

    const { rows, lanes } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });

    expect(lanes).toEqual(OK_LANES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "capture-semantic-slack",
      provider: "slack",
      location: "#eng",
      sourceUrl: "https://example.slack.com/archives/C1/p1",
      citation: { sourceUrl: "https://example.slack.com/archives/C1/p1" },
      capturedAt,
      lane: "semantic",
    });
    expect(rows[0]?.content).toContain("Shorten enterprise onboarding latency");
    expect(rows[0]?.content).not.toContain("ava@example.com");
  });

  it("uses the Zoom meeting topic as the semantic hit location", async () => {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-zoom",
      title: "Zoom recordings",
      provider: "zoom",
    });
    seedSemanticCapture({
      id: "capture-semantic-zoom",
      sourceId: "source-zoom",
      metadata: {
        provider: "zoom",
        meetingTopic: "Weekly onboarding review",
        sourceUrl: "https://zoom.example.com/rec/share/abc",
      },
    });

    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });

    expect(rows[0]).toMatchObject({
      id: "capture-semantic-zoom",
      provider: "zoom",
      location: "Weekly onboarding review",
      sourceUrl: "https://zoom.example.com/rec/share/abc",
      capturedAt,
    });
    expect(rows[0]?.content).toBeTruthy();
  });

  it("reports manual transcript withholding on semantic hits", async () => {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-manual",
      provider: "manual",
    });
    seedSemanticCapture({
      id: "capture-semantic-manual",
      sourceId: "source-manual",
      metadata: {
        passageQuarantine: { version: 1, withheldPassages: 2 },
        sourceUrl: "https://example.test/private-transcript",
        meetingTopic: "https://example.test/private-transcript",
      },
    });
    const capture = mocks.rows.captures.find(
      (row) => row.id === "capture-semantic-manual",
    );
    if (!capture) throw new Error("missing test capture");
    capture.kind = "transcript";
    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });
    expect(rows).toMatchObject([
      {
        id: "capture-semantic-manual",
        withheldPassages: 2,
        sourceUrl: null,
        location: null,
      },
    ]);
  });

  it("does not enrich semantic hits whose capture is outside the allowed scope", async () => {
    seedSemanticCapture({
      id: "capture-semantic-blocked",
      sourceId: "source-slack",
      metadata: { channelName: "eng" },
    });
    mocks.rows.captures[
      mocks.rows.captures.length - 1
    ]!.sensitivityDisposition = "blocked";

    const { rows } = await searchEverythingWithLanes({
      query: "reduce customer waiting",
      type: "capture",
    });

    expect(rows).toEqual([]);
  });

  it("reports lane failures from hybrid search", async () => {
    mocks.hybridSearchArtifacts.mockResolvedValue({
      results: [],
      lanes: {
        fts: { status: "ok" },
        semantic: {
          status: "failed",
          error: "openai-credential-unavailable",
        },
      },
    });

    await expect(
      searchEverythingWithLanes({ query: "reduce customer waiting" }),
    ).resolves.toMatchObject({
      rows: [],
      lanes: {
        fts: { status: "ok" },
        semantic: {
          status: "failed",
          error: "openai-credential-unavailable",
        },
      },
    });
  });

  it("reports a rejected semantic lane instead of an empty success", async () => {
    mocks.hybridSearchArtifacts.mockRejectedValue(new Error("pgvector down"));

    await expect(
      searchEverythingWithLanes({ query: "reduce customer waiting" }),
    ).resolves.toMatchObject({
      rows: [],
      lanes: {
        fts: { status: "ok" },
        semantic: { status: "failed", error: "pgvector down" },
      },
    });
  });
  it("uses source authority when equally relevant captures also match the direct lexical lane", async () => {
    mocks.rows.knowledge.length = 0;
    const baseline = {
      ...mocks.rows.captures[0],
      title: "Release plan",
      content: "Release plan approved for beta",
      sensitivityDisposition: "allowed",
    };
    mocks.rows.captures.splice(
      0,
      mocks.rows.captures.length,
      { ...baseline, id: "low-authority", sourceId: "source-slack" },
      { ...baseline, id: "high-authority", sourceId: "source-generic" },
    );
    const lowSource = mocks.rows.sources.find(
      (row) => row.id === "source-slack",
    );
    const highSource = mocks.rows.sources.find(
      (row) => row.id === "source-generic",
    );
    if (!lowSource || !highSource)
      throw new Error("Authority fixtures unavailable");
    lowSource.configJson = JSON.stringify({ answerPolicy: { authority: 0 } });
    highSource.configJson = JSON.stringify({
      answerPolicy: { authority: 100 },
    });
    const rows = await searchEverythingRows({
      query: "Release plan",
      type: "capture",
    });
    expect(rows.map((row) => row.id)).toEqual([
      "high-authority",
      "low-authority",
    ]);
  });

  it("keeps saved-query results inside every cited source, not just the primary source", async () => {
    const knowledge = mocks.rows.knowledge.find(
      (row) => row.id === "knowledge-freemium-current",
    );
    if (!knowledge) throw new Error("Fixture knowledge unavailable");
    knowledge.evidenceJson = JSON.stringify([
      {
        captureId: "capture-freemium-current",
        sourceId: "source-slack",
        quote: "Decision: retire",
      },
      {
        captureId: "capture-retention-open-question",
        sourceId: "source-generic",
        quote: "Open question",
      },
    ]);
    await bindFixtureProvenance(knowledge, mocks.rows.captures);
    const result = await searchEverythingRows({
      query: "freemium",
      type: "knowledge",
      sourceIds: ["source-slack"],
    });
    expect(result).toEqual([]);
    const allowed = await searchEverythingRows({
      query: "freemium",
      type: "knowledge",
      sourceIds: ["source-slack", "source-generic"],
    });
    expect(allowed.some((row) => row.id === "knowledge-freemium-current")).toBe(
      true,
    );
  });
});

describe("receipt-free transcripts with an omission marker", () => {
  it("masks a locator-shaped capture title only for a partial capture", () => {
    expect(publicCaptureTitle("www.example.test/full", true)).toBe(
      "Transcript excerpt",
    );
    expect(publicCaptureTitle("www.example.test/full", false)).toBe(
      "www.example.test/full",
    );
    expect(publicCaptureTitle("Weekly sync", true)).toBe("Weekly sync");
  });

  const metadataJson = JSON.stringify({
    sourceUrl: "https://example.test/full",
  });
  const content = "Alex: hello\n[…]\nSam: wrapping up";

  it("counts as partial with an unknown number of withheld passages", () => {
    const receipted = withOmissionReceipt(metadataJson, content, "transcript");
    const metadata = parseCaptureMetadata(receipted);
    expect(withheldPassageCount(metadata, "manual", "transcript")).toBeNull();
    expect(
      publicCaptureExternalId("recording.md", metadata, "transcript"),
    ).toBe(null);
    expect(publicCaptureMetadata(metadata)).not.toHaveProperty("sourceUrl");
  });

  it("leaves complete transcripts, documents and existing receipts alone", () => {
    expect(withOmissionReceipt(metadataJson, "Alex: hello", "transcript")).toBe(
      metadataJson,
    );
    expect(withOmissionReceipt(metadataJson, content, "document")).toBe(
      metadataJson,
    );
    const receipted = JSON.stringify({
      passageQuarantine: { version: 1, withheldPassages: 2 },
    });
    expect(withOmissionReceipt(receipted, content, "transcript")).toBe(
      receipted,
    );
  });
});
