// Question-search bake-off: compares ways of answering question-style
// searches ("what did we learn from the mobile launch") on the relevance
// eval's invented corpus, so no real page reaches a model. It runs only with
// SEARCH_QUESTION_BAKEOFF=1; see README.md.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  searchRelevanceCases,
  type SearchEvalCase,
} from "../search-relevance/cases.js";
import {
  BLOG_POSTS_COLLECTION_KEY,
  corpusDocuments,
  OWNER_EMAIL,
  SPACE_IDS,
  TASK_PRIORITIES_COLLECTION_KEY,
} from "../search-relevance/corpus.js";
import { seedSearchEvalCorpus } from "../search-relevance/seed.js";
import {
  ENRICH_PROMPT,
  excerpt,
  fuse,
  HYDE_PROMPT,
  keywordLane,
  LANE_DEPTH,
  pageChunks,
  replyJson,
  RERANK_PROMPT,
  REWRITE_PROMPT,
  vectorLane,
} from "./lanes.js";
import {
  bakeoffModelsFromEnv,
  emptyUsage,
  type BakeoffModels,
  type ModelUsage,
} from "./models.js";

const ENABLED = process.env.SEARCH_QUESTION_BAKEOFF === "1";
const REPORT_DIR = process.env.SEARCH_QUESTION_BAKEOFF_REPORT;
const CONCURRENCY = 6;
const TEST_DB_PATH = join(
  tmpdir(),
  `content-question-bakeoff-${process.pid}-${Date.now()}.pglite`,
);

const COLLECTIONS = new Set([
  BLOG_POSTS_COLLECTION_KEY,
  TASK_PRIORITIES_COLLECTION_KEY,
]);
const visible = corpusDocuments.filter(
  (doc) => doc.space !== "outsider" && !doc.hideFromSearch && !doc.trashed,
);
const byKey = new Map(visible.map((doc) => [doc.key, doc]));

/** Query-time lanes, each costing model calls on every search. */
type QueryLane = "query-embedding" | "rewrite" | "hyde" | "rerank";

interface Method {
  name: string;
  summary: string;
  needs: ("embeddings" | "chat")[];
  queryLanes: QueryLane[];
  indexLanes: ("page-embeddings" | "enrichment")[];
}

const METHODS: Method[] = [
  {
    name: "current",
    summary: "Today's search: every word must match",
    needs: [],
    queryLanes: [],
    indexLanes: [],
  },
  {
    name: "keywords",
    summary: "Ranked by the question's words, minus filler; no model",
    needs: [],
    queryLanes: [],
    indexLanes: [],
  },
  {
    name: "current + keywords",
    summary: "Today's search and keywords, merged by rank; no model",
    needs: [],
    queryLanes: [],
    indexLanes: [],
  },
  {
    name: "embeddings",
    summary: "Closest page chunk by embedding, alone",
    needs: ["embeddings"],
    queryLanes: ["query-embedding"],
    indexLanes: ["page-embeddings"],
  },
  {
    name: "hybrid",
    summary: "Today's search and embeddings, merged by rank",
    needs: ["embeddings"],
    queryLanes: ["query-embedding"],
    indexLanes: ["page-embeddings"],
  },
  {
    name: "hybrid + keywords",
    summary: "Today's search, keywords and embeddings, merged",
    needs: ["embeddings"],
    queryLanes: ["query-embedding"],
    indexLanes: ["page-embeddings"],
  },
  {
    name: "rewrite",
    summary: "A model turns the question into searches; sends no page text",
    needs: ["chat"],
    queryLanes: ["rewrite"],
    indexLanes: [],
  },
  {
    name: "rewrite + hybrid",
    summary: "Rewritten searches merged with hybrid",
    needs: ["embeddings", "chat"],
    queryLanes: ["query-embedding", "rewrite"],
    indexLanes: ["page-embeddings"],
  },
  {
    name: "HyDE",
    summary: "Embeds a model-written answer instead of the question",
    needs: ["embeddings", "chat"],
    queryLanes: ["hyde"],
    indexLanes: ["page-embeddings"],
  },
  {
    name: "enrichment",
    summary: "Pages also embedded as a model's summary and questions",
    needs: ["embeddings", "chat"],
    queryLanes: ["query-embedding"],
    indexLanes: ["page-embeddings", "enrichment"],
  },
  {
    name: "rerank",
    summary: "A model reorders the top 20 of hybrid + keywords",
    needs: ["embeddings", "chat"],
    queryLanes: ["query-embedding", "rerank"],
    indexLanes: ["page-embeddings"],
  },
];

let searchDocuments: typeof import("../../actions/search-documents.js").default;

async function currentSearch(kase: SearchEvalCase, query = kase.query) {
  const result = await runWithRequestContext({ userEmail: OWNER_EMAIL }, () =>
    searchDocuments.run({
      query,
      spaceId: kase.filters?.spaceId
        ? SPACE_IDS[kase.filters.spaceId]
        : undefined,
      documentType: kase.filters?.documentType,
      searchFields: kase.filters?.searchFields,
      limit: LANE_DEPTH,
      offset: 0,
    }),
  );
  return result.documents.map((doc) => doc.id.replace(/^doc-/, ""));
}

/** The visible pages a case's filters allow, for the lanes beside search. */
function casePages(kase: SearchEvalCase): string[] {
  const filters = kase.filters;
  if (filters?.searchFields === "title") return [];
  return visible
    .filter(
      (doc) =>
        (!filters?.spaceId || doc.space === filters.spaceId) &&
        (!filters?.documentType ||
          (filters.documentType === "database") === COLLECTIONS.has(doc.key)),
    )
    .map((doc) => doc.key);
}

async function eachLimit<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!);
    }),
  );
}

interface CaseRun {
  kase: SearchEvalCase;
  ranked: Record<string, string[]>;
  usage: Record<QueryLane, ModelUsage>;
}

interface MethodReport {
  name: string;
  summary: string;
  skipped?: string;
  question?: { top1: number; top3: number; mrr: number; zero: number };
  other?: { top3: number; mrr: number };
  leaks?: number;
  perSearch?: { calls: number; milliseconds: number; tokens: number };
  indexTime?: { calls: number; tokens: number; embeddedCharacters: number };
}

function rankOf(kase: SearchEvalCase, keys: readonly string[]) {
  const relevant = kase.expectFirst
    ? [kase.expectFirst]
    : (kase.acceptableTop3 ?? []);
  const index = keys.slice(0, 10).findIndex((key) => relevant.includes(key));
  return index < 0 ? null : index + 1;
}

function scores(runs: CaseRun[], method: string) {
  const ranks = runs.map((run) => rankOf(run.kase, run.ranked[method] ?? []));
  const firsts = runs.filter((run) => run.kase.expectFirst);
  return {
    top1: firsts.length
      ? firsts.filter((run) => rankOf(run.kase, run.ranked[method] ?? []) === 1)
          .length / firsts.length
      : 0,
    top3:
      ranks.filter((rank) => rank !== null && rank <= 3).length / runs.length,
    mrr:
      ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) /
      runs.length,
    zero: runs.filter((run) => !(run.ranked[method] ?? []).length).length,
  };
}

function sumUsage(usages: ModelUsage[]): ModelUsage {
  const total = emptyUsage();
  for (const usage of usages) {
    total.calls += usage.calls;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.embeddedCharacters += usage.embeddedCharacters;
    total.milliseconds += usage.milliseconds;
  }
  return total;
}

async function runBakeoff(models: BakeoffModels | null) {
  const hasChat = Boolean(models?.chatLabel);
  const keywords = keywordLane(visible);
  const indexUsage = {
    "page-embeddings": emptyUsage(),
    enrichment: emptyUsage(),
  };

  // Index time: every visible page in chunks, and a model's summary of it.
  const chunkVectors = new Map<string, number[][]>();
  const enrichedVectors = new Map<string, number[][]>();
  if (models) {
    const chunks = visible.flatMap((doc) =>
      pageChunks(doc).map((text) => ({ key: doc.key, text })),
    );
    const vectors = await models.embed(
      chunks.map((chunk) => chunk.text),
      "document",
      indexUsage["page-embeddings"],
    );
    chunks.forEach((chunk, index) => {
      const list = chunkVectors.get(chunk.key) ?? [];
      list.push(vectors[index]!);
      chunkVectors.set(chunk.key, list);
    });
    if (hasChat) {
      const summaries = new Map<string, string>();
      await eachLimit(visible, async (doc) => {
        const reply = await models.chat(
          ENRICH_PROMPT,
          excerpt(doc, 6_000),
          indexUsage.enrichment,
        );
        summaries.set(doc.key, `${doc.title}\n${reply}`);
      });
      const keys = [...summaries.keys()];
      const summaryVectors = await models.embed(
        keys.map((key) => summaries.get(key)!),
        "document",
        indexUsage.enrichment,
      );
      keys.forEach((key, index) =>
        enrichedVectors.set(key, [
          ...(chunkVectors.get(key) ?? []),
          summaryVectors[index]!,
        ]),
      );
    }
  }

  const runs: CaseRun[] = [];
  await eachLimit(searchRelevanceCases, async (kase) => {
    const usage: CaseRun["usage"] = {
      "query-embedding": emptyUsage(),
      rewrite: emptyUsage(),
      hyde: emptyUsage(),
      rerank: emptyUsage(),
    };
    const pages = casePages(kase);
    const allowed = new Set(pages);
    const current = await currentSearch(kase);
    const keyworded = keywords(kase.query).filter((key) => allowed.has(key));
    const ranked: Record<string, string[]> = {
      current: current.slice(0, 10),
      keywords: keyworded.slice(0, 10),
      "current + keywords": fuse({ current, keywords: keyworded }),
    };

    if (models) {
      const [queryVector] = await models.embed(
        [kase.query],
        "query",
        usage["query-embedding"],
      );
      const embedded = vectorLane(chunkVectors, queryVector!, pages);
      ranked.embeddings = embedded.slice(0, 10);
      ranked.hybrid = fuse({ current, embedded });
      const hybridKeywords = fuse(
        {
          current,
          keywords: keyworded,
          embedded,
        },
        LANE_DEPTH,
      );
      ranked["hybrid + keywords"] = hybridKeywords.slice(0, 10);

      if (hasChat) {
        const reply = replyJson(
          await models.chat(REWRITE_PROMPT, kase.query, usage.rewrite),
        );
        const rewrites = Array.isArray(reply?.queries)
          ? reply.queries.map(String).slice(0, 3)
          : [];
        // A model-written search can be one search-documents rejects.
        const rewritten = await Promise.all(
          rewrites.map((query) =>
            currentSearch(kase, query).catch(() => [] as string[]),
          ),
        );
        const rewriteLanes = Object.fromEntries(
          rewritten.map((keys, index) => [`rewrite-${index}`, keys]),
        );
        ranked.rewrite = fuse({ current, ...rewriteLanes });
        ranked["rewrite + hybrid"] = fuse({
          current,
          ...rewriteLanes,
          embedded,
        });

        const passage =
          (await models.chat(HYDE_PROMPT, kase.query, usage.hyde)) ||
          kase.query;
        const [hydeVector] = await models.embed(
          [passage],
          "document",
          usage.hyde,
        );
        ranked.HyDE = fuse({
          current,
          hyde: vectorLane(chunkVectors, hydeVector!, pages),
        });

        ranked.enrichment = fuse({
          current,
          enriched: vectorLane(enrichedVectors, queryVector!, pages),
        });

        const candidates = hybridKeywords;
        const judged = candidates.length
          ? replyJson(
              await models.chat(
                RERANK_PROMPT,
                `Question: ${kase.query}\n\n${candidates
                  .map((key, index) => {
                    const doc = byKey.get(key);
                    return `${index + 1}. ${doc ? excerpt(doc) : key}`;
                  })
                  .join("\n")}`,
                usage.rerank,
              ),
            )
          : null;
        const order = Array.isArray(judged?.ranking)
          ? judged.ranking
              .map((value) => candidates[Number(value) - 1])
              .filter((key): key is string => Boolean(key))
          : [];
        ranked.rerank = [...new Set([...order, ...candidates])].slice(0, 10);
      }
    }
    runs.push({ kase, ranked, usage });
  });

  const ranked = runs.filter((run) => run.kase.class !== "access");
  const questions = ranked.filter((run) => run.kase.class === "question");
  const others = ranked.filter((run) => run.kase.class !== "question");

  const reports: MethodReport[] = METHODS.map((method) => {
    const missing = method.needs.filter((need) =>
      need === "chat" ? !hasChat : !models,
    );
    if (missing.length)
      return {
        name: method.name,
        summary: method.summary,
        skipped: `no ${missing.join(" or ")} model is configured`,
      };
    const query = sumUsage(
      runs.flatMap((run) => method.queryLanes.map((lane) => run.usage[lane])),
    );
    const index = sumUsage(method.indexLanes.map((lane) => indexUsage[lane]));
    const otherScores = scores(others, method.name);
    return {
      name: method.name,
      summary: method.summary,
      question: scores(questions, method.name),
      other: { top3: otherScores.top3, mrr: otherScores.mrr },
      // Any search, not just the access cases, that returns a page the
      // searcher couldn't open: another person's, hidden or trashed.
      leaks: runs.filter((run) =>
        (run.ranked[method.name] ?? []).some((key) => !byKey.has(key)),
      ).length,
      perSearch: {
        calls: query.calls / runs.length,
        milliseconds: query.milliseconds / runs.length,
        tokens: (query.inputTokens + query.outputTokens) / runs.length,
      },
      indexTime: {
        calls: index.calls,
        tokens: index.inputTokens + index.outputTokens,
        embeddedCharacters: index.embeddedCharacters,
      },
    };
  });

  return {
    embeddings: models?.embeddingLabel ?? null,
    chat: models?.chatLabel ?? null,
    pages: visible.length,
    questionCases: questions.length,
    otherCases: others.length,
    methods: reports,
    misses: Object.fromEntries(
      METHODS.map((method) => [
        method.name,
        questions
          .filter((run) => {
            const rank = rankOf(run.kase, run.ranked[method.name] ?? []);
            return run.ranked[method.name] && (rank === null || rank > 3);
          })
          .map((run) => run.kase.id),
      ]),
    ),
  };
}

type Report = Awaited<ReturnType<typeof runBakeoff>>;

const percent = (value: number) => `${Math.round(value * 100)}%`;

function markdown(report: Report) {
  const lines = [
    "## Question-search bake-off",
    "",
    `Embeddings: ${report.embeddings ?? "none"}. Chat: ${report.chat ?? "none"}. ` +
      `${report.pages} visible invented pages; ${report.questionCases} question ` +
      `cases and ${report.otherCases} other ranked cases (known-item, passage, typo).`,
    "",
    "| Method | Question top-1 | Question top-3 | Question MRR | Other top-3 | Other MRR | Leaks | Model calls per search | Model ms per search | Tokens per search | Index-time calls |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const method of report.methods) {
    if (method.skipped) {
      lines.push(
        `| ${method.name} | skipped: ${method.skipped} | | | | | | | | | |`,
      );
      continue;
    }
    lines.push(
      `| ${method.name} | ${percent(method.question!.top1)} | ${percent(method.question!.top3)} | ` +
        `${method.question!.mrr.toFixed(2)} | ${percent(method.other!.top3)} | ` +
        `${method.other!.mrr.toFixed(2)} | ${method.leaks} | ${method.perSearch!.calls.toFixed(1)} | ` +
        `${Math.round(method.perSearch!.milliseconds)} | ${Math.round(method.perSearch!.tokens)} | ` +
        `${method.indexTime!.calls} |`,
    );
  }
  lines.push("", "Methods:", "");
  for (const method of report.methods)
    lines.push(`- **${method.name}**: ${method.summary}.`);
  return `${lines.join("\n")}\n`;
}

describe.skipIf(!ENABLED)("question-search bake-off", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
    const dbModule = await import("../../server/db/index.js");
    searchDocuments = (await import("../../actions/search-documents.js"))
      .default;
    const plugin = (await import("../../server/plugins/db.js")).default;
    await plugin(undefined as any);
    await seedSearchEvalCorpus(dbModule.getDb, dbModule.schema);
  }, 60_000);

  afterAll(async () => {
    await closeDbExec();
    rmSync(TEST_DB_PATH, { force: true, recursive: true });
  });

  it("compares question-search methods without leaking a page", async () => {
    const report = await runBakeoff(bakeoffModelsFromEnv());
    const table = markdown(report);
    // eslint-disable-next-line no-console
    console.log(`\n${table}`);
    if (REPORT_DIR) {
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(
        join(REPORT_DIR, "question-search-bakeoff.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      writeFileSync(join(REPORT_DIR, "question-search-bakeoff.md"), table);
    }
    expect(
      report.methods
        .filter((method) => method.leaks)
        .map((method) => method.name),
    ).toEqual([]);
  }, 1_500_000);
});
