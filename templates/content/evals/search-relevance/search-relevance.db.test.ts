// Deterministic relevance eval for the `search-documents` action. Phase 1.1
// of the search overhaul plan: this file, corpus.ts, cases.ts, and
// baseline.json exist so every later change to the search engine (a
// maintained full-text index, typo correction, semantic search) is judged
// against the same fixed corpus and the same judged queries. See
// README.md for how to run and update this eval.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  searchRelevanceCases,
  type SearchEvalCase,
  type SearchEvalCaseClass,
} from "./cases.js";
import {
  BLOG_POSTS_COLLECTION_KEY,
  corpusDocuments,
  docId,
  OUTSIDER_EMAIL,
  OWNER_EMAIL,
  SPACE_IDS,
  TASK_PRIORITIES_COLLECTION_KEY,
  type CorpusSpace,
} from "./corpus.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-relevance-eval-${process.pid}-${Date.now()}.pglite`,
);
const BASELINE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "baseline.json",
);
const UPDATE_BASELINE = process.env.SEARCH_EVAL_UPDATE_BASELINE === "1";
const EPSILON = 0.005;

type Schema = typeof import("../../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("../../actions/search-documents.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER_EMAIL }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("../../actions/search-documents.js")).default;
  const plugin = (await import("../../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const spaceOwner = (space: CorpusSpace) =>
    space === "outsider" ? OUTSIDER_EMAIL : OWNER_EMAIL;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentSpaces)
    .values(
      (Object.keys(SPACE_IDS) as CorpusSpace[]).map((space) => ({
        id: SPACE_IDS[space],
        name:
          space === "personal"
            ? "Alice's personal space"
            : space === "org"
              ? "Meridian Analytics workspace"
              : "Cobalt Metrics workspace",
        kind: space === "org" || space === "outsider" ? "org" : "personal",
        ownerEmail: spaceOwner(space),
        orgId: null,
        filesDatabaseId: `${SPACE_IDS[space]}-files`,
        createdBy: spaceOwner(space),
        createdAt: now,
        updatedAt: now,
      })),
    );

  // Deterministic, monotonically increasing timestamps across the whole
  // corpus so ranking tie-breaks (updatedAt desc, id asc) never depend on
  // wall-clock insert timing.
  const BASE_TIME = Date.parse("2026-01-06T09:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  const documentRows = corpusDocuments.map((doc, index) => {
    const timestamp = new Date(BASE_TIME + index * DAY_MS).toISOString();
    return {
      id: docId(doc.key),
      spaceId: SPACE_IDS[doc.space],
      ownerEmail: spaceOwner(doc.space),
      orgId: null,
      parentId: doc.parentKey ? docId(doc.parentKey) : null,
      title: doc.title,
      content: doc.body,
      description: doc.description ?? "",
      position: index,
      visibility: "private" as const,
      hideFromSearch: doc.hideFromSearch ? 1 : 0,
      trashedAt: doc.trashed ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  for (let start = 0; start < documentRows.length; start += 100) {
    await getDb()
      .insert(schema.documents)
      .values(documentRows.slice(start, start + 100));
  }

  await getDb()
    .insert(schema.contentDatabases)
    .values([
      {
        id: "db-blog-posts",
        spaceId: SPACE_IDS.org,
        ownerEmail: OWNER_EMAIL,
        documentId: docId(BLOG_POSTS_COLLECTION_KEY),
        title: "Blog posts",
      },
      {
        id: "db-task-priorities",
        spaceId: SPACE_IDS.org,
        ownerEmail: OWNER_EMAIL,
        documentId: docId(TASK_PRIORITIES_COLLECTION_KEY),
        title: "Task Priorities",
      },
    ]);

  const membershipRows = corpusDocuments
    .filter((doc) => doc.collection)
    .map((doc, index) => ({
      id: `item-${doc.key}`,
      ownerEmail: OWNER_EMAIL,
      databaseId:
        doc.collection === "blog-posts"
          ? "db-blog-posts"
          : "db-task-priorities",
      documentId: docId(doc.key),
      position: index,
    }));
  if (membershipRows.length) {
    await getDb().insert(schema.contentDatabaseItems).values(membershipRows);
  }
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface CaseOutcome {
  id: string;
  class: SearchEvalCaseClass;
  resultIds: string[];
  relevantIds: string[];
  /** 1-based rank of the first relevant id in resultIds, else null. */
  rank: number | null;
}

interface ClassMetrics {
  count: number;
  top1: number | null;
  top1Count: number;
  top3: number | null;
  mrr: number | null;
  zeroResults: number;
}

function relevantKeysFor(kase: SearchEvalCase): string[] {
  if (kase.expectFirst) return [kase.expectFirst];
  return kase.acceptableTop3 ?? [];
}

async function runCase(kase: SearchEvalCase): Promise<CaseOutcome> {
  const spaceId = kase.filters?.spaceId
    ? SPACE_IDS[kase.filters.spaceId]
    : undefined;
  const result = await asOwner(() =>
    searchDocuments.run({
      query: kase.query,
      spaceId,
      documentType: kase.filters?.documentType,
      searchFields: kase.filters?.searchFields,
      limit: 10,
      offset: 0,
    }),
  );
  const resultIds = result.documents.map((doc) => doc.id);
  const relevantIds = relevantKeysFor(kase).map(docId);
  let rank: number | null = null;
  for (let index = 0; index < resultIds.length; index += 1) {
    if (relevantIds.includes(resultIds[index]!)) {
      rank = index + 1;
      break;
    }
  }
  return { id: kase.id, class: kase.class, resultIds, relevantIds, rank };
}

function aggregate(
  cases: SearchEvalCase[],
  outcomes: CaseOutcome[],
): ClassMetrics {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const top1Eligible = cases.filter((kase) => kase.expectFirst);
  const top1Hits = top1Eligible.filter(
    (kase) => byId.get(kase.id)?.rank === 1,
  ).length;
  const top3Hits = outcomes.filter(
    (outcome) => outcome.rank !== null && outcome.rank <= 3,
  ).length;
  const mrrSum = outcomes.reduce(
    (sum, outcome) => sum + (outcome.rank ? 1 / outcome.rank : 0),
    0,
  );
  const zeroResults = outcomes.filter(
    (outcome) => outcome.resultIds.length === 0,
  ).length;
  return {
    count: outcomes.length,
    top1: top1Eligible.length ? top1Hits / top1Eligible.length : null,
    top1Count: top1Eligible.length,
    top3: outcomes.length ? top3Hits / outcomes.length : null,
    mrr: outcomes.length ? mrrSum / outcomes.length : null,
    zeroResults,
  };
}

/** Access cases score pass/fail (distractor absent), not rank — reuse the
 * same table shape by treating "blocked" as a hit at rank 1. */
function aggregateAccess(outcomes: CaseOutcome[]): ClassMetrics {
  const blocked = outcomes.filter((outcome) =>
    outcome.relevantIds.every((id) => !outcome.resultIds.includes(id)),
  ).length;
  const rate = outcomes.length ? blocked / outcomes.length : null;
  return {
    count: outcomes.length,
    top1: rate,
    top1Count: outcomes.length,
    top3: rate,
    mrr: rate,
    zeroResults: outcomes.filter((outcome) => outcome.resultIds.length === 0)
      .length,
  };
}

interface BaselineClass extends ClassMetrics {
  gating: boolean;
}

interface BaselineFile {
  generatedAt: string;
  epsilon: number;
  classes: Record<SearchEvalCaseClass, BaselineClass>;
  overall: ClassMetrics;
}

const GATING: Record<SearchEvalCaseClass, boolean> = {
  "known-item": true,
  passage: true,
  typo: false,
  question: false,
  access: true,
};

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function printTable(baseline: BaselineFile) {
  const header = [
    "class",
    "count",
    "top1",
    "top3",
    "mrr",
    "zeroResults",
    "gating",
  ];
  const rows = [
    ...(Object.keys(baseline.classes) as SearchEvalCaseClass[]).map((cls) => {
      const metrics = baseline.classes[cls];
      return [
        cls,
        String(metrics.count),
        formatMetric(metrics.top1),
        formatMetric(metrics.top3),
        formatMetric(metrics.mrr),
        String(metrics.zeroResults),
        String(metrics.gating),
      ];
    }),
    [
      "overall (known-item+passage+typo+question)",
      String(baseline.overall.count),
      formatMetric(baseline.overall.top1),
      formatMetric(baseline.overall.top3),
      formatMetric(baseline.overall.mrr),
      String(baseline.overall.zeroResults),
      "-",
    ],
  ];
  const widths = header.map((label, col) =>
    Math.max(label.length, ...rows.map((row) => row[col]!.length)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, col) => cell.padEnd(widths[col]!)).join("  ");
  // eslint-disable-next-line no-console
  console.log("\nSearch relevance eval\n" + formatRow(header));
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(formatRow(row));
  }
}

let currentBaseline: BaselineFile;
let outcomesByClass: Record<SearchEvalCaseClass, CaseOutcome[]>;

beforeAll(async () => {
  const outcomes = await Promise.all(searchRelevanceCases.map(runCase));
  outcomesByClass = {
    "known-item": [],
    passage: [],
    typo: [],
    question: [],
    access: [],
  };
  for (const outcome of outcomes) outcomesByClass[outcome.class]!.push(outcome);

  const classesArr: SearchEvalCaseClass[] = [
    "known-item",
    "passage",
    "typo",
    "question",
    "access",
  ];
  const classes = {} as Record<SearchEvalCaseClass, BaselineClass>;
  for (const cls of classesArr) {
    const casesForClass = searchRelevanceCases.filter((k) => k.class === cls);
    const metrics =
      cls === "access"
        ? aggregateAccess(outcomesByClass[cls]!)
        : aggregate(casesForClass, outcomesByClass[cls]!);
    classes[cls] = { ...metrics, gating: GATING[cls] };
  }
  const rankedClasses: SearchEvalCaseClass[] = [
    "known-item",
    "passage",
    "typo",
    "question",
  ];
  const overall = aggregate(
    searchRelevanceCases.filter((k) => rankedClasses.includes(k.class)),
    rankedClasses.flatMap((cls) => outcomesByClass[cls]!),
  );

  currentBaseline = {
    generatedAt: new Date().toISOString(),
    epsilon: EPSILON,
    classes,
    overall,
  };

  printTable(currentBaseline);

  if (UPDATE_BASELINE) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(currentBaseline, null, 2)}\n`,
    );
    // eslint-disable-next-line no-console
    console.log(`\nWrote new baseline to ${BASELINE_PATH}`);
  }
}, 60_000);

describe("search relevance eval", () => {
  it("has a recorded baseline to compare against", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it("never surfaces an outsider-owned, hidden, or trashed document for any query", () => {
    const leaks = outcomesByClass.access!.filter(
      (outcome) =>
        !outcome.relevantIds.every((id) => !outcome.resultIds.includes(id)),
    );
    expect(
      leaks.map((leak) => ({ id: leak.id, resultIds: leak.resultIds })),
    ).toEqual([]);
  });

  it("does not regress known-item or passage relevance versus the recorded baseline", () => {
    if (UPDATE_BASELINE) return;
    const recorded: BaselineFile = JSON.parse(
      readFileSync(BASELINE_PATH, "utf8"),
    );
    for (const cls of ["known-item", "passage"] as const) {
      const current = currentBaseline.classes[cls];
      const baseline = recorded.classes[cls];
      expect(
        current.top3! + EPSILON,
        `${cls} top-3 hit rate regressed: ${current.top3} < ${baseline.top3}`,
      ).toBeGreaterThanOrEqual(baseline.top3!);
      expect(
        current.mrr! + EPSILON,
        `${cls} MRR regressed: ${current.mrr} < ${baseline.mrr}`,
      ).toBeGreaterThanOrEqual(baseline.mrr!);
    }
  });

  it("keeps typo and question classes marked report-only", () => {
    expect(currentBaseline.classes.typo.gating).toBe(false);
    expect(currentBaseline.classes.question.gating).toBe(false);
  });
});
