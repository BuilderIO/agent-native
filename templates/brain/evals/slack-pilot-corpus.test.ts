import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SLACK_PILOT_SOURCE,
  runSlackPilotCorpusEval,
  slackPilotEvalCases,
  slackPilotFixtures,
} from "./slack-pilot-corpus.js";

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
    db: {
      select: vi.fn(() => ({ from })),
    },
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/resources/store", () => ({
  SHARED_OWNER: "shared",
  resourcePut: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.test",
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: vi.fn(async () => null),
  putSetting: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ op: "access" }),
  assertAccess: vi.fn(),
  registerShareableResource: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  desc: (column: Column) => ({ column }),
  eq: (col: Column, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: Column, vals: unknown[]) => ({ op: "inArray", col, vals }),
  isNull: (col: Column) => ({ op: "eq", col, val: null }),
  like: (col: Column, val: unknown) => ({ op: "like", col, val }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("${}");
    if (text.startsWith("lower(")) {
      return { op: "like", col: values[0], val: values[1] };
    }
    if (text.includes("exists")) return { op: "captureSourceAccessible" };
    return { op: "access" };
  },
}));

import askBrainAction from "../actions/ask-brain.js";
import { tryAnswerBrainA2AQuestion } from "../server/lib/a2a-fallback.js";
import { searchEverythingRows } from "../server/lib/search.js";

function resetRows() {
  for (const values of Object.values(mocks.rows)) values.length = 0;
  const now = "2026-05-15T12:00:00.000Z";
  mocks.rows.sources.push({
    id: SLACK_PILOT_SOURCE.id,
    title: SLACK_PILOT_SOURCE.title,
    provider: SLACK_PILOT_SOURCE.provider,
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
  });

  slackPilotFixtures.forEach((fixture, index) => {
    const timestamp = `2026-05-15T12:${String(index).padStart(2, "0")}:00.000Z`;
    const captureId = `capture-${fixture.id}`;
    mocks.rows.captures.push({
      id: captureId,
      sourceId: SLACK_PILOT_SOURCE.id,
      externalId: `${SLACK_PILOT_SOURCE.id}:${fixture.id}`,
      title: fixture.captureTitle,
      kind: "message",
      content: fixture.quote,
      contentHash: `hash-${fixture.id}`,
      metadataJson: JSON.stringify({
        provider: "slack",
        permalink: fixture.sourceUrl,
      }),
      capturedAt: timestamp,
      importedBy: "owner@example.test",
      status: "distilled",
      distilledAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    mocks.rows.knowledge.push({
      id: `knowledge-${fixture.id}`,
      sourceId: SLACK_PILOT_SOURCE.id,
      captureId,
      kind: "decision",
      title: fixture.title,
      body: fixture.body,
      summary: fixture.summary,
      topic: "Brain Slack pilot",
      tagsJson: JSON.stringify(fixture.tags),
      entitiesJson: "[]",
      evidenceJson: JSON.stringify([
        {
          captureId,
          captureTitle: fixture.captureTitle,
          quote: fixture.quote,
          sourceUrl: fixture.sourceUrl,
        },
      ]),
      publishedResourcePath: null,
      supersedesId: null,
      supersededById: null,
      confidence: 94,
      status: "published",
      publishTier: "company",
      createdBy: "owner@example.test",
      publishedAt: timestamp,
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "org",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

beforeEach(resetRows);

describe("Brain Slack pilot eval corpus", () => {
  it("covers the real pilot follow-up topics with a durable question set", () => {
    expect(slackPilotEvalCases).toHaveLength(16);
    expect(slackPilotEvalCases.map((item) => item.id)).toEqual([
      "reasoning-effort-control",
      "fusion-missing-branch-pr-13340",
      "figma-plugin-json-uploader",
      "non-english-support",
      "slack-history-default",
      "slack-history-opt-in",
      "honest-not-found-policy",
      "personal-asides-exclusion",
      "pilot-eval-citations",
      "dev-fusion-project-settings-revert",
      "dev-fusion-tanstack-compromise",
      "connector-eval-gate-product-rationale",
      "import-review-policy",
      "architecture-sql-retrieval",
      "superseded-decisions-narration",
      "unsupported-office-catering",
    ]);
  });

  it("passes against Brain search and cited-answer actions without network access", async () => {
    const report = await runSlackPilotCorpusEval({
      search: async (question) =>
        searchEverythingRows({ query: question, limit: 16 }),
      answer: async (question) =>
        askBrainAction.run({ question, mode: "cited" }),
    });

    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report).toMatchObject({
      ok: true,
      passed: 16,
      total: 16,
      score: 1,
    });
  });

  it("ranks the #dev-fusion project settings knowledge above broad Fusion chatter", async () => {
    const results = await searchEverythingRows({
      query: "Why did project settings revert in #dev-fusion?",
      limit: 8,
    });
    const titles = results.map((result) => result.title);

    expect(
      titles.indexOf(
        "Project settings revert fixed with partial updates and deep merge",
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      titles.indexOf("Broad Fusion pilot status stayed informational"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      titles.indexOf(
        "Project settings revert fixed with partial updates and deep merge",
      ),
    ).toBeLessThan(
      titles.indexOf("Broad Fusion pilot status stayed informational"),
    );

    const answer = await askBrainAction.run({
      question: "Why did project settings revert in #dev-fusion?",
      mode: "cited",
    });
    const haystack = [
      answer.answer,
      ...answer.citations.flatMap((citation) => [
        citation.title,
        citation.excerpt,
        citation.url,
      ]),
    ].join("\n");

    expect(haystack).toContain("stale frontend values");
    expect(haystack).toContain("PATCH /projects/:projectId");
    expect(haystack).toContain("server-side deep merge");
    expect(haystack).not.toContain("Broad Fusion pilot status");
  });

  it("ranks the #dev-fusion TanStack compromise knowledge above broad Fusion chatter", async () => {
    const results = await searchEverythingRows({
      query: "Was Agent Native affected by the TanStack compromise?",
      limit: 8,
    });
    const titles = results.map((result) => result.title);

    expect(
      titles.indexOf(
        "Agent Native TanStack compromise review found no affected packages",
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      titles.indexOf("Broad Fusion pilot status stayed informational"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      titles.indexOf(
        "Agent Native TanStack compromise review found no affected packages",
      ),
    ).toBeLessThan(
      titles.indexOf("Broad Fusion pilot status stayed informational"),
    );

    const answer = await askBrainAction.run({
      question: "Was Agent Native affected by the TanStack compromise?",
      mode: "cited",
    });
    const haystack = [
      answer.answer,
      ...answer.citations.flatMap((citation) => [
        citation.title,
        citation.excerpt,
        citation.url,
      ]),
    ].join("\n");

    expect(haystack).toContain("uses TanStack");
    expect(haystack).toContain("not the affected packages");
    expect(haystack).toContain("minimum package age");
    expect(haystack).toContain("CI package pinning");
    expect(haystack).toContain("PR #673");
    expect(haystack).not.toContain("Broad Fusion pilot status");
  });

  it("keeps absent pilot facts honest instead of inventing citations", async () => {
    const result = await askBrainAction.run({
      question: "Which office snack supplier catered the Friday lunch?",
      mode: "cited",
    });

    expect(result.answer).toMatch(/could not find/i);
    expect(result.citations).toEqual([]);
    expect(result.knowledge).toEqual([]);
    expect(result.captures).toEqual([]);
  });

  it("answers Brain A2A questions deterministically when citations exist", async () => {
    const result = await tryAnswerBrainA2AQuestion(
      "What should Brain do when citation support is missing?",
    );

    expect(result).toContain("When citation support is missing");
    expect(result).toContain("Sources:");
    expect(result).toContain("https://slack.example.com/");
  });

  it("leaves unanswerable or mutating A2A messages for the normal agent path", async () => {
    await expect(
      tryAnswerBrainA2AQuestion(
        "Which office snack supplier catered the Friday lunch?",
      ),
    ).resolves.toBeNull();

    await expect(
      tryAnswerBrainA2AQuestion(
        "Import what should Brain do when citation support is missing?",
      ),
    ).resolves.toBeNull();
  });
});
