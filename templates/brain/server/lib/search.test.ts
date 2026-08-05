import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition =
  | { op: "access" }
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "eq"; col: Column; val: unknown }
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
    return String(value ?? "")
      .replace(/^%|%$/g, "")
      .replace(/\\([\\%_])/g, "$1")
      .toLowerCase();
  }

  const matches = (row: Row, condition?: Condition): boolean => {
    if (!condition) return true;
    if (condition.op === "access") return true;
    if (condition.op === "captureSourceAccessible") {
      return rows.sources.some((source) => source.id === row.sourceId);
    }
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
      const value = String(row[condition.col.name] ?? "").toLowerCase();
      return value.includes(likeNeedle(condition.val));
    }
    return false;
  };

  const applyOrder = (items: Row[], order?: { column?: Column }) => {
    if (!order?.column) return items;
    return [...items].sort((a, b) =>
      String(b[order.column!.name] ?? "").localeCompare(
        String(a[order.column!.name] ?? ""),
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
    if (text.includes("exists")) return { op: "captureSourceAccessible" };
    return { op: "access" };
  },
}));

import {
  buildFederatedSearchCoverage,
  buildSnippet,
  escapeLikeTerm,
  normalizeSearchTerms,
  redactSensitiveText,
  scoreSearchText,
  searchEverythingRows,
  sourceUrlFromMetadata,
} from "./search.js";

function resetRows() {
  for (const values of Object.values(mocks.rows)) values.length = 0;
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
      entitiesJson: "[]",
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
