import { ok } from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const testString = (value: unknown) =>
  typeof value === "string"
    ? value
    : value instanceof URLSearchParams
      ? value.toString()
      : (JSON.stringify(value) ?? "");

type Condition =
  | { op: "access" }
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "eq"; col: Column; val: unknown }
  | { op: "inArray"; col: Column; vals: unknown[] }
  | { op: "like"; col: Column; val: unknown }
  | { op: "captureSourceAccessible" }
  | { op: "captureAudienceAccessible"; audienceIds: unknown[] }
  | { op: "isNull"; col: Column };

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
      "audienceId",
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
  };

  const tableRows = (tableRef: Row) => {
    if (tableRef === schema.brainSources) return rows.sources;
    if (tableRef === schema.brainRawCaptures) return rows.captures;
    if (tableRef === schema.brainKnowledge) return rows.knowledge;
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
    if (condition.op === "access") return row.accessible !== false;
    if (condition.op === "captureSourceAccessible") {
      return rows.sources.some(
        (source) => source.id === row.sourceId && source.accessible !== false,
      );
    }
    if (condition.op === "captureAudienceAccessible") {
      return (
        Array.isArray(row.audienceIds) &&
        row.audienceIds.some((id) => condition.audienceIds.includes(id))
      );
    }
    if (condition.op === "isNull") return row[condition.col.name] === null;
    if (condition.op === "and") {
      return condition.conditions.every((item) => matches(row, item));
    }
    if (condition.op === "or") {
      return condition.conditions.some((item) => matches(row, item));
    }
    if (condition.op === "eq") return row[condition.col.name] === condition.val;
    if (condition.op === "inArray") {
      return condition.vals.includes(row[condition.col.name]);
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
  inArray: (col: Column, vals: unknown[]) => ({ op: "inArray", col, vals }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("${}");
    if (text.startsWith("lower(")) {
      return { op: "like", col: values[0] as Column, val: values[1] };
    }
    if (
      text.includes("exists") &&
      values[0] === mocks.schema.brainCaptureAudiences
    ) {
      const audienceCondition = values[3] as Extract<
        Condition,
        { op: "inArray" }
      >;
      return {
        op: "captureAudienceAccessible",
        audienceIds: audienceCondition.vals,
      };
    }
    if (text.includes("exists")) return { op: "captureSourceAccessible" };
    if (text.includes("IS NULL"))
      return { op: "isNull", col: values[0] as Column };
    return { op: "access" };
  },
}));

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

function resetRows() {
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
      audienceId: "aud_org",
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
  for (const capture of mocks.rows.captures) {
    capture.audienceIds = ["aud_org"];
    capture.sensitivityDisposition = "allowed";
    capture.sensitivityPolicyVersion = "1";
    capture.audienceAclHash = "acl-hash";
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

describe("Brain knowledge citation completeness", () => {
  const sourceUrl = "https://zoom.example.test/rec/share/cited";

  function seedCitedCapture(provider = "zoom", metadataJson = "{}") {
    mocks.rows.sources.push({
      ...mocks.rows.sources[0],
      id: "source-cited",
      provider,
    });
    const capture: Row = {
      ...mocks.rows.captures[0],
      id: "capture-cited",
      sourceId: "source-cited",
      metadataJson,
    };
    mocks.rows.captures.push(capture);
    const knowledge = mocks.rows.knowledge[1];
    ok(knowledge);
    knowledge.evidenceJson = JSON.stringify([
      { captureId: capture.id, sourceUrl },
    ]);
    return { capture, knowledge };
  }

  async function searchKnowledge() {
    const results = await searchEverythingRows({
      query: "freemium",
      type: "knowledge",
    });
    expect(results).toHaveLength(1);
    return results[0];
  }

  it.each([
    {
      name: "valid Zoom receipt",
      metadataJson: JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
      withheldPassages: 5,
    },
    { name: "absent Zoom receipt", metadataJson: "{}", withheldPassages: 0 },
    {
      name: "invalid Zoom JSON",
      metadataJson: "not JSON",
      withheldPassages: null,
    },
    {
      name: "malformed Zoom receipt",
      metadataJson: JSON.stringify({ zoomPassageQuarantine: { version: 1 } }),
      withheldPassages: null,
    },
    {
      name: "Slack metadata with Zoom receipt",
      provider: "slack",
      metadataJson: JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
      withheldPassages: 0,
    },
    {
      name: "generic malformed metadata",
      provider: "generic",
      metadataJson: "not JSON",
      withheldPassages: 0,
    },
  ])(
    "uses the displayed cited capture for $name",
    async ({ provider = "zoom", metadataJson, withheldPassages }) => {
      seedCitedCapture(provider, metadataJson);
      const result = await searchKnowledge();
      expect(result).toMatchObject({
        citation: {
          captureId: "capture-cited",
          sourceUrl: withheldPassages === 0 ? sourceUrl : null,
        },
        sourceUrl: withheldPassages === 0 ? sourceUrl : null,
        withheldPassages,
      });
    },
  );

  it.each(["missing", "source", "sensitivity", "audience"])(
    "does not expose completeness or a historical URL for %s-inaccessible evidence",
    async (restriction) => {
      const { capture } = seedCitedCapture(
        "zoom",
        JSON.stringify({
          zoomPassageQuarantine: {
            version: 1,
            totalPassages: 12,
            withheldPassages: 5,
          },
        }),
      );
      const knowledgeSource = mocks.rows.sources[0];
      ok(knowledgeSource);
      knowledgeSource.provider = "zoom";
      if (restriction === "missing") mocks.rows.captures.pop();
      if (restriction === "source") {
        const source = mocks.rows.sources[mocks.rows.sources.length - 1];
        ok(source);
        source.accessible = false;
      }
      if (restriction === "sensitivity")
        capture.sensitivityDisposition = "quarantined";
      if (restriction === "audience") capture.audienceIds = ["aud_private"];
      expect(await searchKnowledge()).toMatchObject({
        withheldPassages: null,
        sourceUrl: null,
        citation: { captureId: "capture-cited", sourceUrl: null },
      });
    },
  );

  it("falls back to the row capture when evidence is missing", async () => {
    const { knowledge } = seedCitedCapture(
      "zoom",
      JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
    );
    knowledge.captureId = "capture-cited";
    knowledge.evidenceJson = "[]";
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 5,
      sourceUrl: null,
      citation: null,
    });
  });

  it.each(["manual", "zoom"])(
    "handles missing capture provenance with a URL for %s knowledge",
    async (provider) => {
      const knowledge = mocks.rows.knowledge[1];
      const source = mocks.rows.sources[0];
      ok(knowledge);
      ok(source);
      source.provider = provider;
      knowledge.captureId = null;
      knowledge.evidenceJson = JSON.stringify([{ sourceUrl }]);
      expect(await searchKnowledge()).toMatchObject({
        withheldPassages: null,
        sourceUrl: null,
        citation: { sourceUrl: null },
      });
      knowledge.evidenceJson = "[]";
      expect(await searchKnowledge()).toMatchObject({
        withheldPassages: provider === "zoom" ? null : 0,
      });
    },
  );

  it.each(["zoom", "slack", "unknown"])(
    "does not authorize URL-only %s evidence with an unrelated complete Slack row capture",
    async (provider) => {
      const { knowledge } = seedCitedCapture(provider);
      knowledge.evidenceJson = JSON.stringify([
        {
          sourceId: provider === "unknown" ? "source-unknown" : "source-cited",
          sourceUrl,
        },
      ]);
      const expected = {
        withheldPassages: provider === "slack" ? 0 : null,
        sourceUrl: null,
        citation: { sourceUrl: null },
      };
      expect(await searchKnowledge()).toMatchObject(expected);
      knowledge.evidenceJson = JSON.stringify([
        { sourceId: "source-slack" },
        {
          sourceId: provider === "unknown" ? "source-unknown" : "source-cited",
          sourceUrl,
        },
      ]);
      expect(await searchKnowledge()).toMatchObject(expected);
    },
  );

  it.each(["missing", "unknown", "inaccessible"])(
    "keeps secondary evidence with a %s source unknown on Slack knowledge",
    async (restriction) => {
      const knowledge = mocks.rows.knowledge[1];
      ok(knowledge);
      if (restriction === "inaccessible") {
        mocks.rows.sources.push({
          ...mocks.rows.sources[0],
          id: "source-unreadable",
          accessible: false,
          provider: "slack",
        });
      }
      knowledge.evidenceJson = JSON.stringify([
        {
          captureId: knowledge.captureId,
          sourceId: knowledge.sourceId,
          sourceUrl,
        },
        {
          captureId: "capture-unreadable",
          sourceId:
            restriction === "missing"
              ? undefined
              : restriction === "unknown"
                ? "source-unknown"
                : "source-unreadable",
        },
      ]);
      expect(await searchKnowledge()).toMatchObject({
        withheldPassages: null,
        sourceUrl: null,
        citation: { sourceUrl: null },
      });
    },
  );

  it("uses the primary non-Zoom row source when its capture is inaccessible", async () => {
    const knowledge = mocks.rows.knowledge[1];
    ok(knowledge);
    mocks.rows.captures.shift();
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 0,
      sourceUrl: null,
      citation: { sourceUrl: null },
    });
  });

  it("includes partial secondary citations even when a complete URL citation is displayed", async () => {
    const { capture, knowledge } = seedCitedCapture();
    const partial = {
      ...capture,
      id: "capture-partial-secondary",
      metadataJson: JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
    };
    mocks.rows.captures.push(partial);
    knowledge.evidenceJson = JSON.stringify([
      { captureId: partial.id, sourceId: "source-cited" },
      { captureId: capture.id, sourceId: "source-cited", sourceUrl },
    ]);
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 5,
      sourceUrl: null,
      citation: { captureId: capture.id, sourceUrl: null },
    });
    knowledge.captureId = partial.id;
    knowledge.evidenceJson = JSON.stringify([
      { captureId: capture.id, sourceUrl },
    ]);
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 5,
      sourceUrl: null,
    });
  });

  it("deduplicates capture counts and gives an unknown secondary precedence over their sum", async () => {
    const { capture, knowledge } = seedCitedCapture(
      "zoom",
      JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
    );
    const secondary = {
      ...capture,
      id: "capture-secondary",
      metadataJson: JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 3,
        },
      }),
    };
    mocks.rows.captures.push(secondary);
    knowledge.captureId = capture.id;
    knowledge.evidenceJson = JSON.stringify([
      { captureId: capture.id, sourceUrl },
      { captureId: secondary.id, sourceId: "source-cited" },
      { captureId: capture.id },
      { captureId: secondary.id },
    ]);
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 8,
      sourceUrl: null,
    });
    secondary.metadataJson = "not JSON";
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: null,
      sourceUrl: null,
    });
    mocks.rows.captures.pop();
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: null,
      sourceUrl: null,
    });
  });

  it.each(["sensitivity", "audience", "missing"])(
    "suppresses URLs without a Zoom warning for %s-inaccessible non-Zoom citations",
    async (restriction) => {
      const { capture, knowledge } = seedCitedCapture("slack");
      const knowledgeSource = mocks.rows.sources[0];
      ok(knowledgeSource);
      knowledgeSource.provider = "zoom";
      knowledge.evidenceJson = JSON.stringify([
        { captureId: capture.id, sourceId: "source-cited", sourceUrl },
      ]);
      if (restriction === "sensitivity")
        capture.sensitivityDisposition = "quarantined";
      if (restriction === "audience") capture.audienceIds = ["aud_private"];
      if (restriction === "missing") mocks.rows.captures.pop();
      expect(await searchKnowledge()).toMatchObject({
        withheldPassages: 0,
        sourceUrl: null,
        citation: { sourceUrl: null },
      });
    },
  );

  it("uses cited providers in mixed evidence and keeps unknown Zoom provenance unknown", async () => {
    const { capture, knowledge } = seedCitedCapture(
      "zoom",
      JSON.stringify({
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      }),
    );
    knowledge.evidenceJson = JSON.stringify([
      {
        captureId: "capture-freemium-current",
        sourceId: "source-slack",
        sourceUrl,
      },
      { captureId: capture.id, sourceId: "source-cited" },
    ]);
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: 5,
      sourceUrl: null,
    });
    const knowledgeSource = mocks.rows.sources[0];
    ok(knowledgeSource);
    knowledgeSource.provider = "zoom";
    knowledge.evidenceJson = JSON.stringify([
      { captureId: capture.id, sourceUrl },
      { captureId: "capture-unknown", sourceId: "source-unknown" },
    ]);
    expect(await searchKnowledge()).toMatchObject({
      withheldPassages: null,
      sourceUrl: null,
    });
    expect(JSON.stringify(await searchKnowledge())).not.toContain(
      "zoomPassageQuarantine",
    );
  });

  it("reports zero for manual knowledge with no capture", async () => {
    const knowledge = mocks.rows.knowledge[1];
    const source = mocks.rows.sources[0];
    ok(knowledge);
    ok(source);
    source.provider = "manual";
    knowledge.captureId = null;
    knowledge.evidenceJson = "[]";
    expect(await searchKnowledge()).toMatchObject({ withheldPassages: 0 });
  });
});

describe("Brain semantic capture hits", () => {
  const capturedAt = "2026-07-20T09:30:00.000Z";

  function seedSemanticCapture(input: {
    id: string;
    sourceId: string;
    metadata: Record<string, unknown> | string | null;
  }) {
    mocks.rows.captures.push({
      id: input.id,
      sourceId: input.sourceId,
      externalId: input.id,
      title: "Onboarding thread",
      kind: "message",
      content: "Shorten enterprise onboarding latency. Ping ava@example.com.",
      contentHash: `hash-${input.id}`,
      metadataJson:
        typeof input.metadata === "string" || input.metadata === null
          ? input.metadata
          : JSON.stringify(input.metadata),
      capturedAt,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: capturedAt,
      audienceIds: ["aud_org"],
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

  it.each([
    {
      name: "valid receipt",
      metadata: {
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 12,
          withheldPassages: 5,
        },
      },
      withheldPassages: 5,
    },
    { name: "absent receipt", metadata: {}, withheldPassages: 0 },
    {
      name: "Slack invalid JSON",
      provider: "slack",
      metadata: "not JSON",
      withheldPassages: 0,
    },
    {
      name: "manual missing metadata",
      provider: "manual",
      metadata: null,
      withheldPassages: 0,
    },
    {
      name: "generic malformed receipt",
      provider: "generic",
      metadata: { zoomPassageQuarantine: null },
      withheldPassages: 0,
    },
    { name: "missing metadata", metadata: null, withheldPassages: null },
    { name: "invalid JSON", metadata: "not JSON", withheldPassages: null },
    {
      name: "truncated JSON",
      metadata: '{"zoomPassageQuarantine":',
      withheldPassages: null,
    },
    { name: "JSON null", metadata: "null", withheldPassages: null },
    { name: "JSON array", metadata: "[]", withheldPassages: null },
    { name: "JSON string", metadata: '"metadata"', withheldPassages: null },
    {
      name: "null receipt",
      metadata: { zoomPassageQuarantine: null },
      withheldPassages: null,
    },
    {
      name: "incomplete receipt",
      metadata: { zoomPassageQuarantine: { version: 1 } },
      withheldPassages: null,
    },
    {
      name: "unsupported receipt version",
      metadata: {
        zoomPassageQuarantine: {
          version: 2,
          totalPassages: 12,
          withheldPassages: 5,
        },
      },
      withheldPassages: null,
    },
    {
      name: "withheld count exceeds total",
      metadata: {
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 4,
          withheldPassages: 5,
        },
      },
      withheldPassages: null,
    },
    {
      name: "total exceeds passage limit",
      metadata: {
        zoomPassageQuarantine: {
          version: 1,
          totalPassages: 49,
          withheldPassages: 5,
        },
      },
      withheldPassages: null,
    },
  ])(
    "reports provider-scoped withheld passages for $name in semantic and keyword capture results",
    async ({ metadata, withheldPassages, provider = "zoom" }) => {
      mocks.rows.sources.push({
        ...mocks.rows.sources[0],
        id: "source-completeness",
        provider,
      });
      seedSemanticCapture({
        id: "capture-partial-zoom",
        sourceId: "source-completeness",
        metadata,
      });
      const semantic = await searchEverythingWithLanes({
        query: "reduce customer waiting",
        type: "capture",
      });
      expect(semantic.rows).toHaveLength(1);
      expect(semantic.rows[0]).toMatchObject({
        id: "capture-partial-zoom",
        withheldPassages,
      });
      mocks.hybridSearchArtifacts.mockResolvedValue({
        results: [],
        lanes: OK_LANES,
      });
      const keyword = await searchEverythingWithLanes({
        query: "enterprise onboarding",
        type: "capture",
      });
      expect(
        keyword.rows.find((row) => row.id === "capture-partial-zoom"),
      ).toMatchObject({
        id: "capture-partial-zoom",
        withheldPassages,
      });
    },
  );

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
});
